"""PayMongo (Philippines, PHP): Checkout Sessions + signed webhooks.

Docs (checked 27 Oct 2026):
- Create a Checkout Session: https://developers.paymongo.com/reference/create-a-checkout
  POST https://api.paymongo.com/v1/checkout_sessions, HTTP Basic auth with the secret key,
  ``line_items[].amount`` in centavos, ``currency`` PHP, ``payment_method_types`` required.
- Merchant payment methods: https://docs.paymongo.com/reference/retrieve-list-of-possible-merchant-payment-methods
  GET /v1/merchants/capabilities/payment_methods (used for Test connection).
- Securing a webhook: https://docs.paymongo.com/docs/developer-tools-webhook-setup-management
  ``Paymongo-Signature: t=<ts>,te=<test sig>,li=<live sig>``; signature is
  HMAC-SHA256(webhook secret, "<t>.<raw body>") hex; compare with te in test mode, li in live.
- Event ``checkout_session.payment.paid`` carries the checkout session; we re-read the session
  from the API before recording anything.
"""
from __future__ import annotations

import hashlib
import hmac
from decimal import Decimal

from .base import CredentialField, GatewayError, GatewayProvider, PaymentEvent, WebhookRejected

API = 'https://api.paymongo.com/v1'
# Checkout session payment_method_types we may pass (PayMongo docs list). Anything else the
# capability endpoint returns (e.g. terminal-only rails) is left out.
CHECKOUT_METHODS = ('card', 'gcash', 'paymaya', 'grab_pay', 'qrph', 'dob', 'dob_ubp', 'brankas_bdo', 'brankas_landbank',
                    'brankas_metrobank', 'billease', 'shopee_pay')
PAID_EVENT = 'checkout_session.payment.paid'


def to_centavos(amount: Decimal) -> int:
    return int((Decimal(amount) * 100).to_integral_value())


