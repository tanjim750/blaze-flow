"""Manual "Pay by Wise" / "Pay by Payoneer".

Neither offers a public API an agency can use to create an invoice payment request with its own
account (checked 27 Oct 2026):
- Wise: the Wise Platform API (https://docs.wise.com/api-reference) covers quotes, recipients,
  transfers, balances and profiles. Payment Links and Quick Pay are made in the Wise Business app
  only (https://wise.com/help/articles/5NI2GXjj7vxXgl5NZqcyFU). A Quick Pay link takes
  ``?currency=&amount=`` so we can pre-fill it.
- Payoneer: the Billing Services API (https://www.payoneer.com/developers-docs/accounts-receivable/ar-billing-services/)
  is for approved Payoneer partner platforms whose users opt in; an agency can't use it with its
  own account. Payment requests/links are made in the Payoneer app (Get Paid → Request a Payment).

So the agency saves what a client needs to pay it (account details per currency and/or a payment
link). The invoice and pay link show them with the invoice number as the reference. Nothing is
confirmed automatically: the client may press "I've paid" (a pending claim) and the agency
confirms it, or the agency records the payment itself.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlencode, urlparse

from .base import GatewayError

CURRENCY_RE = re.compile(r'^[A-Z]{3}$')
MAX_ACCOUNTS = 12
MAX_DETAILS = 1500


@dataclass(frozen=True)
class ManualProvider:
    key: str
    name: str
    description: str
    link_label: str
    link_hosts: tuple[str, ...]
    link_help: str
    details_help: str
    signup_url: str
    docs_url: str
    methods: tuple[str, ...]
    prefill_quick_pay: bool = False

    def info(self) -> dict:
        return {'key': self.key, 'name': self.name, 'description': self.description, 'link_label': self.link_label,
                'link_help': self.link_help, 'details_help': self.details_help, 'signup_url': self.signup_url,
                'docs_url': self.docs_url, 'methods': list(self.methods), 'countries': [], 'currencies': []}

    def clean(self, data: dict) -> dict:
        link = str(data.get('payment_link') or '').strip()
        if link:
            parsed = urlparse(link)
            host = (parsed.hostname or '').lower()
            if parsed.scheme != 'https' or not any(host == h or host.endswith('.' + h) for h in self.link_hosts):
                raise GatewayError(f'The {self.link_label.lower()} must be an https link on {" or ".join(self.link_hosts)}.', status=400)
        accounts, seen = [], set()
        for row in data.get('accounts') or []:
            if not isinstance(row, dict):
                continue
            currency = str(row.get('currency') or '').strip().upper()
            details = str(row.get('details') or '').strip()
            if not currency and not details:
                continue
            if not CURRENCY_RE.match(currency):
                raise GatewayError('Each set of account details needs a 3-letter currency, like USD.', status=400)
            if not details:
                raise GatewayError(f'Add the {currency} account details.', status=400)
            if len(details) > MAX_DETAILS:
                raise GatewayError(f'The {currency} account details are too long.', status=400)
            if currency in seen:
                raise GatewayError(f'{currency} is listed twice.', status=400)
            seen.add(currency)
            accounts.append({'currency': currency, 'details': details})
        if len(accounts) > MAX_ACCOUNTS:
            raise GatewayError(f'Up to {MAX_ACCOUNTS} currencies.', status=400)
        note = str(data.get('note') or '').strip()[:500]
        if not link and not accounts:
            raise GatewayError(f'Add a {self.link_label.lower()} or at least one set of account details.', status=400)
        return {'payment_link': link, 'accounts': accounts, 'note': note}

    def link_for(self, details: dict, *, amount, currency) -> str:
        link = details.get('payment_link') or ''
        if link and self.prefill_quick_pay and '/pay/' in link and '?' not in link:
            link = f'{link}?{urlencode({"currency": currency, "amount": amount})}'
        return link


WISE = ManualProvider(
    key='wise', name='Wise', description='Clients pay by bank transfer to your Wise account details, or with your Wise payment link.',
    link_label='Wise payment link', link_hosts=('wise.com',),
    link_help='Wise Business → Payments → Quick Pay (or Payment Links). A Quick Pay link is pre-filled with the amount and currency.',
    details_help='Wise → your currency balance → Receive → Account details. Paste them exactly as Wise shows them (account holder, account number / IBAN, sort code / routing / SWIFT, bank address).',
    signup_url='https://wise.com/business/', docs_url='https://wise.com/help/articles/5NI2GXjj7vxXgl5NZqcyFU',
    methods=('Bank transfer', 'Pay with Wise'), prefill_quick_pay=True,
)
PAYONEER = ManualProvider(
    key='payoneer', name='Payoneer', description='Clients pay your Payoneer payment request link, or by bank transfer to your Payoneer receiving account.',
    link_label='Payoneer payment link', link_hosts=('payoneer.com',),
    link_help='Payoneer → Get Paid → Request a Payment (or Payment Links). Copy the link.',
    details_help='Payoneer → Receive → Receiving accounts. Paste the details for each currency.',
    signup_url='https://www.payoneer.com/', docs_url='https://www.payoneer.com/payment-request/',
    methods=('Card', 'Bank transfer', 'Payoneer balance'),
)
MANUAL_PROVIDERS: dict[str, ManualProvider] = {p.key: p for p in (WISE, PAYONEER)}


def get_manual(key: str) -> ManualProvider | None:
    return MANUAL_PROVIDERS.get(str(key or '').lower())
