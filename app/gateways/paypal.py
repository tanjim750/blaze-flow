"""PayPal (worldwide, many currencies): Orders API v2 checkout + verified webhooks.

Each agency creates a REST app in its own PayPal Business account and pastes the app's Client ID
and Secret, plus the Webhook ID of the webhook it adds for our URL.

Docs (checked 27 Oct 2026):
- OAuth 2.0 access token: https://developer.paypal.com/api/rest/authentication/
  POST /v1/oauth2/token, HTTP Basic client_id:secret, grant_type=client_credentials.
- Create order: https://developer.paypal.com/api/orders/v2/orders-create
  POST /v2/checkout/orders, intent CAPTURE, purchase_units[].amount {currency_code, value},
  ``payment_source.paypal.experience_context`` {return_url, cancel_url, user_action PAY_NOW,
  shipping_preference NO_SHIPPING}. Redirect to the HATEOAS link ``payer-action`` (or ``approve``).
- Capture order: https://developer.paypal.com/api/orders/v2/orders-capture
  POST /v2/checkout/orders/{id}/capture with a ``PayPal-Request-Id`` so a retry is idempotent.
- Verify webhook signature: https://developer.paypal.com/api/webhooks/v1/definitions/verify_webhook_signature
  POST /v1/notifications/verify-webhook-signature {auth_algo, cert_url, transmission_id,
  transmission_sig, transmission_time, webhook_id, webhook_event} -> verification_status SUCCESS.
- Supported currencies: https://developer.paypal.com/api/rest/reference/currency-codes/
  (HUF, JPY and TWD take no decimals).
- Events: CHECKOUT.ORDER.APPROVED (we capture) and PAYMENT.CAPTURE.COMPLETED (we record).
"""
from __future__ import annotations

import json
from decimal import Decimal

from .base import CredentialField, GatewayError, GatewayProvider, PaymentEvent, WebhookRejected

API = {'live': 'https://api-m.paypal.com', 'sandbox': 'https://api-m.sandbox.paypal.com'}
CURRENCIES = ('AUD', 'BRL', 'CAD', 'CNY', 'CZK', 'DKK', 'EUR', 'HKD', 'HUF', 'ILS', 'JPY', 'MYR', 'MXN', 'TWD', 'NZD', 'NOK',
              'PHP', 'PLN', 'GBP', 'SGD', 'SEK', 'CHF', 'THB', 'USD')
NO_DECIMALS = {'HUF', 'JPY', 'TWD'}
APPROVED = 'CHECKOUT.ORDER.APPROVED'
CAPTURED = 'PAYMENT.CAPTURE.COMPLETED'


def paypal_value(amount: Decimal, currency: str) -> str:
    amount = Decimal(amount)
    if currency.upper() in NO_DECIMALS:
        return str(amount.quantize(Decimal('1')))
    return str(amount.quantize(Decimal('0.01')))


