"""Local gateways (PayMongo, Safepay, SSLCOMMERZ): keys, Pay now, webhooks/IPN. All HTTP is mocked."""
import base64
import hashlib
import hmac
import json
import time
from decimal import Decimal
from unittest import mock

from cryptography.fernet import Fernet
from django.test import TestCase, override_settings
from django.urls import reverse

from .gateways import crypto
from .gateways.sslcommerz import tran_id_for
from .models import (
    AuditLog, GatewayCheckout, GatewayConnection, GatewayWebhookEvent, Invoice, Payment, WorkspaceBillingSettings,
)
from .permissions import BILLING_MANAGE, BILLING_VIEW, MEMBER_PERMISSION_KEYS
from .services import online_payments, stripe_connect
from .test_billing import BillingBase

# A fresh throwaway key per run, so tests pass under any settings module (CI uses settings.py).
APP = dict(
    APP_BASE_URL='https://app.example.test',
    API_PUBLIC_URL='https://api.example.test',
    GATEWAY_ENCRYPTION_KEY=Fernet.generate_key().decode(),
)


class FakeResponse:
    def __init__(self, data, status=200):
        self.status_code = status
        self._data = data

    def json(self):
        return self._data


class FakeHTTP:
    """Routes ``requests.request`` by (method, url substring) to canned answers, and records calls."""

    def __init__(self):
        self.routes = []
        self.calls = []

    def on(self, method, fragment, data, status=200):
        self.routes.insert(0, (method, fragment, data, status))

    def __call__(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        for m, fragment, data, status in self.routes:
            if m == method and fragment in url:
                return FakeResponse(data(kwargs) if callable(data) else data, status)
        raise AssertionError(f'unexpected {method} {url}')

    def called(self, fragment):
        return [c for c in self.calls if fragment in c[1]]


class GatewayBase(BillingBase):
    currency = 'PHP'

    def setUp(self):
        super().setUp()
        cfg = override_settings(**APP)
        cfg.enable()
        self.addCleanup(cfg.disable)
        self.http = FakeHTTP()
        patcher = mock.patch('app.gateways.base.requests.request', self.http)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.as_user(self.owner)
        response = self.client.patch(self.url('api-billing-settings'), {'currency': self.currency}, format='json')
        self.assertEqual(response.status_code, 200, response.content)

    def gw(self, name, provider, *extra):
        return reverse(name, args=[self.workspace.id, provider, *extra])

    def save_keys(self, provider, credentials, mode='sandbox', expect=200):
        self.as_user(self.owner)
        response = self.client.put(self.gw('api-billing-gateway', provider), {'mode': mode, 'credentials': credentials}, format='json')
        self.assertEqual(response.status_code, expect, response.content)
        return response.json()

    def connect(self, provider, credentials, mode='sandbox'):
        self.save_keys(provider, credentials, mode)
        tested = self.client.post(self.gw('api-billing-gateway-test', provider)).json()
        self.assertEqual(tested['connection_status'], 'connected', tested)
        enabled = self.client.post(self.gw('api-billing-gateway-enable', provider), {'enabled': True}, format='json')
        self.assertEqual(enabled.status_code, 200, enabled.content)
        return GatewayConnection.objects.get(workspace=self.workspace, provider=provider)

    def sent_invoice(self):
        self.priced_project()
        return Invoice.objects.get(id=self.invoice()['id'])

    def detail(self, invoice):
        self.as_user(self.owner)
        return self.client.get(self.url('api-billing-invoice-detail', invoice.id)).json()

    def pay_now(self, invoice, provider, expect=200):
        self.as_user(self.owner)
        response = self.client.post(self.url('api-billing-invoice-checkout', invoice.id), {'provider': provider}, format='json')
        self.assertEqual(response.status_code, expect, response.content)
        return response.json()


# --- PayMongo ---------------------------------------------------------------------------------

PM_KEYS = {'secret_key': 'sk_test_abcdefgh12345678', 'webhook_secret': 'whsk_test_secret_9999'}


def paymongo_signed(payload, secret=PM_KEYS['webhook_secret'], live=False):
    body = json.dumps(payload)
    t = str(int(time.time()))
    sig = hmac.new(secret.encode(), f'{t}.{body}'.encode(), hashlib.sha256).hexdigest()
    return body, f't={t},te={"" if live else sig},li={sig if live else ""}'


class PayMongoTests(GatewayBase, TestCase):
    def setUp(self):
        super().setUp()
        self.http.on('GET', '/merchants/capabilities/payment_methods', {'data': ['card', 'gcash', 'paymaya', 'qrph', 'unknown_x']})
        self.http.on('POST', '/checkout_sessions', {'data': {'id': 'cs_pm_1', 'attributes': {'checkout_url': 'https://checkout.paymongo.com/cs_pm_1'}}})

    def session(self, checkout_id, amount=140000, status='paid', currency='PHP'):
        return {'data': {'id': 'cs_pm_1', 'attributes': {'reference_number': str(checkout_id), 'metadata': {'blazeflow_checkout_id': str(checkout_id)},
                'payments': [{'id': 'pay_1', 'attributes': {'status': status, 'amount': amount, 'currency': currency}}]}}}

    def event(self, event_id='evt_pm_1', livemode=False):
        return {'data': {'id': event_id, 'attributes': {'type': 'checkout_session.payment.paid', 'livemode': livemode,
                                                         'data': {'id': 'cs_pm_1'}}}}

    def webhook(self, connection, payload, header=None, **kw):
        body, sig = paymongo_signed(payload, **kw)
        return self.client.generic('POST', reverse('api-gateway-webhook', args=['paymongo', connection.id]), body,
                                   content_type='application/json', HTTP_PAYMONGO_SIGNATURE=header if header is not None else sig)

    def test_checkout_uses_centavos_php_and_the_tested_methods(self):
        connection = self.connect('paymongo', PM_KEYS)
        self.assertEqual(connection.details['payment_methods'], ['card', 'gcash', 'paymaya', 'qrph'])
        invoice = self.sent_invoice()
        detail = self.detail(invoice)
        self.assertEqual([o['provider'] for o in detail['payment_options']], ['paymongo'])
        self.assertTrue(detail['online_payment']['available'])
        self.assertEqual(self.pay_now(invoice, 'paymongo')['url'], 'https://checkout.paymongo.com/cs_pm_1')
        method, url, kwargs = self.http.called('/checkout_sessions')[0]
        attrs = kwargs['json']['data']['attributes']
        self.assertEqual(attrs['line_items'][0]['amount'], 140000)
        self.assertEqual(attrs['line_items'][0]['currency'], 'PHP')
        self.assertEqual(attrs['payment_method_types'], ['card', 'gcash', 'paymaya', 'qrph'])
        checkout = GatewayCheckout.objects.get()
        self.assertEqual((checkout.provider_reference, checkout.amount), ('cs_pm_1', Decimal('1400.00')))
        self.assertTrue(attrs['success_url'].startswith(f'https://api.example.test/api/payments/return/{checkout.id}/success/'))
        self.assertEqual(kwargs['auth'], (PM_KEYS['secret_key'], ''))
        self.assertTrue(AuditLog.objects.filter(action='billing.paymongo.checkout_created').exists())

    def test_signed_webhook_records_once_and_rechecks_the_session(self):
        connection = self.connect('paymongo', PM_KEYS)
        invoice = self.sent_invoice()
        self.pay_now(invoice, 'paymongo')
        checkout = GatewayCheckout.objects.get()
        self.http.on('GET', '/checkout_sessions/cs_pm_1', self.session(checkout.id))
        self.client.force_authenticate(None)
        response = self.webhook(connection, self.event())
        self.assertEqual(response.json()['outcome'], 'payment_recorded', response.content)
        payment = Payment.objects.get()
        self.assertEqual((payment.provider, payment.provider_reference, payment.amount), ('paymongo', 'cs_pm_1', Decimal('1400.00')))
        self.assertEqual(Invoice.objects.get(id=invoice.id).status, 'paid')
        # Same event again, and a different event for the same session: still one payment.
        self.assertEqual(self.webhook(connection, self.event()).json()['outcome'], 'duplicate')
        self.assertEqual(self.webhook(connection, self.event('evt_pm_2')).json()['outcome'], 'duplicate_payment')
        self.assertEqual(Payment.objects.count(), 1)

    def test_bad_signature_wrong_secret_and_live_mode_mismatch_are_rejected(self):
        connection = self.connect('paymongo', PM_KEYS)
        self.sent_invoice()
        self.client.force_authenticate(None)
        self.assertEqual(self.webhook(connection, self.event(), header='t=1,te=deadbeef').status_code, 400)
        self.assertEqual(self.webhook(connection, self.event(), secret='whsk_other').status_code, 400)
        self.assertEqual(self.webhook(connection, self.event(), header='').status_code, 400)
        # Signed as live for a sandbox connection: the te part is empty.
        self.assertEqual(self.webhook(connection, self.event(livemode=True), live=True).status_code, 400)
        self.assertEqual(Payment.objects.count(), 0)
        self.assertTrue(AuditLog.objects.filter(action='billing.paymongo.webhook_rejected').exists())
        bogus = reverse('api-gateway-webhook', args=['paymongo', '00000000-0000-0000-0000-000000000000'])
        self.assertEqual(self.client.post(bogus, '{}', content_type='application/json').status_code, 404)

    def test_amount_is_capped_and_currency_must_match(self):
        connection = self.connect('paymongo', PM_KEYS)
        invoice = self.sent_invoice()
        self.pay_now(invoice, 'paymongo')
        checkout = GatewayCheckout.objects.get()
        self.http.on('GET', '/checkout_sessions/cs_pm_1', self.session(checkout.id, currency='USD'))
        self.client.force_authenticate(None)
        self.assertEqual(self.webhook(connection, self.event('evt_a')).json()['outcome'], 'currency_mismatch')
        self.http.on('GET', '/checkout_sessions/cs_pm_1', self.session(checkout.id, amount=999999))
        self.assertEqual(self.webhook(connection, self.event('evt_b')).json()['outcome'], 'payment_recorded')
        self.assertEqual(Payment.objects.get().amount, Decimal('1400.00'))

    def test_return_rechecks_and_redirects_to_the_invoice(self):
        self.connect('paymongo', PM_KEYS)
        invoice = self.sent_invoice()
        self.pay_now(invoice, 'paymongo')
        checkout = GatewayCheckout.objects.get()
        self.http.on('GET', '/checkout_sessions/cs_pm_1', self.session(checkout.id))
        self.client.force_authenticate(None)
        response = self.client.get(reverse('api-gateway-return', args=[checkout.id, 'success']))
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response['Location'], f'https://app.example.test/money/invoices/{invoice.id}?payment=success&provider=paymongo')
        self.assertEqual(Payment.objects.count(), 1)
        cancel = self.client.get(reverse('api-gateway-return', args=[checkout.id, 'cancel']))
        self.assertIn('payment=cancel', cancel['Location'])
        self.assertEqual(Payment.objects.count(), 1)

    def test_live_mode_needs_a_live_key_and_currency_is_enforced(self):
        self.save_keys('paymongo', PM_KEYS, mode='live', expect=400)
        self.connect('paymongo', PM_KEYS)
        invoice = self.sent_invoice()
        Invoice.objects.filter(id=invoice.id).update(currency='USD')
        option = self.detail(invoice)['payment_options'][0]
        self.assertEqual(option['reason'], 'currency_unsupported')
        self.assertIn('PHP', option['message'])
        self.assertEqual(self.pay_now(invoice, 'paymongo', expect=409)['code'], 'currency_unsupported')
        self.assertFalse(self.http.called('/checkout_sessions'))


