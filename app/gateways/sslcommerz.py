"""SSLCOMMERZ (Bangladesh, BDT): session API + IPN, every payment checked with the validation API.

Docs (checked 27 Oct 2026): https://developer.sslcommerz.com/doc/v4/
- Create session: POST {base}/gwprocess/v4/api.php (form) with store_id, store_passwd,
  total_amount (10.00–500000.00 BDT), currency, tran_id, success/fail/cancel/ipn URLs, customer
  and product fields -> status SUCCESS + GatewayPageURL.
- IPN: SSLCOMMERZ POSTs status (VALID / FAILED / CANCELLED / EXPIRED / UNATTEMPTED), tran_id,
  val_id, amount, currency_type, currency_amount, verify_sign, verify_key ... to ipn_url.
  verify_sign = md5 of the sorted ``key=value&`` string of the verify_key fields plus
  store_passwd=md5(store_passwd) (official SSLCOMMERZ PHP/Python libraries).
- Order validation API: GET {base}/validator/api/validationserverAPI.php?val_id=&store_id=
  &store_passwd=&format=json -> status VALID / VALIDATED / INVALID_TRANSACTION. We never mark
  anything paid without it, and check tran_id, amount and currency against our checkout.
- Transaction query by tran_id: GET {base}/validator/api/merchantTransIDvalidationAPI.php
  (used for Test connection and when the payer returns before the IPN arrives).
"""
from __future__ import annotations

import hashlib
import hmac
from decimal import Decimal, InvalidOperation

from .base import CredentialField, GatewayError, GatewayProvider, PaymentEvent, WebhookRejected

HOSTS = {'sandbox': 'https://sandbox.sslcommerz.com', 'live': 'https://securepay.sslcommerz.com'}
VALID = {'VALID', 'VALIDATED'}


def tran_id_for(checkout) -> str:
    return checkout.id.hex[:30]  # SSLCOMMERZ allows 30 characters


def verify_sign_ok(post: dict, store_passwd: str) -> bool:
    keys = [k for k in str(post.get('verify_key') or '').split(',') if k]
    signature = str(post.get('verify_sign') or '')
    if not keys or not signature:
        return False
    fields = {k: str(post.get(k, '')) for k in keys}
    fields['store_passwd'] = hashlib.md5(store_passwd.encode()).hexdigest()
    message = '&'.join(f'{k}={fields[k]}' for k in sorted(fields))
    return hmac.compare_digest(hashlib.md5(message.encode()).hexdigest(), signature)


def _decimal(value):
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError):
        return None


