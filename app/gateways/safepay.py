"""Safepay (Pakistan, PKR): payment tracker + hosted checkout + HMAC-signed webhooks.

Docs (checked 27 Oct 2026):
- Express Checkout guide: https://safepay-docs.netlify.app/build-your-integration/express-checkout/?platform=web
  1. POST {api}/order/payments/v3/ (header X-SFPY-MERCHANT-SECRET) with merchant_api_key,
     intent CYBERSOURCE, mode payment, currency, amount in the lowest denomination -> tracker.
  2. POST {api}/client/passport/v1/token -> short-lived auth token (tbt), valid 1 hour.
  3. Hosted checkout URL: {checkout}/embedded/?environment=..&tracker=..&tbt=..&source=hosted
     &redirect_url=..&cancel_url=.. (the official @sfpy/node-core 0.3.5 SDK builds it this way:
     sandbox https://sandbox.api.getsafepay.com/embedded/, production https://getsafepay.com/embedded/).
  4. GET {api}/reporter/api/v1/payments/{tracker}: state TRACKER_ENDED = paid.
- Webhooks: https://safepay-docs.netlify.app/developers/webhooks/overview/ (verify the HMAC
  signature before acknowledging). Signature: X-SFPY-SIGNATURE = hex HMAC-SHA512 of the raw
  body with the webhook secret (official safepay-dotnet README and Safepay KB integration
  guide). Newer endpoints sign ``sha256=`` + HMAC-SHA256(base64-decoded secret,
  "<X-SFPY-TIMESTAMP>.<raw body>") (https://safepay.mintlify.app/guides/webhooks-delivery); both
  are accepted. Whatever the webhook says, we re-read the tracker from the reporter API before
  recording money.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
from decimal import Decimal

from .base import CredentialField, GatewayError, GatewayProvider, PaymentEvent, WebhookRejected

HOSTS = {
    'sandbox': {'api': 'https://sandbox.api.getsafepay.com', 'checkout': 'https://sandbox.api.getsafepay.com/embedded/', 'env': 'sandbox'},
    'live': {'api': 'https://api.getsafepay.com', 'checkout': 'https://getsafepay.com/embedded/', 'env': 'production'},
}
PAID_TYPES = {'payment:created', 'payment.succeeded', 'payment.completed', 'payment:succeeded'}


def to_minor(amount: Decimal) -> int:
    return int((Decimal(amount) * 100).to_integral_value())


def _tracker_from(payload: dict) -> str:
    candidates = [
        (payload.get('notification') or {}).get('tracker'),
        payload.get('tracker'),
    ]
    data = payload.get('data')
    if isinstance(data, dict):
        tracker = data.get('tracker')
        candidates.append(tracker.get('token') if isinstance(tracker, dict) else tracker)
        candidates.append((data.get('notification') or {}).get('tracker') if isinstance(data.get('notification'), dict) else None)
    for value in candidates:
        if isinstance(value, str) and value.startswith('track_'):
            return value
    return ''


class Safepay(GatewayProvider):
    key = 'safepay'
    name = 'Safepay'
    description = 'Cards and Pakistani bank accounts and wallets through Safepay Checkout.'
    countries = ('PK',)
    currencies = ('PKR',)
    methods = ('Visa / Mastercard', 'UnionPay', 'Bank accounts')
    docs_url = 'https://safepay-docs.netlify.app/build-your-integration/express-checkout/?platform=web'
    signup_url = 'https://getsafepay.com/'
    keys_help = 'Safepay Dashboard → Developers → API keys: the API key (sec_…) and the secret key. Sandbox and live keys differ.'
    webhook_help = 'Safepay Dashboard → Developers → Endpoints → Add an endpoint with the URL below, subscribe to payment events, then paste the webhook shared secret here.'
    credential_fields = (
        CredentialField('api_key', 'API key', secret=False, placeholder='sec_…', help='Safepay calls this the public merchant API key.'),
        CredentialField('secret_key', 'Secret key'),
        CredentialField('webhook_secret', 'Webhook shared secret'),
    )

    def _hosts(self, connection):
        return HOSTS['live' if connection.mode == 'live' else 'sandbox']

    def _call(self, method, connection, path, credentials, **kwargs):
        response = self.request(method, f'{self._hosts(connection)["api"]}{path}',
                                headers={'X-SFPY-MERCHANT-SECRET': credentials['secret_key'], 'Content-Type': 'application/json',
                                         'Accept': 'application/json'}, **kwargs)
        data = self.json_or_empty(response)
        if response.status_code >= 400:
            errors = (data.get('status') or {}).get('errors') if isinstance(data.get('status'), dict) else None
            detail = '; '.join(str(e) for e in errors or []) or str(data.get('message') or f'HTTP {response.status_code}')
            raise GatewayError(f'Safepay said: {detail}', status=400 if response.status_code in (401, 403) else 502)
        return data

    def _passport(self, connection, credentials) -> str:
        token = self._call('POST', connection, '/client/passport/v1/token', credentials).get('data')
        if not isinstance(token, str) or not token:
            raise GatewayError('Safepay didn’t accept the secret key.', status=400)
        return token

    def test_connection(self, connection, credentials):
        self._passport(connection, credentials)
        return {}

    def create_checkout(self, *, connection, credentials, checkout, invoice, urls, customer):
        body = {'merchant_api_key': credentials['api_key'], 'intent': 'CYBERSOURCE', 'mode': 'payment', 'currency': 'PKR',
                'amount': to_minor(checkout.amount), 'metadata': {'order_id': str(checkout.id), 'invoice': invoice.number}}
        data = self._call('POST', connection, '/order/payments/v3/', credentials, json=body)
        tracker = ((data.get('data') or {}).get('tracker') or {}).get('token')
        if not tracker:
            raise GatewayError('Safepay didn’t return a payment session.')
        hosts = self._hosts(connection)
        from urllib.parse import urlencode
        query = urlencode({'environment': hosts['env'], 'tracker': tracker, 'tbt': self._passport(connection, credentials),
                           'source': 'hosted', 'redirect_url': urls['success'], 'cancel_url': urls['cancel']})
        return f'{hosts["checkout"]}?{query}', tracker

    def verify_webhook(self, *, connection, credentials, request):
        signature = (request.META.get('HTTP_X_SFPY_SIGNATURE') or '').strip()
        secret = credentials.get('webhook_secret') or ''
        if not signature or not secret:
            raise WebhookRejected('missing signature')
        if signature.startswith('sha256='):
            timestamp = request.META.get('HTTP_X_SFPY_TIMESTAMP') or ''
            try:
                key = base64.b64decode(secret, validate=True)
            except (binascii.Error, ValueError):
                key = secret.encode()
            expected = 'sha256=' + hmac.new(key, f'{timestamp}.'.encode() + request.body, hashlib.sha256).hexdigest()
        else:
            expected = hmac.new(secret.encode(), request.body, hashlib.sha512).hexdigest()
        if not timestamp_ok(signature, request) or not hmac.compare_digest(expected, signature.lower()):
            raise WebhookRejected('bad signature')
        try:
            payload = json.loads(request.body)
        except ValueError as exc:
            raise WebhookRejected('bad json') from exc
        payload['_event_id'] = request.META.get('HTTP_X_SFPY_EVENT_ID') or ''
        payload['_event_type'] = request.META.get('HTTP_X_SFPY_EVENT_TYPE') or ''
        return payload

    def _tracker_event(self, connection, credentials, tracker, *, event_id, type_):
        data = self._call('GET', connection, f'/reporter/api/v1/payments/{tracker}', credentials)
        found = (data.get('data') or {}).get('tracker') or {}
        if found.get('token') and found['token'] != tracker:
            raise WebhookRejected('tracker mismatch')
        paid = found.get('state') == 'TRACKER_ENDED'
        quote = (found.get('purchase_totals') or {}).get('quote_amount') or {}
        amount = Decimal(quote.get('amount') or 0) / 100 if paid else None
        return PaymentEvent(event_id=event_id, type=type_, paid=paid, provider_reference=tracker,
                            amount=amount, currency=str(quote.get('currency') or '').upper())

    def parse_event(self, *, connection, credentials, payload):
        type_ = str(payload.get('type') or payload.get('_event_type') or '')
        tracker = _tracker_from(payload)
        event_id = str(payload.get('_event_id') or payload.get('token') or (f'{type_}:{tracker}' if tracker else ''))
        state = str((payload.get('notification') or {}).get('state') or '').upper()
        if not tracker or (type_ not in PAID_TYPES and state != 'PAID'):
            return PaymentEvent(event_id=event_id, type=type_, paid=False)
        return self._tracker_event(connection, credentials, tracker, event_id=event_id, type_=type_)

    def confirm_return(self, *, connection, credentials, checkout, request):
        if not checkout.provider_reference:
            return None
        return self._tracker_event(connection, credentials, checkout.provider_reference, event_id=f'return:{checkout.id}', type_='return')


def timestamp_ok(signature, request) -> bool:
    """The sha256= format signs a timestamp: refuse ones more than 5 minutes old (replays)."""
    if not signature.startswith('sha256='):
        return True
    from datetime import datetime, timezone as tz
    raw = (request.META.get('HTTP_X_SFPY_TIMESTAMP') or '').replace('Z', '+00:00')
    try:
        sent = datetime.fromisoformat(raw)
    except ValueError:
        return False
    if sent.tzinfo is None:
        sent = sent.replace(tzinfo=tz.utc)
    return abs((datetime.now(tz.utc) - sent).total_seconds()) <= 300