# --- Safepay ---------------------------------------------------------------------------------

SP_KEYS = {'api_key': 'sec_sandbox_api_key_1', 'secret_key': 'safepay-secret-123456', 'webhook_secret': 'sp-webhook-secret-7777'}


class SafepayTests(GatewayBase, TestCase):
    currency = 'PKR'

    def setUp(self):
        super().setUp()
        self.http.on('POST', '/client/passport/v1/token', {'data': 'tbt_passport_1'})
        self.http.on('POST', '/order/payments/v3/', {'data': {'tracker': {'token': 'track_abc'}}})

    def tracker(self, state='TRACKER_ENDED', amount=140000, currency='PKR'):
        return {'data': {'tracker': {'token': 'track_abc', 'state': state,
                'purchase_totals': {'quote_amount': {'amount': amount, 'currency': currency}}}}}

    def webhook(self, connection, payload, secret=SP_KEYS['webhook_secret'], signature=None, event_id='wh_1'):
        body = json.dumps(payload)
        sig = hmac.new(secret.encode(), body.encode(), hashlib.sha512).hexdigest()
        return self.client.generic('POST', reverse('api-gateway-webhook', args=['safepay', connection.id]), body,
                                   content_type='application/json', HTTP_X_SFPY_SIGNATURE=signature if signature is not None else sig,
                                   HTTP_X_SFPY_EVENT_ID=event_id)

    def test_checkout_url_and_minor_units(self):
        self.connect('safepay', SP_KEYS)
        invoice = self.sent_invoice()
        url = self.pay_now(invoice, 'safepay')['url']
        self.assertTrue(url.startswith('https://sandbox.api.getsafepay.com/embedded/?environment=sandbox&tracker=track_abc&tbt=tbt_passport_1'))
        body = self.http.called('/order/payments/v3/')[0][2]['json']
        self.assertEqual((body['amount'], body['currency'], body['merchant_api_key']), (140000, 'PKR', SP_KEYS['api_key']))
        self.assertEqual(self.http.called('/order/payments/v3/')[0][2]['headers']['X-SFPY-MERCHANT-SECRET'], SP_KEYS['secret_key'])

    def test_webhook_signature_and_tracker_recheck(self):
        connection = self.connect('safepay', SP_KEYS)
        invoice = self.sent_invoice()
        self.pay_now(invoice, 'safepay')
        payload = {'type': 'payment:created', 'notification': {'tracker': 'track_abc', 'state': 'PAID'}}
        self.client.force_authenticate(None)
        self.assertEqual(self.webhook(connection, payload, secret='wrong').status_code, 400)
        self.assertEqual(self.webhook(connection, payload, signature='').status_code, 400)
        self.http.on('GET', '/reporter/api/v1/payments/track_abc', self.tracker(state='TRACKER_STARTED'))
        self.assertEqual(self.webhook(connection, payload, event_id='wh_0').json()['outcome'], 'not_paid')
        self.http.on('GET', '/reporter/api/v1/payments/track_abc', self.tracker())
        self.assertEqual(self.webhook(connection, payload).json()['outcome'], 'payment_recorded')
        self.assertEqual(self.webhook(connection, payload).json()['outcome'], 'duplicate')
        self.assertEqual(Payment.objects.get().provider_reference, 'track_abc')

    def test_timestamped_sha256_signature(self):
        connection = self.connect('safepay', {**SP_KEYS, 'webhook_secret': base64.b64encode(b'k' * 32).decode()})
        invoice = self.sent_invoice()
        self.pay_now(invoice, 'safepay')
        self.http.on('GET', '/reporter/api/v1/payments/track_abc', self.tracker())
        body = json.dumps({'type': 'payment.succeeded', 'data': {'tracker': 'track_abc'}})
        from datetime import datetime, timedelta, timezone as tz

        def send(ts):
            sig = 'sha256=' + hmac.new(b'k' * 32, f'{ts}.{body}'.encode(), hashlib.sha256).hexdigest()
            return self.client.generic('POST', reverse('api-gateway-webhook', args=['safepay', connection.id]), body,
                                       content_type='application/json', HTTP_X_SFPY_SIGNATURE=sig, HTTP_X_SFPY_TIMESTAMP=ts,
                                       HTTP_X_SFPY_EVENT_ID='wh_ts')
        self.client.force_authenticate(None)
        self.assertEqual(send((datetime.now(tz.utc) - timedelta(minutes=10)).isoformat()).status_code, 400)
        self.assertEqual(send(datetime.now(tz.utc).isoformat()).json()['outcome'], 'payment_recorded')