class SSLCommerz(GatewayProvider):
    key = 'sslcommerz'
    name = 'SSLCOMMERZ'
    description = 'bKash, Nagad, Rocket, cards and internet banking for Bangladesh.'
    countries = ('BD',)
    currencies = ('BDT',)
    methods = ('bKash', 'Nagad', 'Rocket', 'Cards', 'Internet banking')
    docs_url = 'https://developer.sslcommerz.com/doc/v4/'
    signup_url = 'https://signup.sslcommerz.com/register'
    keys_help = 'SSLCOMMERZ emails your Store ID and Store Password when the store is approved (sandbox: developer.sslcommerz.com/registration).'
    webhook_help = 'Krewsys sends this IPN URL with every payment. You can also set it in the SSLCOMMERZ merchant panel → My Stores → IPN Settings.'
    webhook_in_dashboard = False
    min_amount = Decimal('10.00')
    max_amount = Decimal('500000.00')
    credential_fields = (
        CredentialField('store_id', 'Store ID', secret=False),
        CredentialField('store_passwd', 'Store password'),
    )

    def _base(self, connection):
        return HOSTS['live' if connection.mode == 'live' else 'sandbox']

    def _get(self, connection, path, params):
        response = self.request('GET', f'{self._base(connection)}{path}', params={**params, 'format': 'json'})
        if response.status_code >= 400:
            raise GatewayError(f'SSLCOMMERZ answered HTTP {response.status_code}.')
        return self.json_or_empty(response)

    def _query(self, connection, credentials, tran_id):
        return self._get(connection, '/validator/api/merchantTransIDvalidationAPI.php',
                         {'tran_id': tran_id, 'store_id': credentials['store_id'], 'store_passwd': credentials['store_passwd']})

    def test_connection(self, connection, credentials):
        data = self._query(connection, credentials, 'blazeflow-connection-test')
        if str(data.get('APIConnect') or '').upper() != 'DONE':
            raise GatewayError(f'SSLCOMMERZ didn’t accept this Store ID / password ({data.get("APIConnect") or "no answer"}).', status=400)
        return {}

    def create_checkout(self, *, connection, credentials, checkout, invoice, urls, customer):
        tran_id = tran_id_for(checkout)
        form = {
            'store_id': credentials['store_id'], 'store_passwd': credentials['store_passwd'],
            'total_amount': f'{checkout.amount:.2f}', 'currency': 'BDT', 'tran_id': tran_id,
            'success_url': urls['success'], 'fail_url': urls['fail'], 'cancel_url': urls['cancel'], 'ipn_url': urls['webhook'],
            'cus_name': (customer.get('name') or 'Client')[:50], 'cus_email': customer.get('email') or 'not-provided@invalid',
            'cus_add1': 'Not provided', 'cus_city': 'Not provided', 'cus_postcode': '0000', 'cus_country': 'Bangladesh',
            'cus_phone': customer.get('phone') or 'Not provided',
            'shipping_method': 'NO', 'num_of_item': 1, 'product_name': f'Invoice {invoice.number}'[:255],
            'product_category': 'Services', 'product_profile': 'non-physical-goods',
            'value_a': str(checkout.id), 'value_b': str(invoice.id),
        }
        response = self.request('POST', f'{self._base(connection)}/gwprocess/v4/api.php', data=form)
        data = self.json_or_empty(response)
        if str(data.get('status') or '').upper() != 'SUCCESS' or not data.get('GatewayPageURL'):
            raise GatewayError(f'SSLCOMMERZ said: {data.get("failedreason") or "the payment session could not be created"}.')
        return data['GatewayPageURL'], tran_id

    def verify_webhook(self, *, connection, credentials, request):
        post = {k: request.POST.get(k) for k in request.POST}
        if not post.get('tran_id') or not verify_sign_ok(post, credentials['store_passwd']):
            raise WebhookRejected('bad verify_sign')
        return post

    def _validated(self, connection, credentials, *, val_id, tran_id, event_id, type_):
        data = self._get(connection, '/validator/api/validationserverAPI.php',
                         {'val_id': val_id, 'store_id': credentials['store_id'], 'store_passwd': credentials['store_passwd']})
        status = str(data.get('status') or '').upper()
        if status not in VALID:
            return PaymentEvent(event_id=event_id, type=type_, paid=False, provider_reference=tran_id)
        if str(data.get('tran_id') or '') != tran_id:
            raise WebhookRejected('tran_id mismatch')
        currency = str(data.get('currency_type') or data.get('currency') or '').upper()
        amount = _decimal(data.get('currency_amount') or data.get('amount'))
        return PaymentEvent(event_id=event_id, type=type_, paid=amount is not None, provider_reference=tran_id, amount=amount,
                            currency=currency, extra={'val_id': val_id, 'risk_level': data.get('risk_level')})

    def parse_event(self, *, connection, credentials, payload):
        tran_id = str(payload.get('tran_id') or '')
        val_id = str(payload.get('val_id') or '')
        status = str(payload.get('status') or '').upper()
        event_id = f'ipn:{val_id or tran_id}:{status}'
        if status != 'VALID' or not val_id:
            return PaymentEvent(event_id=event_id, type=f'ipn.{status.lower()}', paid=False, provider_reference=tran_id)
        return self._validated(connection, credentials, val_id=val_id, tran_id=tran_id, event_id=event_id, type_='ipn.valid')

    def confirm_return(self, *, connection, credentials, checkout, request):
        tran_id = checkout.provider_reference
        data = self._query(connection, credentials, tran_id)
        for element in data.get('element') or []:
            if str(element.get('status') or '').upper() in VALID and element.get('val_id'):
                return self._validated(connection, credentials, val_id=str(element['val_id']), tran_id=tran_id,
                                       event_id=f'return:{checkout.id}', type_='return')
        return None
