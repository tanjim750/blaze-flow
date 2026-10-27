"""Stripe Connect: onboarding, Pay now (Checkout), the pay link and the webhook. Stripe is mocked."""
import json
import time
from decimal import Decimal
from unittest import mock

import stripe
from django.test import TestCase, override_settings
from django.urls import reverse

from .models import (
    AuditLog, ClientTeamMember, Invoice, InvoiceStatus, Payment, StripeConnectAccount, StripeConnectStatus,
    StripeWebhookEvent, WorkspaceMembership,
)
from .permissions import BILLING_MANAGE, BILLING_VIEW, MEMBER_PERMISSION_KEYS
from .services import billing, stripe_connect
from .stripe_currencies import UnsupportedCurrency, from_minor_units, to_minor_units
from .test_billing import BillingBase

SECRET = 'whsec_test_secret'
KEYS = dict(STRIPE_SECRET_KEY='sk_test_dummy', STRIPE_PUBLISHABLE_KEY='pk_test_dummy', STRIPE_WEBHOOK_SECRET=SECRET,
            APP_BASE_URL='https://app.example.test')


def remote_account(**over):
    data = {'id': 'acct_123', 'charges_enabled': False, 'payouts_enabled': False, 'details_submitted': False,
            'country': 'gb', 'default_currency': 'gbp', 'requirements': {'currently_due': [], 'past_due': [], 'disabled_reason': None}}
    data.update(over)
    return data


def fake_client():
    client = mock.MagicMock()
    client.v2.core.accounts.create.return_value = {'id': 'acct_123'}
    client.v2.core.account_links.create.return_value = {'url': 'https://connect.stripe.com/setup/e/acct_123/abc'}
    client.v1.accounts.retrieve.return_value = remote_account()
    client.v1.accounts.login_links.create.return_value = {'url': 'https://connect.stripe.com/express/abc'}
    client.v1.checkout.sessions.create.return_value = {'id': 'cs_test_1', 'url': 'https://checkout.stripe.com/c/pay/cs_test_1'}
    return client


def signed(payload, secret=SECRET, timestamp=None):
    body = json.dumps(payload)
    timestamp = timestamp or int(time.time())
    signature = stripe.WebhookSignature._compute_signature(f'{timestamp}.{body}', secret)
    return body, f't={timestamp},v1={signature}'


class StripeBase(BillingBase):
    def setUp(self):
        super().setUp()
        keys = override_settings(**KEYS)
        keys.enable()
        self.addCleanup(keys.disable)
        self.stripe = fake_client()
        patcher = mock.patch('app.services.stripe_connect.get_client', return_value=self.stripe)
        patcher.start()
        self.addCleanup(patcher.stop)

    def connect_active(self, account_id='acct_123'):
        return StripeConnectAccount.objects.create(
            workspace=self.workspace, stripe_account_id=account_id, status=StripeConnectStatus.ACTIVE,
            charges_enabled=True, payouts_enabled=True, details_submitted=True,
        )

    def sent_invoice(self):
        self.priced_project()
        return Invoice.objects.get(id=self.invoice()['id'])

    def webhook(self, payload, secret=SECRET, header=None):
        body, sig = signed(payload, secret)
        return self.client.generic('POST', reverse('api-stripe-webhook'), body, content_type='application/json',
                                   HTTP_STRIPE_SIGNATURE=header if header is not None else sig)

    def paid_event(self, invoice, *, event_id='evt_1', amount=140000, currency='gbp', account='acct_123', pi='pi_1'):
        return {'id': event_id, 'object': 'event', 'type': 'checkout.session.completed', 'account': account, 'data': {'object': {
            'id': 'cs_test_1', 'object': 'checkout.session', 'payment_status': 'paid', 'amount_total': amount, 'currency': currency,
            'payment_intent': pi, 'metadata': {'blazeflow_invoice_id': str(invoice.id)}}}}