# --- SSLCOMMERZ ---------------------------------------------------------------------------------

SSL_KEYS = {'store_id': 'blaze0test', 'store_passwd': 'blaze0test@ssl'}


def ipn(fields, passwd=SSL_KEYS['store_passwd']):
    keys = sorted(fields)
    data = {**fields, 'store_passwd': hashlib.md5(passwd.encode()).hexdigest()}
    message = '&'.join(f'{k}={data[k]}' for k in sorted(data))
    return {**fields, 'verify_key': ','.join(keys), 'verify_sign': hashlib.md5(message.encode()).hexdigest()}


class SSLCommerzTests(GatewayBase, TestCase):
    currency = 'BDT'

    def setUp(self):
        super().setUp()
        self.http.on('GET', 'merchantTransIDvalidationAPI.php', {'APIConnect': 'DONE', 'no_of_trans_found': 0, 'element': []})
        self.http.on('POST', '/gwprocess/v4/api.php', {'status': 'SUCCESS', 'GatewayPageURL': 'https://sandbox.sslcommerz.com/EasyCheckOut/abc', 'sessionkey': 'S1'})

    def validation(self, tran_id, status='VALID', amount='1400.00', currency='BDT'):
        return {'status': status, 'tran_id': tran_id, 'val_id': 'val_1', 'amount': amount, 'currency_type': currency,
                'currency_amount': amount, 'risk_level': '0'}

    def post_ipn(self, connection, data):
        return self.client.post(reverse('api-gateway-webhook', args=['sslcommerz', connection.id]), data)

    def test_session_form_and_ipn_url(self):
        connection = self.connect('sslcommerz', SSL_KEYS)
        invoice = self.sent_invoice()
        self.assertEqual(self.pay_now(invoice, 'sslcommerz')['url'], 'https://sandbox.sslcommerz.com/EasyCheckOut/abc')
        form = self.http.called('/gwprocess/v4/api.php')[0][2]['data']
        checkout = GatewayCheckout.objects.get()
        self.assertEqual((form['total_amount'], form['currency'], form['tran_id']), ('1400.00', 'BDT', tran_id_for(checkout)))
        self.assertEqual(form['ipn_url'], f'https://api.example.test/api/payments/sslcommerz/webhook/{connection.id}/')
        self.assertEqual(checkout.provider_reference, tran_id_for(checkout))

    def test_ipn_needs_a_valid_sign_and_the_validation_api(self):
        connection = self.connect('sslcommerz', SSL_KEYS)
        invoice = self.sent_invoice()
        self.pay_now(invoice, 'sslcommerz')
        tran = GatewayCheckout.objects.get().provider_reference
        fields = {'status': 'VALID', 'tran_id': tran, 'val_id': 'val_1', 'amount': '1400.00', 'currency': 'BDT'}
        self.client.force_authenticate(None)
        self.assertEqual(self.post_ipn(connection, ipn(fields, passwd='wrong')).status_code, 400)
        self.assertEqual(self.post_ipn(connection, fields).status_code, 400)
        self.http.on('GET', 'validationserverAPI.php', self.validation(tran, status='INVALID_TRANSACTION'))
        self.assertEqual(self.post_ipn(connection, ipn(fields)).json()['outcome'], 'not_paid')
        GatewayWebhookEvent.objects.all().delete()
        self.http.on('GET', 'validationserverAPI.php', self.validation('other'))
        self.assertEqual(self.post_ipn(connection, ipn(fields)).status_code, 400)
        self.http.on('GET', 'validationserverAPI.php', self.validation(tran))
        self.assertEqual(self.post_ipn(connection, ipn(fields)).json()['outcome'], 'payment_recorded')
        self.assertEqual(self.post_ipn(connection, ipn(fields)).json()['outcome'], 'duplicate')
        self.assertEqual(Payment.objects.get().provider_reference, tran)

    def test_success_post_back_is_validated_server_side(self):
        self.connect('sslcommerz', SSL_KEYS)
        invoice = self.sent_invoice()
        self.pay_now(invoice, 'sslcommerz')
        checkout = GatewayCheckout.objects.get()
        tran = checkout.provider_reference
        self.http.on('GET', 'merchantTransIDvalidationAPI.php', {'APIConnect': 'DONE', 'element': [{'status': 'VALIDATED', 'val_id': 'val_9'}]})
        self.http.on('GET', 'validationserverAPI.php', self.validation(tran))
        self.client.force_authenticate(None)
        # Whatever the browser posts, we ask SSLCOMMERZ.
        response = self.client.post(reverse('api-gateway-return', args=[checkout.id, 'success']), {'status': 'VALID', 'amount': '1'})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(Payment.objects.get().amount, Decimal('1400.00'))

    def test_failed_connection_test_keeps_it_off(self):
        self.save_keys('sslcommerz', SSL_KEYS)
        self.http.on('GET', 'merchantTransIDvalidationAPI.php', {'APIConnect': 'INVALID_REQUEST'})
        tested = self.client.post(self.gw('api-billing-gateway-test', 'sslcommerz')).json()
        self.assertEqual(tested['connection_status'], 'failed')
        self.assertIn('INVALID_REQUEST', tested['status_message'])
        response = self.client.post(self.gw('api-billing-gateway-enable', 'sslcommerz'), {'enabled': True}, format='json')
        self.assertEqual(response.status_code, 409)