class PayPal(GatewayProvider):
    key = 'paypal'
    name = 'PayPal'
    description = 'Clients pay with their PayPal balance or a card through PayPal checkout.'
    countries = ()  # offered everywhere PayPal Business accounts can receive money
    currencies = CURRENCIES
    methods = ('PayPal', 'Cards')
    docs_url = 'https://developer.paypal.com/api/orders/v2/'
    signup_url = 'https://www.paypal.com/business'
    keys_help = ('developer.paypal.com → Apps & Credentials → pick Sandbox or Live → Create App (Merchant). '
                 'Copy the Client ID and Secret.')
    webhook_help = ('In the same app: Webhooks → Add Webhook with the URL below, events CHECKOUT.ORDER.APPROVED and '
                    'PAYMENT.CAPTURE.COMPLETED. Paste the Webhook ID here.')
    credential_fields = (
        CredentialField('client_id', 'Client ID', secret=False, placeholder='AbC…'),
        CredentialField('client_secret', 'Secret', placeholder='EFg…'),
        CredentialField('webhook_id', 'Webhook ID', secret=False, required=False, placeholder='8PT597110X687430LKGECATA',
                        help='Save the Client ID and Secret first to get your webhook URL, then add the webhook in PayPal and paste its ID.'),
    )
    # Not supported for receiving by PayPal Business in these countries (paypal.com/worldwide).
    unsupported_countries = ('BD', 'PK')

    def _base(self, connection):
        return API['live' if connection.mode == 'live' else 'sandbox']

    def _token(self, connection, credentials):
        response = self.request('POST', f'{self._base(connection)}/v1/oauth2/token',
                                auth=(credentials['client_id'], credentials['client_secret']),
                                data={'grant_type': 'client_credentials'}, headers={'Accept': 'application/json'})
        data = self.json_or_empty(response)
        if response.status_code >= 400 or not data.get('access_token'):
            raise GatewayError('PayPal didn’t accept the Client ID and Secret. Check you used the '
                               f'{"Live" if connection.mode == "live" else "Sandbox"} app’s credentials.', status=400)
        return data['access_token']

    def _call(self, connection, credentials, method, path, *, token=None, **kwargs):
        token = token or self._token(connection, credentials)
        headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json', 'Accept': 'application/json',
                   **kwargs.pop('headers', {})}
        response = self.request(method, f'{self._base(connection)}{path}', headers=headers, **kwargs)
        data = self.json_or_empty(response)
        if response.status_code >= 400:
            details = data.get('details') or []
            issue = '; '.join(str(d.get('issue') or d.get('description')) for d in details if isinstance(d, dict))
            detail = issue or data.get('message') or data.get('name') or f'HTTP {response.status_code}'
            raise GatewayError(f'PayPal said: {detail}', status=400 if response.status_code in (401, 403) else 502)
        return data, response.status_code

    def test_connection(self, connection, credentials):
        token = self._token(connection, credentials)
        if not credentials.get('webhook_id'):
            raise GatewayError('Client ID and Secret work. Now add the webhook in PayPal (URL below) and paste its Webhook ID.', status=400)
        hook, _ = self._call(connection, credentials, 'GET', f'/v1/notifications/webhooks/{credentials["webhook_id"]}', token=token)
        events = {e.get('name') for e in hook.get('event_types') or [] if isinstance(e, dict)}
        missing = [e for e in (APPROVED, CAPTURED) if e not in events and '*' not in events]
        if missing:
            raise GatewayError(f'The PayPal webhook isn’t subscribed to {", ".join(missing)}. Add the event(s) and test again.', status=400)
        return {'webhook_url': hook.get('url') or ''}

    def create_checkout(self, *, connection, credentials, checkout, invoice, urls, customer):
        currency = checkout.currency.upper()
        body = {
            'intent': 'CAPTURE',
            'purchase_units': [{
                'reference_id': str(checkout.id), 'custom_id': str(checkout.id),
                'invoice_id': f'{invoice.number}-{str(checkout.id)[:8]}'[:127],
                'description': f'Invoice {invoice.number}'[:127],
                'amount': {'currency_code': currency, 'value': paypal_value(checkout.amount, currency)},
            }],
            'payment_source': {'paypal': {'experience_context': {
                'return_url': urls['success'], 'cancel_url': urls['cancel'],
                'user_action': 'PAY_NOW', 'shipping_preference': 'NO_SHIPPING',
            }}},
        }
        if customer.get('email'):
            body['payment_source']['paypal']['email_address'] = customer['email']
        data, _ = self._call(connection, credentials, 'POST', '/v2/checkout/orders', json=body,
                             headers={'PayPal-Request-Id': f'create-{checkout.id}'})
        links = {l.get('rel'): l.get('href') for l in data.get('links') or [] if isinstance(l, dict)}
        url = links.get('payer-action') or links.get('approve')
        if not data.get('id') or not url:
            raise GatewayError('PayPal didn’t return a checkout page.')
        return url, data['id']

    def verify_webhook(self, *, connection, credentials, request):
        meta = request.META
        headers = {k: meta.get(f'HTTP_PAYPAL_{k.upper()}') or '' for k in
                   ('auth_algo', 'cert_url', 'transmission_id', 'transmission_sig', 'transmission_time')}
        if not all(headers.values()):
            raise WebhookRejected('missing signature headers')
        try:
            event = json.loads(request.body)
        except ValueError as exc:
            raise WebhookRejected('bad json') from exc
        try:
            data, _ = self._call(connection, credentials, 'POST', '/v1/notifications/verify-webhook-signature',
                                 json={**headers, 'webhook_id': credentials.get('webhook_id') or '', 'webhook_event': event})
        except GatewayError as exc:
            if exc.status == 400:
                raise WebhookRejected('verify call refused') from exc
            raise
        if data.get('verification_status') != 'SUCCESS':
            raise WebhookRejected('bad signature')
        return event

    @staticmethod
    def _completed(captures):
        done = [c for c in captures if c.get('status') == 'COMPLETED']
        currencies = {str((c.get('amount') or {}).get('currency_code') or '').upper() for c in done}
        amount = sum((Decimal(str((c.get('amount') or {}).get('value') or 0)) for c in done), Decimal(0))
        return done, amount, (currencies.pop() if len(currencies) == 1 else ('MIXED' if currencies else ''))

    def _capture(self, connection, credentials, order_id, *, event_id, type_):
        """Capture an approved order (idempotent request id), or read it if already captured."""
        token = self._token(connection, credentials)
        order, _ = self._call(connection, credentials, 'GET', f'/v2/checkout/orders/{order_id}', token=token)
        if order.get('status') == 'APPROVED':
            order, _ = self._call(connection, credentials, 'POST', f'/v2/checkout/orders/{order_id}/capture', token=token,
                                  json={}, headers={'PayPal-Request-Id': f'capture-{order_id}'})
        units = order.get('purchase_units') or []
        captures = [c for u in units for c in ((u.get('payments') or {}).get('captures') or [])]
        done, amount, currency = self._completed(captures)
        return PaymentEvent(event_id=event_id, type=type_, paid=bool(done) and order.get('status') == 'COMPLETED',
                            checkout_id=(units[0].get('custom_id') if units else None), provider_reference=order.get('id') or order_id,
                            amount=amount if done else None, currency=currency, extra={'capture_ids': [c.get('id') for c in done]})

    def parse_event(self, *, connection, credentials, payload):
        type_ = str(payload.get('event_type') or '')
        event_id = str(payload.get('id') or '')
        resource = payload.get('resource') or {}
        if type_ == APPROVED and resource.get('id'):
            return self._capture(connection, credentials, resource['id'], event_id=event_id, type_=type_)
        if type_ == CAPTURED:
            order_id = ((resource.get('supplementary_data') or {}).get('related_ids') or {}).get('order_id')
            if not order_id:
                return PaymentEvent(event_id=event_id, type=type_, paid=False)
            done, amount, currency = self._completed([resource])
            return PaymentEvent(event_id=event_id, type=type_, paid=bool(done), checkout_id=resource.get('custom_id'),
                                provider_reference=order_id, amount=amount if done else None, currency=currency,
                                extra={'capture_ids': [resource.get('id')]})
        return PaymentEvent(event_id=event_id, type=type_, paid=False)

    def confirm_return(self, *, connection, credentials, checkout, request):
        order_id = request.GET.get('token') or checkout.provider_reference
        if not order_id or order_id != checkout.provider_reference:
            return None
        return self._capture(connection, credentials, order_id, event_id=f'return:{checkout.id}', type_='return')
