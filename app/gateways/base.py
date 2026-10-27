"""The gateway provider interface.

A provider knows how to talk to one gateway with one workspace's credentials. It never touches
invoices' paid state itself: it turns the gateway's word into a ``PaymentEvent`` and
``app/services/online_payments.py`` decides (currency, duplicates, cap at amount owed) and
calls ``billing.record_payment`` - the single path that marks anything paid.

Lifecycle
- configure:  ``clean_credentials`` validates what the owner pasted (merging blanks with saved
  secrets), ``test_connection`` makes one harmless authenticated call.
- checkout:   ``create_checkout`` opens a hosted checkout for a ``GatewayCheckout`` row and
  returns ``(redirect_url, provider_reference)``.
- webhook:    ``verify_webhook`` authenticates the raw request (signature, or for IPNs a
  server-to-server validation) and ``parse_event`` returns a ``PaymentEvent`` or None.
- return:     ``confirm_return`` re-checks the session with the gateway when the payer comes
  back, so a missed webhook still records the payment (idempotently).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from decimal import Decimal

import requests
from django.conf import settings

logger = logging.getLogger(__name__)


class GatewayError(Exception):
    """Something the owner or payer should read. ``status`` is the HTTP status to answer with."""

    def __init__(self, message, *, status=502):
        super().__init__(message)
        self.status = status


class WebhookRejected(Exception):
    pass


@dataclass(frozen=True)
class CredentialField:
    name: str
    label: str
    secret: bool = True
    required: bool = True
    help: str = ''
    placeholder: str = ''

    def as_dict(self):
        return {'name': self.name, 'label': self.label, 'secret': self.secret, 'required': self.required,
                'help': self.help, 'placeholder': self.placeholder}


@dataclass
class PaymentEvent:
    """What the gateway says happened, already authenticated."""
    event_id: str
    type: str
    paid: bool
    # Our GatewayCheckout id or the provider's session id: whichever the gateway echoes back.
    checkout_id: str | None = None
    provider_reference: str | None = None
    amount: Decimal | None = None
    currency: str = ''
    extra: dict = field(default_factory=dict)


class GatewayProvider:
    key = ''
    name = ''
    description = ''
    countries: tuple[str, ...] = ()
    currencies: tuple[str, ...] = ()
    methods: tuple[str, ...] = ()
    credential_fields: tuple[CredentialField, ...] = ()
    docs_url = ''
    signup_url = ''
    keys_help = ''
    webhook_help = ''
    min_amount: Decimal | None = None
    max_amount: Decimal | None = None
    # Does the owner paste a webhook signing secret (PayMongo, Safepay), or is the IPN URL sent
    # with every session and checked with the validation API (SSLCOMMERZ)?
    webhook_in_dashboard = True

    # ----- configuration -------------------------------------------------------------------
    def clean_credentials(self, submitted: dict, saved: dict, mode: str) -> dict:
        out = {}
        for f in self.credential_fields:
            value = str(submitted.get(f.name) or '').strip()
            if not value:
                value = str(saved.get(f.name) or '').strip()
            if f.required and not value:
                raise GatewayError(f'{f.label} is required.', status=400)
            if value:
                out[f.name] = value
        self.check_mode(out, mode)
        return out

    def check_mode(self, credentials: dict, mode: str) -> None:
        """Catch a live key in sandbox mode (or the reverse) before the payer does."""

    def test_connection(self, connection, credentials: dict) -> dict:  # pragma: no cover - interface
        """One harmless authenticated call. Returns non-secret details to keep; raises GatewayError."""
        raise NotImplementedError

    # ----- payments ------------------------------------------------------------------------
    def create_checkout(self, *, connection, credentials, checkout, invoice, urls, customer) -> tuple[str, str]:  # pragma: no cover
        raise NotImplementedError

    def verify_webhook(self, *, connection, credentials, request) -> dict:  # pragma: no cover
        raise NotImplementedError

    def parse_event(self, *, connection, credentials, payload) -> PaymentEvent | None:  # pragma: no cover
        raise NotImplementedError

    def confirm_return(self, *, connection, credentials, checkout, request) -> PaymentEvent | None:
        return None

    # ----- helpers -------------------------------------------------------------------------
    def info(self) -> dict:
        return {
            'key': self.key, 'name': self.name, 'description': self.description, 'countries': list(self.countries),
            'currencies': list(self.currencies), 'methods': list(self.methods), 'docs_url': self.docs_url,
            'signup_url': self.signup_url, 'keys_help': self.keys_help, 'webhook_help': self.webhook_help,
            'webhook_in_dashboard': self.webhook_in_dashboard,
            'fields': [f.as_dict() for f in self.credential_fields],
            'min_amount': str(self.min_amount) if self.min_amount is not None else None,
            'max_amount': str(self.max_amount) if self.max_amount is not None else None,
        }

    def request(self, method, url, **kwargs):
        """HTTP to the gateway with a timeout; network trouble becomes a readable GatewayError."""
        kwargs.setdefault('timeout', getattr(settings, 'GATEWAY_REQUEST_TIMEOUT_SECONDS', 20))
        try:
            return requests.request(method, url, **kwargs)
        except requests.RequestException as exc:
            logger.warning('%s request to %s failed: %s', self.key, url.split('?')[0], exc.__class__.__name__)
            raise GatewayError(f'Couldn’t reach {self.name}. Try again in a minute.') from exc

    @staticmethod
    def json_or_empty(response) -> dict:
        try:
            data = response.json()
        except ValueError:
            return {}
        return data if isinstance(data, dict) else {'data': data}
