"""PayPal (Orders v2, mocked HTTP) and manual Pay by Wise / Payoneer with "I've paid" claims."""
import json
from decimal import Decimal

from django.test import TestCase
from django.urls import reverse

from .models import AuditLog, GatewayCheckout, GatewayConnection, Invoice, Payment, PaymentClaim
from .services import stripe_connect
from .test_local_gateways import GatewayBase

PP_KEYS = {'client_id': 'AbcClientId123', 'client_secret': 'EFGsecret-xyz-987654', 'webhook_id': 'WH-8PT597110X'}
PP_HEADERS = {f'HTTP_PAYPAL_{k}': 'x' for k in ('AUTH_ALGO', 'CERT_URL', 'TRANSMISSION_ID', 'TRANSMISSION_SIG', 'TRANSMISSION_TIME')}


class PayPalTests(GatewayBase, TestCase):
    currency = 'USD'

    def setUp(self):
        super().setUp()
        self.http.on('POST', '/v1/oauth2/token', {'access_token': 'A21AA', 'expires_in': 32400})
        self.http.on('GET', '/v1/notifications/webhooks/WH-8PT597110X', {
            'url': 'https://api.example.test/x', 'event_types': [{'name': 'CHECKOUT.ORDER.APPROVED'}, {'name': 'PAYMENT.CAPTURE.COMPLETED'}]})
        self.http.on('POST', '/v2/checkout/orders', {'id': 'ORDER1', 'status': 'PAYER_ACTION_REQUIRED', 'links': [
            {'rel': 'payer-action', 'href': 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER1'}]})
        self.verify = 'SUCCESS'
        self.http.on('POST', '/verify-webhook-signature', lambda kw: {'verification_status': self.verify})

    def order(self, checkout, status='COMPLETED', value=None):
        captures = [{'id': 'CAP1', 'status': 'COMPLETED', 'amount': {'currency_code': 'USD', 'value': value or str(checkout.amount)}}]
        return {'id': 'ORDER1', 'status': status, 'purchase_units': [
            {'custom_id': str(checkout.id), 'payments': {'captures': captures if status == 'COMPLETED' else []}}]}

    def start(self):
        connection = self.connect('paypal', PP_KEYS)
        invoice = self.sent_invoice()
        data = self.pay_now(invoice, 'paypal')
        self.assertEqual(data['url'], 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER1')
        return connection, invoice, GatewayCheckout.objects.get()

    def hook(self, connection, event):
        self.client.force_authenticate(None)
        return self.client.generic('POST', reverse('api-gateway-webhook', args=['paypal', connection.id]), json.dumps(event),
                                   content_type='application/json', **PP_HEADERS)

    def test_keys_masked_and_test_checks_the_webhook_events(self):
        card = self.save_keys('paypal', PP_KEYS)
        self.assertNotIn('EFGsecret-xyz-987654', json.dumps(card))
        self.http.on('GET', '/v1/notifications/webhooks/WH-8PT597110X', {'event_types': [{'name': 'CHECKOUT.ORDER.APPROVED'}]})
        tested = self.client.post(self.gw('api-billing-gateway-test', 'paypal')).json()
        self.assertEqual(tested['connection_status'], 'failed')
        self.assertIn('PAYMENT.CAPTURE.COMPLETED', tested['status_message'])
        self.assertEqual(self.client.post(self.gw('api-billing-gateway-enable', 'paypal'), {'enabled': True}, format='json').status_code, 409)

    def test_order_body_and_approved_webhook_captures_once(self):
        connection, invoice, checkout = self.start()
        body = self.http.called('/v2/checkout/orders')[-1][2]['json']
        self.assertEqual(body['intent'], 'CAPTURE')
        self.assertEqual(body['purchase_units'][0]['custom_id'], str(checkout.id))
        self.assertEqual(body['purchase_units'][0]['amount']['currency_code'], 'USD')
        self.http.on('GET', '/v2/checkout/orders/ORDER1', self.order(checkout, status='APPROVED'))
        self.http.on('POST', '/v2/checkout/orders/ORDER1/capture', self.order(checkout))
        event = {'id': 'WH-1', 'event_type': 'CHECKOUT.ORDER.APPROVED', 'resource': {'id': 'ORDER1'}}
        self.assertEqual(self.hook(connection, event).json()['outcome'], 'payment_recorded')
        capture_call = self.http.called('/capture')[-1][2]
        self.assertEqual(capture_call['headers']['PayPal-Request-Id'], 'capture-ORDER1')
        payment = Payment.objects.get()
        self.assertEqual((payment.provider, payment.provider_reference), ('paypal', 'ORDER1'))
        self.assertEqual(Invoice.objects.get(id=invoice.id).status, 'paid')
        # The capture webhook for the same order is a duplicate payment, not a second one.
        captured = {'id': 'WH-2', 'event_type': 'PAYMENT.CAPTURE.COMPLETED', 'resource': {
            'id': 'CAP1', 'status': 'COMPLETED', 'custom_id': str(checkout.id), 'amount': {'currency_code': 'USD', 'value': str(checkout.amount)},
            'supplementary_data': {'related_ids': {'order_id': 'ORDER1'}}}}
        self.assertEqual(self.hook(connection, captured).json()['outcome'], 'duplicate_payment')
        self.assertEqual(self.hook(connection, event).json()['outcome'], 'duplicate')
        self.assertEqual(Payment.objects.count(), 1)

    def test_unverified_webhook_is_rejected(self):
        connection, _, _ = self.start()
        self.verify = 'FAILURE'
        response = self.hook(connection, {'id': 'WH-9', 'event_type': 'CHECKOUT.ORDER.APPROVED', 'resource': {'id': 'ORDER1'}})
        self.assertEqual(response.status_code, 400)
        self.client.force_authenticate(None)
        missing = self.client.generic('POST', reverse('api-gateway-webhook', args=['paypal', connection.id]), '{}', content_type='application/json')
        self.assertEqual(missing.status_code, 400)
        self.assertEqual(Payment.objects.count(), 0)

    def test_return_captures_and_a_wrong_token_does_not(self):
        _, invoice, checkout = self.start()
        self.http.on('GET', '/v2/checkout/orders/ORDER1', self.order(checkout, status='APPROVED'))
        self.http.on('POST', '/v2/checkout/orders/ORDER1/capture', self.order(checkout))
        self.client.force_authenticate(None)
        url = reverse('api-gateway-return', args=[checkout.id, 'success'])
        self.client.get(url, {'token': 'OTHER'})
        self.assertEqual(Payment.objects.count(), 0)
        response = self.client.get(url, {'token': 'ORDER1', 'PayerID': 'P1'})
        self.assertIn('payment=success', response['Location'])
        self.client.get(url, {'token': 'ORDER1'})
        self.assertEqual(Payment.objects.count(), 1)

    def test_main_group_and_unsupported_country(self):
        data = self.client.patch(self.url('api-billing-settings'), {'country': 'BD'}, format='json').json()
        keys = [g['key'] for g in data['payment_gateways']]
        self.assertEqual(keys[:4], ['stripe', 'paypal', 'wise', 'payoneer'])
        paypal = data['payment_gateways'][1]
        self.assertEqual((paypal['group'], paypal['status'], paypal['country_unsupported']), ('main', 'available', True))
        self.assertTrue(data['local_expanded'] and data['local_recommended'])
        self.assertTrue(all(not g.get('enabled') for g in data['payment_gateways']))
        us = self.client.patch(self.url('api-billing-settings'), {'country': 'US'}, format='json').json()
        self.assertFalse(us['local_expanded'])


WISE = {'payment_link': 'https://wise.com/pay/me/northlights', 'note': 'Use the invoice number as reference.',
        'accounts': [{'currency': 'USD', 'details': 'Account holder: Northlight\nACH routing: 026073150\nAccount: 8310000000'}]}


class ManualTests(GatewayBase, TestCase):
    currency = 'USD'

    def save(self, provider, data, expect=200):
        self.as_user(self.owner)
        response = self.client.put(self.gw('api-billing-gateway', provider), data, format='json')
        self.assertEqual(response.status_code, expect, response.content)
        return response.json()

    def enable(self, provider, expect=200):
        response = self.client.post(self.gw('api-billing-gateway-enable', provider), {'enabled': True}, format='json')
        self.assertEqual(response.status_code, expect, response.content)

    def test_details_are_validated(self):
        self.enable('wise', expect=400)
        self.assertIn('detail', self.save('wise', {'payment_link': 'https://evil.example/pay'}, expect=400))
        self.save('wise', {'accounts': [{'currency': 'US', 'details': 'x'}]}, expect=400)
        self.save('wise', {}, expect=400)
        card = self.save('wise', WISE)
        self.assertEqual((card['kind'], card['automatic'], card['enabled']), ('manual', False, False))
        self.assertEqual(self.client.post(self.gw('api-billing-gateway-test', 'wise')).status_code, 400)
        self.save('payoneer', {'payment_link': 'https://link.payoneer.com/Token?t=abc'})

    def test_invoice_shows_details_and_claim_is_confirmed_once(self):
        self.save('wise', WISE)
        self.enable('wise')
        invoice = self.sent_invoice()
        option = next(o for o in self.detail(invoice)['payment_options'] if o['provider'] == 'wise')
        self.assertTrue(option['available'])
        info = option['instructions']
        self.assertEqual(info['reference'], invoice.number)
        self.assertIn('ACH routing', info['account_details'])
        self.assertIn('currency=USD', info['payment_link'])
        self.assertEqual(self.pay_now(invoice, 'wise', expect=409)['code'], 'manual_payment')
        # The client claims on the public pay page; a second claim returns the same pending one.
        token = stripe_connect.ensure_pay_token(invoice)
        self.client.force_authenticate(None)
        claim_url = reverse('api-public-pay-claim', args=[token])
        first = self.client.post(claim_url, {'provider': 'wise', 'payer_reference': 'TRX-77'}, format='json')
        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(self.client.post(claim_url, {'provider': 'wise'}, format='json').json()['id'], first.json()['id'])
        self.assertEqual(self.client.post(claim_url, {'provider': 'payoneer'}, format='json').status_code, 409)
        self.assertEqual(Payment.objects.count(), 0)
        self.assertEqual(Invoice.objects.get(id=invoice.id).status, 'sent')
        detail = self.detail(invoice)
        self.assertEqual(len(detail['payment_claims']), 1)
        claim_id = detail['payment_claims'][0]['id']
        confirm = reverse('api-billing-claim-resolve', args=[self.workspace.id, claim_id, 'confirm'])
        self.assertEqual(self.client.post(confirm).json()['status'], 'confirmed')
        self.assertEqual(self.client.post(confirm).json()['status'], 'confirmed')
        payment = Payment.objects.get()
        self.assertEqual((payment.provider, payment.provider_reference), ('wise', f'claim:{claim_id}'))
        self.assertEqual(Invoice.objects.get(id=invoice.id).status, 'paid')
        self.assertTrue(AuditLog.objects.filter(action='billing.wise.payment_claimed').exists())

    def test_reject_and_currency_without_details(self):
        self.save('payoneer', {'accounts': [{'currency': 'EUR', 'details': 'IBAN DE89 3704 0044 0532 0130 00'}]})
        self.enable('payoneer')
        invoice = self.sent_invoice()
        option = next(o for o in self.detail(invoice)['payment_options'] if o['provider'] == 'payoneer')
        self.assertEqual(option['reason'], 'currency_unsupported')
        self.save('payoneer', {'payment_link': 'https://link.payoneer.com/Token?t=abc'})
        response = self.client.post(self.url('api-billing-invoice-claim', invoice.id), {'provider': 'payoneer'}, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        reject = reverse('api-billing-claim-resolve', args=[self.workspace.id, response.json()['id'], 'reject'])
        self.assertEqual(self.client.post(reject).json()['status'], 'rejected')
        self.assertEqual(Payment.objects.count(), 0)
        self.assertEqual(PaymentClaim.objects.get().status, 'rejected')
        self.assertTrue(GatewayConnection.objects.get(provider='payoneer').enabled)
