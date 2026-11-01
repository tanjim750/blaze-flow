"""Live money: the money-version endpoint the app polls, and the "I've paid" team notification."""
from django.test import SimpleTestCase, TestCase
from django.urls import reverse

from .money_format import format_money
from .models import Invoice, Notification, Payment, TaskStageKind
from .services import stripe_connect
from .test_local_gateways import GatewayBase

WISE = {'payment_link': 'https://wise.com/pay/business/northlight', 'accounts': [{'currency': 'USD', 'details': 'ACH routing 026073150'}]}


class MoneyFormatTests(SimpleTestCase):
    def test_matches_the_frontend_formatter(self):
        self.assertEqual(format_money('1590', 'GBP'), '£1,590.00')
        self.assertEqual(format_money('500.5', 'USD'), 'US$500.50')
        self.assertEqual(format_money('1250', 'JPY'), 'JP¥1,250')
        self.assertEqual(format_money('1234567.891', 'EUR'), '€1,234,567.89')
        self.assertEqual(format_money('-20', 'gbp'), '-£20.00')
        self.assertEqual(format_money('10', 'BDT'), '৳10.00')
        self.assertEqual(format_money(None, 'GBP'), '')


class LiveMoneyTests(GatewayBase, TestCase):
    currency = 'USD'

    def pulse(self, user, expect=200):
        self.as_user(user)
        response = self.client.get(self.url('api-billing-money-version'))
        self.assertEqual(response.status_code, expect, response.content)
        return response.json()

    def test_version_changes_when_an_invoice_is_paid_and_latest_names_client_and_invoice(self):
        invoice = self.sent_invoice()
        before = self.pulse(self.owner)
        self.assertEqual((before['scope'], before['latest']), ('workspace', None))
        self.assertEqual(self.pulse(self.owner)['version'], before['version'])  # stable while nothing moves
        self.pay(str(invoice.id), '500')
        after = self.pulse(self.owner)
        self.assertNotEqual(after['version'], before['version'])
        latest = after['latest']
        self.assertEqual((latest['kind'], latest['amount'], latest['currency'], latest['client'], latest['invoice_number']),
                         ('payment_received', '500.00', 'USD', 'Northlight Coffee', invoice.number))
        self.assertEqual(latest['id'], str(Payment.objects.get().id))

    def test_editors_get_only_their_own_money_never_client_revenue(self):
        first, _ = self.priced_project()
        start = self.pulse(self.editor)
        self.move(first['id'], TaskStageKind.APPROVED)  # Maya's 300 is now earned: her earnings moved
        maya = self.pulse(self.editor)
        self.assertNotEqual(maya['version'], start['version'])
        invoice = Invoice.objects.get(id=self.invoice()['id'])
        theo = self.pulse(self.other_editor)
        self.pay(str(invoice.id), '500')
        after = self.pulse(self.editor)
        self.assertEqual(after['scope'], 'own')
        self.assertEqual(after['version'], maya['version'])  # a client payment is not editor news
        self.assertIsNone(after['latest'])
        self.assertNotIn('Northlight Coffee', str(after))
        # A payout to Maya moves Maya's version only.
        self.as_user(self.owner)
        response = self.client.post(self.url('api-billing-payouts'), {'membership_id': str(self.editor_membership.id), 'amount': '100'}, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        mine = self.pulse(self.editor)
        self.assertNotEqual(mine['version'], maya['version'])
        self.assertEqual((mine['latest']['kind'], mine['latest']['amount']), ('payout_received', '100.00'))
        self.assertNotIn('client', mine['latest'])
        self.assertEqual(self.pulse(self.other_editor)['version'], theo['version'])

    def test_client_team_members_and_strangers_are_refused(self):
        self.pulse(self.add_client_member(), expect=403)
        stranger, _ = self.add_member('x@elsewhere.example')
        self.as_user(stranger)
        self.assertEqual(self.client.get(reverse('api-billing-money-version', args=['00000000-0000-0000-0000-000000000000'])).status_code, 404)
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(self.url('api-billing-money-version')).status_code, (401, 403))


class ClaimNotificationTests(GatewayBase, TestCase):
    currency = 'USD'

    def save(self, provider, data):
        self.as_user(self.owner)
        self.assertEqual(self.client.put(self.gw('api-billing-gateway', provider), data, format='json').status_code, 200)

    def enable(self, provider):
        self.assertEqual(self.client.post(self.gw('api-billing-gateway-enable', provider), {'enabled': True}, format='json').status_code, 200)

    def test_ive_paid_notifies_billing_managers_not_editors(self):
        self.save('wise', WISE)
        self.enable('wise')
        invoice = self.sent_invoice()
        token = stripe_connect.ensure_pay_token(invoice)
        self.client.force_authenticate(None)
        url = reverse('api-public-pay-claim', args=[token])
        self.assertEqual(self.client.post(url, {'provider': 'wise', 'payer_name': 'Rachel Kim', 'payer_reference': 'TRX-9'}, format='json').status_code, 201)
        self.client.post(url, {'provider': 'wise'}, format='json')  # same pending claim: no second bell
        notes = Notification.objects.filter(kind='PAYMENT_CLAIMED')
        self.assertEqual([n.recipient_user_id for n in notes], [self.owner.id])
        payload = notes.get().payload
        self.assertEqual((payload['invoice_number'], payload['provider'], payload['client_team_name'], payload['actor_name']),
                         (invoice.number, 'wise', 'Northlight Coffee', 'Rachel Kim'))
        self.assertEqual(payload['link'], f'/money/invoices/{invoice.id}')
        self.assertEqual(payload['amount_display'], format_money(payload['amount'], payload['currency']))
        self.assertNotIn(payload['currency'], payload['amount_display'])
        self.assertFalse(Notification.objects.filter(kind='PAYMENT_CLAIMED', recipient_user=self.editor).exists())