class CurrencyUnitTests(TestCase):
    def test_minor_units(self):
        self.assertEqual(to_minor_units(Decimal('1400.00'), 'GBP'), 140000)
        self.assertEqual(to_minor_units(Decimal('1400'), 'JPY'), 1400)
        self.assertEqual(to_minor_units(Decimal('10.50'), 'KRW'), 11)  # half-up to whole won
        self.assertEqual(to_minor_units(Decimal('5000'), 'ISK'), 500000)  # whole units sent x100
        self.assertEqual(from_minor_units(1400, 'JPY'), Decimal('1400'))
        self.assertEqual(from_minor_units(140050, 'USD'), Decimal('1400.50'))
        with self.assertRaises(UnsupportedCurrency):
            to_minor_units(Decimal('1'), 'KWD')


class NotConfiguredTests(BillingBase, TestCase):
    @override_settings(STRIPE_SECRET_KEY='', STRIPE_WEBHOOK_SECRET='')
    def test_the_app_still_works_and_says_stripe_is_not_configured(self):
        self.as_user(self.owner)
        status = self.client.get(self.url('api-billing-stripe')).json()
        self.assertFalse(status['configured'])
        self.assertEqual(status['not_configured_message'], 'Stripe not configured on this server.')
        response = self.client.post(self.url('api-billing-stripe-connect'))
        self.assertEqual(response.status_code, 503)
        settings_out = self.client.get(self.url('api-billing-settings')).json()
        stripe_entry = next(g for g in settings_out['payment_gateways'] if g['key'] == 'stripe')
        self.assertEqual(stripe_entry['status'], 'not_configured')
        self.assertTrue(all(g['status'] == 'coming_soon' for g in settings_out['payment_gateways'] if g['key'] != 'stripe'))
        self.priced_project()
        invoice = self.invoice()
        self.assertEqual(invoice['online_payment'], {'provider': 'stripe', 'available': False, 'reason': 'not_configured'})
        self.assertEqual(self.client.post(reverse('api-stripe-webhook'), '{}', content_type='application/json').status_code, 503)


class ConnectFlowTests(StripeBase, TestCase):
    def test_owner_connects_onboards_and_becomes_active(self):
        self.as_user(self.owner)
        response = self.client.post(self.url('api-billing-stripe-connect'))
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['url'], 'https://connect.stripe.com/setup/e/acct_123/abc')
        params = self.stripe.v2.core.accounts.create.call_args.args[0]
        self.assertEqual(params['dashboard'], 'express')
        self.assertEqual(params['defaults']['responsibilities'], {'fees_collector': 'stripe', 'losses_collector': 'stripe'})
        self.assertTrue(params['configuration']['merchant']['capabilities']['card_payments']['requested'])
        link = self.stripe.v2.core.account_links.create.call_args.args[0]
        self.assertEqual(link['use_case']['type'], 'account_onboarding')
        self.assertEqual(link['use_case']['account_onboarding']['return_url'], 'https://app.example.test/settings?stripe=return#billing')
        self.assertEqual(link['use_case']['account_onboarding']['refresh_url'], 'https://app.example.test/settings?stripe=refresh#billing')
        account = StripeConnectAccount.objects.get(workspace=self.workspace)
        self.assertEqual(account.status, StripeConnectStatus.ONBOARDING)
        self.assertTrue(AuditLog.objects.filter(action='billing.stripe.connected').exists())

        # A second click reuses the same account.
        self.client.post(self.url('api-billing-stripe-connect'))
        self.assertEqual(self.stripe.v2.core.accounts.create.call_count, 1)

        # Submitted, waiting on Stripe.
        self.stripe.v1.accounts.retrieve.return_value = remote_account(details_submitted=True)
        self.assertEqual(self.client.get(self.url('api-billing-stripe'), {'refresh': 1}).json()['status'], 'pending')
        # Stripe wants more.
        self.stripe.v1.accounts.retrieve.return_value = remote_account(details_submitted=True, requirements={'currently_due': ['individual.verification.document'], 'past_due': []})
        data = self.client.get(self.url('api-billing-stripe'), {'refresh': 1}).json()
        self.assertEqual(data['status'], 'needs_info')
        self.assertEqual(data['requirements_due'], ['individual.verification.document'])
        # Live.
        self.stripe.v1.accounts.retrieve.return_value = remote_account(details_submitted=True, charges_enabled=True, payouts_enabled=True)
        data = self.client.get(self.url('api-billing-stripe'), {'refresh': 1}).json()
        self.assertEqual((data['status'], data['charges_enabled'], data['payouts_enabled']), ('active', True, True))
        self.assertEqual(data['account_id'], '…ct_123')

        self.assertEqual(self.client.post(self.url('api-billing-stripe-dashboard')).json()['url'], 'https://connect.stripe.com/express/abc')
        self.stripe.v1.accounts.login_links.create.assert_called_once_with('acct_123')

        disconnected = self.client.post(self.url('api-billing-stripe-disconnect')).json()
        self.assertEqual(disconnected['status'], 'not_connected')
        self.assertFalse(StripeConnectAccount.objects.exists())
        self.assertTrue(AuditLog.objects.filter(action='billing.stripe.disconnected').exists())

    def test_only_owners_and_admins_manage_stripe(self):
        self.as_user(self.editor)
        for name in ('api-billing-stripe-connect', 'api-billing-stripe-dashboard', 'api-billing-stripe-disconnect'):
            self.assertEqual(self.client.post(self.url(name)).status_code, 403, name)
        self.assertEqual(self.client.get(self.url('api-billing-stripe')).status_code, 403)
        # Billing managers without workspace.manage can see the status but not change it.
        role = self.custom_role('Bookkeeper', [*MEMBER_PERMISSION_KEYS, BILLING_VIEW, BILLING_MANAGE])
        bookkeeper, _ = self.add_member('books@example.com', role=role)
        self.as_user(bookkeeper)
        status = self.client.get(self.url('api-billing-stripe')).json()
        self.assertFalse(status['can_manage'])
        self.assertEqual(self.client.post(self.url('api-billing-stripe-connect')).status_code, 403)
        self.stripe.v2.core.accounts.create.assert_not_called()

    def test_stripe_errors_come_back_as_a_clear_message(self):
        self.stripe.v2.core.accounts.create.side_effect = stripe.InvalidRequestError('Connect is not enabled', param=None)
        self.as_user(self.owner)
        response = self.client.post(self.url('api-billing-stripe-connect'))
        self.assertEqual(response.status_code, 502)
        self.assertIn('Connect is not enabled', response.json()['detail'])
        self.assertFalse(StripeConnectAccount.objects.exists())