class PayMongo(GatewayProvider):
    key = 'paymongo'
    name = 'PayMongo'
    description = 'Cards, GCash, Maya, GrabPay and QR Ph for the Philippines.'
    countries = ('PH',)
    currencies = ('PHP',)
    methods = ('Cards', 'GCash', 'Maya', 'QR Ph')
    docs_url = 'https://developers.paymongo.com/reference/create-a-checkout'
    signup_url = 'https://dashboard.paymongo.com/signup'
    keys_help = 'PayMongo Dashboard → Developers → API keys. Use the sk_test_ key in sandbox and sk_live_ once activated.'
    webhook_help = 'PayMongo Dashboard → Developers → Webhooks → Add endpoint, event checkout_session.payment.paid. Paste its signing secret (whsk_…) here.'
    credential_fields = (
        CredentialField('secret_key', 'Secret key', placeholder='sk_test_…'),
        CredentialField('webhook_secret', 'Webhook signing secret', placeholder='whsk_…'),
    )

    def check_mode(self, credentials, mode):
        prefix = 'sk_live_' if mode == 'live' else 'sk_test_'
        if not credentials['secret_key'].startswith(prefix):
            raise GatewayError(f'In {"live" if mode == "live" else "sandbox"} mode the PayMongo secret key starts with {prefix}.', status=400)

    def _call(self, method, path, credentials, **kwargs):
        response = self.request(method, f'{API}{path}', auth=(credentials['secret_key'], ''),
                                headers={'Accept': 'application/json'}, **kwargs)
        data = self.json_or_empty(response)
        if response.status_code >= 400:
            errors = data.get('errors') or []
            detail = '; '.join(str(e.get('detail') or e.get('code')) for e in errors if isinstance(e, dict)) or f'HTTP {response.status_code}'
            status = 400 if response.status_code in (401, 403) else 502
            raise GatewayError(f'PayMongo said: {detail}', status=status)
        return data

    def test_connection(self, connection, credentials):
        data = self._call('GET', '/merchants/capabilities/payment_methods', credentials)
        methods = data.get('data') if isinstance(data.get('data'), list) else []
        usable = [m for m in methods if m in CHECKOUT_METHODS]
        if not usable:
            raise GatewayError('PayMongo accepted the key, but no online payment methods are enabled on this account yet.', status=400)
        return {'payment_methods': usable}

    def create_checkout(self, *, connection, credentials, checkout, invoice, urls, customer):
        methods = [m for m in (connection.details or {}).get('payment_methods', []) if m in CHECKOUT_METHODS] or ['card']
        attributes = {
            'line_items': [{'amount': to_centavos(checkout.amount), 'currency': 'PHP', 'quantity': 1,
                            'name': f'Invoice {invoice.number}'[:255]}],
            'payment_method_types': methods,
            'success_url': urls['success'], 'cancel_url': urls['cancel'],
            'reference_number': str(checkout.id),
            'description': f'Invoice {invoice.number}'[:255],
            'send_email_receipt': False, 'show_description': True, 'show_line_items': True,
            'metadata': {'blazeflow_checkout_id': str(checkout.id), 'blazeflow_invoice_id': str(invoice.id)},
        }
        if customer.get('email'):
            attributes['billing'] = {'email': customer['email'], **({'name': customer['name']} if customer.get('name') else {})}
        data = self._call('POST', '/checkout_sessions', credentials, json={'data': {'attributes': attributes}})
        session = data.get('data') or {}
        url = (session.get('attributes') or {}).get('checkout_url')
        if not session.get('id') or not url:
            raise GatewayError('PayMongo didn’t return a checkout page.')
        return url, session['id']

    def verify_webhook(self, *, connection, credentials, request):
        header = request.META.get('HTTP_PAYMONGO_SIGNATURE') or ''
        parts = dict(p.split('=', 1) for p in header.split(',') if '=' in p)
        timestamp = parts.get('t', '')
        received = parts.get('li' if connection.mode == 'live' else 'te', '')
        secret = credentials.get('webhook_secret') or ''
        if not (timestamp and received and secret):
            raise WebhookRejected('missing signature')
        expected = hmac.new(secret.encode(), f'{timestamp}.'.encode() + request.body, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, received):
            raise WebhookRejected('bad signature')
        import json
        try:
            return json.loads(request.body)
        except ValueError as exc:
            raise WebhookRejected('bad json') from exc

    def _session_event(self, credentials, session_id, *, event_id, type_):
        data = self._call('GET', f'/checkout_sessions/{session_id}', credentials)
        session = data.get('data') or {}
        attrs = session.get('attributes') or {}
        paid = [p for p in attrs.get('payments') or [] if (p.get('attributes') or {}).get('status') == 'paid']
        currencies = {str((p.get('attributes') or {}).get('currency') or '').upper() for p in paid}
        amount = sum((Decimal((p.get('attributes') or {}).get('amount') or 0) for p in paid), Decimal(0)) / 100
        metadata = attrs.get('metadata') or {}
        return PaymentEvent(
            event_id=event_id, type=type_, paid=bool(paid), provider_reference=session.get('id') or session_id,
            checkout_id=metadata.get('blazeflow_checkout_id') or attrs.get('reference_number'),
            amount=amount if paid else None, currency=currencies.pop() if len(currencies) == 1 else ('MIXED' if currencies else ''),
            extra={'payment_ids': [p.get('id') for p in paid]},
        )

    def parse_event(self, *, connection, credentials, payload):
        event = payload.get('data') or {}
        attrs = event.get('attributes') or {}
        if attrs.get('type') != PAID_EVENT:
            return PaymentEvent(event_id=str(event.get('id') or ''), type=str(attrs.get('type') or ''), paid=False)
        if bool(attrs.get('livemode')) != (connection.mode == 'live'):
            raise WebhookRejected('mode mismatch')
        session = attrs.get('data') or {}
        if not session.get('id'):
            raise WebhookRejected('no session')
        return self._session_event(credentials, session['id'], event_id=str(event.get('id') or ''), type_=PAID_EVENT)

    def confirm_return(self, *, connection, credentials, checkout, request):
        if not checkout.provider_reference:
            return None
        return self._session_event(credentials, checkout.provider_reference, event_id=f'return:{checkout.id}', type_='return')