# --- shared: secrets, permissions, chooser, recommendations ------------------------------------

class SharedTests(GatewayBase, TestCase):
    def test_secrets_are_encrypted_at_rest_and_masked(self):
        out = self.save_keys('paymongo', PM_KEYS)
        self.assertEqual(out['credentials']['secret_key'], '••••5678')
        self.assertEqual(out['credentials']['webhook_secret'], '••••9999')
        stored = GatewayConnection.objects.get().credentials
        self.assertNotIn('sk_test', stored)
        self.assertEqual(crypto.decrypt(stored), PM_KEYS)
        settings_out = json.dumps(self.client.get(self.url('api-billing-settings')).json())
        for secret in PM_KEYS.values():
            self.assertNotIn(secret, settings_out)
        # Saving with blank secret fields keeps the stored values.
        self.save_keys('paymongo', {'secret_key': '', 'webhook_secret': ''})
        self.assertEqual(crypto.decrypt(GatewayConnection.objects.get().credentials), PM_KEYS)
        self.assertFalse(any('sk_test' in json.dumps(a.metadata) for a in AuditLog.objects.all()))
        self.assertEqual(crypto.mask('short'), '••••')

    def test_saving_keys_without_an_encryption_key_is_refused(self):
        with override_settings(GATEWAY_ENCRYPTION_KEY=''):
            out = self.save_keys('paymongo', PM_KEYS, expect=503)
        self.assertEqual(out['code'], 'encryption_not_configured')
        self.assertFalse(GatewayConnection.objects.exists())

    def test_only_owners_and_admins_manage_keys(self):
        role = self.custom_role('Bookkeeper', [*MEMBER_PERMISSION_KEYS, BILLING_VIEW, BILLING_MANAGE])
        bookkeeper, _ = self.add_member('books@example.com', role=role)
        for user in (self.editor, bookkeeper):
            self.as_user(user)
            self.assertEqual(self.client.get(self.gw('api-billing-gateway', 'paymongo')).status_code, 403)
            self.assertEqual(self.client.put(self.gw('api-billing-gateway', 'paymongo'), {'mode': 'sandbox', 'credentials': PM_KEYS}, format='json').status_code, 403)
            self.assertEqual(self.client.post(self.gw('api-billing-gateway-test', 'paymongo')).status_code, 403)
        self.as_user(bookkeeper)
        self.assertFalse(self.client.get(self.url('api-billing-settings')).json()['can_manage_gateways'])
        self.assertEqual(self.client.patch(self.url('api-billing-settings'), {'country': 'PH'}, format='json').status_code, 403)
        self.as_user(self.owner)
        self.assertEqual(self.client.get(self.gw('api-billing-gateway', 'nope')).status_code, 404)

    def test_enabling_needs_a_passing_test_and_new_keys_turn_it_off(self):
        self.http.on('GET', '/merchants/capabilities/payment_methods', {'data': ['card']})
        self.save_keys('paymongo', PM_KEYS)
        self.assertEqual(self.client.post(self.gw('api-billing-gateway-enable', 'paymongo'), {'enabled': True}, format='json').status_code, 409)
        self.connect('paymongo', PM_KEYS)
        out = self.save_keys('paymongo', {**PM_KEYS, 'secret_key': 'sk_test_new_key_0000'})
        self.assertEqual((out['enabled'], out['connection_status']), (False, 'untested'))

    def test_country_recommendations(self):
        for country, expected in (('PH', 'paymongo'), ('pk', 'safepay'), ('BD', 'sslcommerz'), ('US', 'stripe'), ('GB', 'stripe'),
                                  ('DE', 'stripe'), ('AU', 'stripe')):
            data = self.client.patch(self.url('api-billing-settings'), {'country': country}, format='json').json()
            self.assertEqual(data['country'], country.upper())
            self.assertEqual(data['recommended_gateways'], [expected])
            keys = {g['key']: g for g in data['payment_gateways']}
            self.assertTrue(keys[expected]['recommended'])
            self.assertEqual(data['local_expanded'], country.upper() in ('PH', 'PK', 'BD'))
        self.assertEqual((keys['paypal']['status'], keys['razorpay']['status']), ('available', 'coming_soon'))
        self.assertEqual(self.client.patch(self.url('api-billing-settings'), {'country': 'PHL'}, format='json').status_code, 400)
        self.assertEqual(WorkspaceBillingSettings.objects.get(workspace=self.workspace).country, 'AU')

    def test_client_chooses_between_enabled_gateways(self):
        self.http.on('GET', '/merchants/capabilities/payment_methods', {'data': ['card']})
        self.http.on('POST', '/checkout_sessions', {'data': {'id': 'cs_pm_1', 'attributes': {'checkout_url': 'https://checkout.paymongo.com/x'}}})
        self.connect('paymongo', PM_KEYS)
        # A second gateway that can't take PHP: listed with a clear note, PayMongo still payable.
        self.http.on('GET', 'merchantTransIDvalidationAPI.php', {'APIConnect': 'DONE'})
        self.connect('sslcommerz', SSL_KEYS)
        invoice = self.sent_invoice()
        options = {o['provider']: o for o in self.detail(invoice)['payment_options']}
        self.assertTrue(options['paymongo']['available'])
        self.assertEqual(options['sslcommerz']['reason'], 'currency_unsupported')
        self.assertEqual(self.pay_now(invoice, 'sslcommerz', expect=409)['code'], 'currency_unsupported')
        self.assertEqual(self.pay_now(invoice, 'safepay', expect=409)['code'], 'not_enabled')
        # The public pay link offers the same choice.
        token = stripe_connect.ensure_pay_token(invoice)
        self.client.force_authenticate(None)
        page = self.client.get(reverse('api-public-pay', args=[token])).json()
        self.assertEqual([o['provider'] for o in page['payment_options']], ['paymongo', 'sslcommerz'])  # disabled ones are hidden
        response = self.client.post(reverse('api-public-pay-checkout', args=[token]), {'provider': 'paymongo'}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(GatewayCheckout.objects.get().return_to, f'/pay/{token}')

    def test_gateway_errors_are_readable(self):
        import requests
        self.http.on('GET', '/merchants/capabilities/payment_methods', {'errors': [{'detail': 'API key is invalid.'}]}, status=401)
        self.save_keys('paymongo', PM_KEYS)
        self.assertIn('API key is invalid', self.client.post(self.gw('api-billing-gateway-test', 'paymongo')).json()['status_message'])
        with mock.patch('app.gateways.base.requests.request', side_effect=requests.ConnectionError('boom')):
            self.assertIn('Couldn’t reach PayMongo', self.client.post(self.gw('api-billing-gateway-test', 'paymongo')).json()['status_message'])

    def test_nothing_enabled_keeps_the_stripe_shape(self):
        invoice = self.sent_invoice()
        detail = self.detail(invoice)
        self.assertEqual(detail['payment_options'], [])
        self.assertEqual(detail['online_payment'], {'provider': 'stripe', 'available': False, 'reason': 'not_configured'})
        self.assertEqual(online_payments.recommended_for('XX'), [])