class CheckoutTests(StripeBase, TestCase):
    def test_pay_now_is_a_direct_charge_in_the_invoice_currency(self):
        self.connect_active()
        invoice = self.sent_invoice()
        self.as_user(self.owner)
        detail = self.client.get(self.url('api-billing-invoice-detail', invoice.id)).json()
        self.assertTrue(detail['online_payment']['available'])
        self.assertTrue(detail['pay_link'].startswith('https://app.example.test/pay/'))
        response = self.client.post(self.url('api-billing-invoice-checkout', invoice.id))
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['url'], 'https://checkout.stripe.com/c/pay/cs_test_1')
        params, options = self.stripe.v1.checkout.sessions.create.call_args.args
        self.assertEqual(options, {'stripe_account': 'acct_123'})
        self.assertEqual(params['line_items'][0]['price_data']['currency'], invoice.currency.lower())
        self.assertEqual(params['line_items'][0]['price_data']['unit_amount'], 140000)
        self.assertNotIn('application_fee_amount', params['payment_intent_data'])
        self.assertEqual(params['metadata']['blazeflow_invoice_id'], str(invoice.id))
        self.assertTrue(params['success_url'].endswith(f'/money/invoices/{invoice.id}?stripe=success'))

    @override_settings(PLATFORM_FEE_PERCENT='2.5')
    def test_zero_decimal_currency_and_platform_fee(self):
        self.connect_active()
        invoice = self.sent_invoice()
        Invoice.objects.filter(id=invoice.id).update(currency='JPY')
        self.as_user(self.owner)
        self.client.post(self.url('api-billing-invoice-checkout', invoice.id))
        params = self.stripe.v1.checkout.sessions.create.call_args.args[0]
        self.assertEqual(params['line_items'][0]['price_data'], {**params['line_items'][0]['price_data'], 'currency': 'jpy', 'unit_amount': 1400})
        self.assertEqual(params['payment_intent_data']['application_fee_amount'], 35)

    def test_unsupported_currency_gets_a_clear_note(self):
        self.connect_active()
        invoice = self.sent_invoice()
        Invoice.objects.filter(id=invoice.id).update(currency='KWD')
        self.as_user(self.owner)
        detail = self.client.get(self.url('api-billing-invoice-detail', invoice.id)).json()
        self.assertEqual(detail['online_payment']['reason'], 'currency_unsupported')
        self.assertIn('KWD', detail['online_payment']['message'])
        response = self.client.post(self.url('api-billing-invoice-checkout', invoice.id))
        self.assertEqual(response.status_code, 409)
        self.stripe.v1.checkout.sessions.create.assert_not_called()

    def test_not_available_until_the_account_can_take_charges(self):
        StripeConnectAccount.objects.create(workspace=self.workspace, stripe_account_id='acct_123', status=StripeConnectStatus.PENDING)
        invoice = self.sent_invoice()
        self.as_user(self.owner)
        self.assertEqual(self.client.post(self.url('api-billing-invoice-checkout', invoice.id)).status_code, 409)

    def test_the_client_can_pay_their_own_invoice_but_not_others(self):
        self.connect_active()
        invoice = self.sent_invoice()
        client_user = self.add_client_member(team_name='Northlight members')
        ClientTeamMember.objects.filter(user=client_user).update(client_team=self.team)
        WorkspaceMembership.objects.filter(workspace=self.workspace, principal_type='CLIENT_TEAM').update(client_team=self.team)
        self.as_user(client_user)
        detail = self.client.get(self.url('api-billing-invoice-detail', invoice.id)).json()
        self.assertTrue(detail['online_payment']['available'])
        self.assertNotIn('pay_link', detail)
        self.assertEqual(self.client.post(self.url('api-billing-invoice-checkout', invoice.id)).status_code, 200)
        self.as_user(self.editor)
        self.assertEqual(self.client.post(self.url('api-billing-invoice-checkout', invoice.id)).status_code, 404)

    def test_public_pay_link(self):
        self.connect_active()
        invoice = self.sent_invoice()
        token = stripe_connect.ensure_pay_token(invoice)
        self.client.force_authenticate(None)
        page = self.client.get(reverse('api-public-pay', args=[token]))
        self.assertEqual(page.status_code, 200)
        self.assertEqual(page.json()['total'], '1400.00')
        self.assertTrue(page.json()['online_payment']['available'])
        response = self.client.post(reverse('api-public-pay-checkout', args=[token]))
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(self.stripe.v1.checkout.sessions.create.call_args.args[0]['success_url'].endswith(f'/pay/{token}?stripe=success'))
        self.assertEqual(self.client.get(reverse('api-public-pay', args=['nope'])).status_code, 404)


class WebhookTests(StripeBase, TestCase):
    def test_a_bad_signature_is_rejected(self):
        self.connect_active()
        invoice = self.sent_invoice()
        self.assertEqual(self.webhook(self.paid_event(invoice), secret='whsec_wrong').status_code, 400)
        self.assertEqual(self.webhook(self.paid_event(invoice), header='').status_code, 400)
        self.assertFalse(Payment.objects.exists())
        self.assertFalse(StripeWebhookEvent.objects.exists())

    def test_checkout_completed_marks_the_invoice_paid_once(self):
        self.connect_active()
        invoice = self.sent_invoice()
        response = self.webhook(self.paid_event(invoice))
        self.assertEqual(response.json()['outcome'], 'payment_recorded')
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, InvoiceStatus.PAID)
        payment = Payment.objects.get()
        self.assertEqual((payment.provider, payment.provider_reference, payment.method, payment.amount), ('stripe', 'pi_1', 'card', Decimal('1400.00')))
        # The same event again, and payment_intent.succeeded for the same PaymentIntent: still one payment.
        self.assertEqual(self.webhook(self.paid_event(invoice)).json()['outcome'], 'duplicate')
        pi_event = {'id': 'evt_2', 'type': 'payment_intent.succeeded', 'account': 'acct_123', 'data': {'object': {
            'id': 'pi_1', 'amount_received': 140000, 'currency': 'gbp', 'metadata': {'blazeflow_invoice_id': str(invoice.id)}}}}
        self.assertEqual(self.webhook(pi_event).json()['outcome'], 'duplicate_payment')
        self.assertEqual(Payment.objects.count(), 1)
        self.assertTrue(AuditLog.objects.filter(action='billing.invoice.payment_recorded').exists())

    def test_a_part_payment_leaves_the_invoice_partially_paid(self):
        self.connect_active()
        invoice = self.sent_invoice()
        self.webhook(self.paid_event(invoice, amount=40000))
        out = billing.invoice_out(Invoice.objects.get(id=invoice.id))
        self.assertEqual((out['status'], out['paid'], out['outstanding']), ('sent', '400.00', '1000.00'))

    def test_money_for_another_account_or_currency_is_not_recorded(self):
        self.connect_active()
        invoice = self.sent_invoice()
        self.assertEqual(self.webhook(self.paid_event(invoice, account='acct_evil')).json()['outcome'], 'account_mismatch')
        self.assertEqual(self.webhook(self.paid_event(invoice, event_id='evt_9', currency='usd')).json()['outcome'], 'currency_mismatch')
        self.assertFalse(Payment.objects.exists())

    def test_zero_decimal_amounts_are_converted(self):
        self.connect_active()
        invoice = self.sent_invoice()
        Invoice.objects.filter(id=invoice.id).update(currency='JPY')
        self.webhook(self.paid_event(invoice, amount=1400, currency='jpy'))
        self.assertEqual(Payment.objects.get().amount, Decimal('1400'))
        self.assertEqual(Invoice.objects.get(id=invoice.id).status, InvoiceStatus.PAID)

    def test_refund_reopens_the_invoice(self):
        self.connect_active()
        invoice = self.sent_invoice()
        self.webhook(self.paid_event(invoice))
        refund = {'id': 'evt_r', 'type': 'charge.refunded', 'account': 'acct_123', 'data': {'object': {
            'id': 'ch_1', 'payment_intent': 'pi_1', 'amount_refunded': 50000, 'currency': 'gbp'}}}
        self.assertEqual(self.webhook(refund).json()['outcome'], 'refund_recorded')
        out = billing.invoice_out(Invoice.objects.get(id=invoice.id))
        self.assertEqual((out['status'], out['paid'], out['outstanding']), ('sent', '900.00', '500.00'))
        self.assertEqual(Payment.objects.get().refunded_amount, Decimal('500.00'))

    def test_account_updated_refreshes_status(self):
        StripeConnectAccount.objects.create(workspace=self.workspace, stripe_account_id='acct_123')
        event = {'id': 'evt_a', 'type': 'account.updated', 'account': 'acct_123', 'data': {'object': remote_account(
            details_submitted=True, charges_enabled=True, payouts_enabled=False)}}
        self.assertEqual(self.webhook(event).json()['outcome'], 'account_updated')
        account = StripeConnectAccount.objects.get()
        self.assertEqual((account.status, account.charges_enabled, account.payouts_enabled), ('active', True, False))
        self.assertTrue(AuditLog.objects.filter(action='billing.stripe.status_changed').exists())

    def test_thin_v2_account_event_syncs_from_the_api(self):
        StripeConnectAccount.objects.create(workspace=self.workspace, stripe_account_id='acct_123')
        self.stripe.v1.accounts.retrieve.return_value = remote_account(details_submitted=True)
        event = {'id': 'evt_v2', 'object': 'v2.core.event', 'type': 'v2.core.account.updated', 'related_object': {'id': 'acct_123'}}
        self.assertEqual(self.webhook(event).json()['outcome'], 'account_synced')
        self.assertEqual(StripeConnectAccount.objects.get().status, 'pending')

    @override_settings(STRIPE_WEBHOOK_SECRET='whsec_old, ' + SECRET)
    def test_several_signing_secrets_are_accepted(self):
        self.connect_active()
        invoice = self.sent_invoice()
        self.assertEqual(self.webhook(self.paid_event(invoice)).status_code, 200)
