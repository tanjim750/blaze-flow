"""Billing demo: prices, invoices, payments, editor pay and payouts, and who may see what."""
import inspect
import re
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from unittest import mock

from django.core.management import call_command
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .models import (
    ClientTeam, EditorPay, Invoice, InvoiceStatus, MemberPayRate, Payment, Project, Task, TaskStage, TaskStageKind,
)
from .permissions import BILLING_MANAGE, BILLING_RATES_VIEW, BILLING_VIEW, MEMBER_PERMISSION_KEYS, OWNER_PERMISSION_KEYS
from .services import billing
from .test_role_dashboards import DashboardBase


class BillingBase(DashboardBase):
    def setUp(self):
        super().setUp()
        self.team = ClientTeam.objects.create(
            id=__import__('uuid').uuid4(), workspace=self.workspace, name='Northlight Coffee',
            created_at=timezone.now(), updated_at=timezone.now(),
        )
        Project.objects.filter(id=self.project_id).update(client_team=self.team)
        self.editor, self.editor_membership = self.add_member('maya@example.com', first='Maya', last='Editor')
        self.other_editor, self.other_membership = self.add_member('theo@example.com', first='Theo', last='Editor')

    # -- helpers --------------------------------------------------------------------
    def url(self, name, *args):
        return reverse(name, args=[self.workspace.id, *args])

    def stage(self, kind):
        return TaskStage.objects.get(workspace=self.workspace, kind=kind)

    def move(self, task_id, kind, user=None):
        self.as_user(user or self.owner)
        response = self.client.post(reverse('api-task-move', args=[self.workspace.id, task_id]), {'task_stage_id': str(self.stage(kind).id)}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def patch_money(self, task_id, payload, user=None, expect=200):
        self.as_user(user or self.owner)
        response = self.client.patch(self.url('api-billing-task', task_id), payload, format='json')
        self.assertEqual(response.status_code, expect, response.content)
        return response.json()

    def set_fee(self, amount):
        self.as_user(self.owner)
        response = self.client.patch(self.url('api-billing-project', self.project_id), {'fee': amount}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def priced_project(self):
        """Fee 1000 + two priced tasks (250, 150) = 1400. Maya on the first at 300."""
        self.set_fee('1000')
        first = self.task('Hero 30s', self.editor_membership)
        second = self.task('Cutdowns 9:16', self.other_membership)
        self.patch_money(first['id'], {'client_price': '250', 'editor_pay': {'membership_id': str(self.editor_membership.id), 'amount': '300'}})
        self.patch_money(second['id'], {'client_price': 150, 'editor_pay': {'membership_id': str(self.other_membership.id), 'amount': '120.50'}})
        return first, second

    def invoice(self, send=True, due_date=None):
        self.as_user(self.owner)
        payload = {'project_id': self.project_id}
        if due_date:
            payload['due_date'] = due_date.isoformat()
        response = self.client.post(self.url('api-billing-invoices'), payload, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        data = response.json()
        if send:
            sent = self.client.post(self.url('api-billing-invoice-send', data['id']))
            self.assertEqual(sent.status_code, 200, sent.content)
            data = sent.json()
        return data

    def pay(self, invoice_id, amount=None, expect=201, **extra):
        self.as_user(self.owner)
        payload = {**extra}
        if amount is not None:
            payload['amount'] = amount
        response = self.client.post(self.url('api-billing-invoice-payments', invoice_id), payload, format='json')
        self.assertEqual(response.status_code, expect, response.content)
        return response.json()


class BillingPermissionKeyTests(BillingBase, TestCase):
    def test_owners_hold_the_billing_keys_and_members_do_not(self):
        for key in (BILLING_VIEW, BILLING_MANAGE, BILLING_RATES_VIEW):
            self.assertIn(key, OWNER_PERMISSION_KEYS)
            self.assertNotIn(key, MEMBER_PERMISSION_KEYS)
        self.assertEqual(self.listed_workspace(self.owner)['billing'], {'view': True, 'manage': True, 'rates_view': True})
        self.assertEqual(self.listed_workspace(self.editor)['billing'], {'view': False, 'manage': False, 'rates_view': False})

    def test_a_custom_admin_role_can_be_given_billing(self):
        role = self.custom_role('Producer', [*MEMBER_PERMISSION_KEYS, BILLING_VIEW, BILLING_RATES_VIEW])
        user, _ = self.add_member('producer@example.com', role=role)
        self.assertEqual(self.listed_workspace(user)['billing'], {'view': True, 'manage': False, 'rates_view': True})
        self.as_user(user)
        self.assertEqual(self.client.get(self.url('api-billing-summary')).status_code, 200)
        self.assertEqual(self.client.patch(self.url('api-billing-project', self.project_id), {'fee': '5'}, format='json').status_code, 403)

    def test_billing_keys_on_a_client_team_role_grant_nothing(self):
        role = self.custom_role('Client with billing', ['workspace.read', 'project.read', BILLING_VIEW, BILLING_MANAGE, BILLING_RATES_VIEW])
        client_user = self.add_client_member(role=role)
        self.assertEqual(self.listed_workspace(client_user)['billing'], {'view': False, 'manage': False, 'rates_view': False})
        self.as_user(client_user)
        self.assertEqual(self.client.get(self.url('api-billing-summary')).status_code, 403)

    def test_guests_and_anonymous_callers_get_nothing(self):
        self.client.force_authenticate(None)
        for name, args in (('api-billing-summary', ()), ('api-billing-invoices', ()), ('api-billing-my-earnings', ()),
                           ('api-billing-my-invoices', ()), ('api-billing-payouts', ())):
            self.assertIn(self.client.get(self.url(name, *args)).status_code, (401, 403), name)


class EditorPayTests(BillingBase, TestCase):
    def test_pay_becomes_earned_and_freezes_when_the_task_is_approved(self):
        task = self.task('Hero 30s', self.editor_membership)
        self.patch_money(task['id'], {'editor_pay': {'membership_id': str(self.editor_membership.id), 'amount': '300'}})
        self.patch_money(task['id'], {'editor_pay': {'membership_id': str(self.editor_membership.id), 'amount': '320'}})
        pay = EditorPay.objects.get(task_id=task['id'])
        self.assertEqual((pay.status, pay.amount, pay.earned_at), ('pending', Decimal('320.00'), None))

        self.move(task['id'], TaskStageKind.APPROVED)
        pay.refresh_from_db()
        self.assertEqual((pay.status, pay.amount), ('earned', Decimal('320.00')))
        earned_at = pay.earned_at
        self.assertIsNotNone(earned_at)

        refused = self.patch_money(task['id'], {'editor_pay': {'membership_id': str(self.editor_membership.id), 'amount': '999'}}, expect=409)
        self.assertIn('frozen', refused['detail'])

        # Out of Approved and back again: still the same frozen amount and timestamp.
        self.move(task['id'], TaskStageKind.REVISIONS)
        self.move(task['id'], TaskStageKind.APPROVED)
        pay.refresh_from_db()
        self.assertEqual((pay.status, pay.amount, pay.earned_at), ('earned', Decimal('320.00'), earned_at))

    def test_approval_through_a_task_patch_also_freezes(self):
        task = self.task('Hero 30s', self.editor_membership)
        self.patch_money(task['id'], {'editor_pay': {'membership_id': str(self.editor_membership.id), 'amount': '200'}})
        self.as_user(self.owner)
        response = self.client.patch(reverse('api-task-detail', args=[self.workspace.id, task['id']]), {'task_stage_id': str(self.stage('approved').id)}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(EditorPay.objects.get(task_id=task['id']).status, 'earned')

    def test_default_rate_prefills_on_assignment_and_on_approval(self):
        self.as_user(self.owner)
        self.assertEqual(self.client.patch(self.url('api-billing-member-rate', self.editor_membership.id), {'default_task_rate': '180'}, format='json').status_code, 200)
        task = self.task('Reel 21', self.editor_membership)
        self.assertEqual(EditorPay.objects.get(task_id=task['id']).amount, Decimal('180.00'))

        # Assigned before a rate existed: approval creates the line at the rate, already earned.
        other = self.task('Reel 22', self.other_membership)
        MemberPayRate.objects.create(workspace_membership=self.other_membership, default_task_rate=Decimal('90'))
        self.move(other['id'], TaskStageKind.APPROVED)
        pay = EditorPay.objects.get(task_id=other['id'])
        self.assertEqual((pay.amount, pay.status), (Decimal('90.00'), 'earned'))

    def test_unassigning_drops_pending_pay_but_keeps_earned_pay(self):
        task = self.task('Hero 30s', self.editor_membership)
        self.patch_money(task['id'], {'editor_pay': {'membership_id': str(self.editor_membership.id), 'amount': '300'}})
        self.as_user(self.owner)
        self.client.patch(reverse('api-task-detail', args=[self.workspace.id, task['id']]), {'assignee_id': str(self.other_membership.id)}, format='json')
        self.assertFalse(EditorPay.objects.filter(task_id=task['id'], workspace_membership=self.editor_membership).exists())

        done = self.task('Thumbnail', self.editor_membership)
        self.patch_money(done['id'], {'editor_pay': {'membership_id': str(self.editor_membership.id), 'amount': '50'}})
        self.move(done['id'], TaskStageKind.APPROVED)
        self.client.patch(reverse('api-task-detail', args=[self.workspace.id, done['id']]), {'assignee_id': None}, format='json')
        self.assertEqual(EditorPay.objects.get(task_id=done['id']).status, 'earned')

    def test_pay_needs_an_assignee(self):
        task = self.task('Hero 30s', self.editor_membership)
        self.patch_money(task['id'], {'editor_pay': {'membership_id': str(self.other_membership.id), 'amount': '10'}}, expect=400)

    def test_payouts_reduce_what_is_owed(self):
        first, second = self.priced_project()
        self.move(first['id'], TaskStageKind.APPROVED)
        balance = billing.editor_balance(self.editor_membership)
        self.assertEqual((balance['earned_amount'], balance['owed_amount']), (Decimal('300.00'), Decimal('300.00')))
        self.as_user(self.owner)
        url = self.url('api-billing-payouts')
        self.assertEqual(self.client.post(url, {'membership_id': str(self.editor_membership.id), 'amount': '100', 'method': 'bank_transfer'}, format='json').status_code, 201)
        self.assertEqual(self.client.post(url, {'membership_id': str(self.editor_membership.id), 'amount': '250'}, format='json').status_code, 400)
        # No amount pays the rest ("Mark as paid (demo)").
        self.assertEqual(self.client.post(url, {'membership_id': str(self.editor_membership.id)}, format='json').status_code, 201)
        balance = billing.editor_balance(self.editor_membership)
        self.assertEqual((balance['paid_amount'], balance['owed_amount']), (Decimal('300.00'), Decimal('0.00')))
        # Theo's pay is still pending (task not approved), so there is nothing to pay out.
        self.assertEqual(self.client.post(url, {'membership_id': str(self.other_membership.id)}, format='json').status_code, 409)
        ledger = {row['name']: row for row in self.client.get(url).json()['results']}
        self.assertEqual((ledger['Maya Editor']['paid'], ledger['Maya Editor']['owed']), ('300.00', '0.00'))
        self.assertEqual((ledger['Theo Editor']['pending'], ledger['Theo Editor']['earned']), ('120.50', '0.00'))


class ScopingTests(BillingBase, TestCase):
    def test_an_editor_sees_only_their_own_pay_and_never_client_prices(self):
        first, second = self.priced_project()
        self.as_user(self.editor)
        mine = self.client.get(self.url('api-billing-task', first['id'])).json()
        self.assertNotIn('client_price', mine)
        self.assertEqual([(line['name'], line['amount'], line['is_me']) for line in mine['editor_pay']], [('Maya Editor', '300.00', True)])
        self.assertIsNone(mine['editor_pay'][0]['default_rate'])
        theirs = self.client.get(self.url('api-billing-task', second['id'])).json()
        self.assertEqual(theirs['editor_pay'], [])
        self.assertNotIn('client_price', theirs)

        for name, args in (('api-billing-summary', ()), ('api-billing-invoices', ()), ('api-billing-payouts', ()),
                           ('api-billing-project', (self.project_id,)), ('api-billing-settings', ())):
            self.assertEqual(self.client.get(self.url(name, *args)).status_code, 403, name)
        self.patch_money(first['id'], {'client_price': '1'}, user=self.editor, expect=403)
        self.patch_money(first['id'], {'editor_pay': {'membership_id': str(self.editor_membership.id), 'amount': '9000'}}, user=self.editor, expect=403)

        earnings = self.client.get(self.url('api-billing-my-earnings')).json()
        self.assertEqual((earnings['pending'], earnings['earned'], earnings['paid']), ('300.00', '0.00', '0.00'))
        self.assertNotIn('client_price', str(earnings))
        self.assertEqual([line['task'] for line in earnings['lines']], ['Hero 30s'])

        # The ordinary task and project payloads never carry prices.
        task_payload = self.client.get(reverse('api-task-detail', args=[self.workspace.id, first['id']])).json()
        self.assertFalse({'client_price', 'client_price_currency'} & set(task_payload))
        project_payload = self.client.get(reverse('api-project-detail', args=[self.workspace.id, self.project_id])).json()
        self.assertFalse({'client_fee', 'client_fee_currency'} & set(project_payload))

    def test_an_invoice_is_hidden_from_an_editor(self):
        self.priced_project()
        invoice = self.invoice()
        self.as_user(self.editor)
        self.assertEqual(self.client.get(self.url('api-billing-invoice-detail', invoice['id'])).status_code, 404)

    def test_a_client_sees_only_their_own_sent_invoices_and_no_editor_pay(self):
        first, _ = self.priced_project()
        sent = self.invoice()
        client_user = self.add_client_member(team_name='Northlight members')
        # add_client_member made a new team; put Cleo in Northlight's team instead.
        from .models import ClientTeamMember
        ClientTeamMember.objects.filter(user=client_user).update(client_team=self.team)
        from .models import WorkspaceMembership
        WorkspaceMembership.objects.filter(workspace=self.workspace, principal_type='CLIENT_TEAM').update(client_team=self.team)

        # Another client's invoice and a draft of our own client's.
        other_team = ClientTeam.objects.create(id=__import__('uuid').uuid4(), workspace=self.workspace, name='Atlas Fitness', created_at=timezone.now(), updated_at=timezone.now())
        self.as_user(self.owner)
        other_project = self.client.post(reverse('api-projects', args=[self.workspace.id]), {'name': 'Q4 Reels', 'client_team_id': str(other_team.id)}, format='json').json()
        self.client.patch(self.url('api-billing-project', other_project['id']), {'fee': '800'}, format='json')
        other = self.client.post(self.url('api-billing-invoices'), {'project_id': other_project['id']}, format='json').json()
        self.client.post(self.url('api-billing-invoice-send', other['id']))
        self.task('Late add-on', self.editor_membership)
        Task.objects.filter(title='Late add-on').update(client_price=Decimal('75'))
        draft = self.invoice(send=False)

        self.as_user(client_user)
        mine = self.client.get(self.url('api-billing-my-invoices')).json()
        self.assertEqual([row['number'] for row in mine['results']], [sent['number']])
        self.assertEqual(mine['outstanding'], '1400.00')
        detail = self.client.get(self.url('api-billing-invoice-detail', sent['id']))
        self.assertEqual(detail.status_code, 200)
        self.assertNotIn('editor', str(detail.json()).lower())
        self.assertFalse(detail.json()['viewer_can_manage'])
        self.assertEqual(self.client.get(self.url('api-billing-invoice-detail', other['id'])).status_code, 404)
        self.assertEqual(self.client.get(self.url('api-billing-invoice-detail', draft['id'])).status_code, 404)
        task_money = self.client.get(self.url('api-billing-task', first['id'])).json()
        self.assertEqual(task_money['editor_pay'], [])
        self.assertNotIn('client_price', task_money)
        for name in ('api-billing-summary', 'api-billing-payouts', 'api-billing-my-earnings'):
            self.assertEqual(self.client.get(self.url(name)).status_code, 403, name)
        self.assertEqual(self.client.post(self.url('api-billing-invoice-payments', sent['id']), {}, format='json').status_code, 403)

    def test_an_editor_gets_no_client_invoices(self):
        self.as_user(self.editor)
        self.assertEqual(self.client.get(self.url('api-billing-my-invoices')).status_code, 403)


class TotalsAndInvoiceTests(BillingBase, TestCase):
    def test_project_total_is_fee_plus_task_prices(self):
        self.priced_project()
        pricing = self.set_fee('1000.00')
        self.assertEqual((pricing['fee'], pricing['tasks_total'], pricing['total'], pricing['uninvoiced']), ('1000.00', '400.00', '1400.00', '1400.00'))
        self.assertEqual(self.set_fee('')['fee'], None)

    def test_invoice_snapshots_priced_items_and_does_not_double_bill(self):
        first, _ = self.priced_project()
        invoice = self.invoice(send=False)
        self.assertEqual([(line['kind'], line['amount']) for line in invoice['lines']], [('project_fee', '1000.00'), ('task', '250.00'), ('task', '150.00')])
        self.assertEqual((invoice['total'], invoice['status'], invoice['number']), ('1400.00', 'draft', 'INV-0001'))
        # Re-pricing a task later leaves the issued line alone.
        self.patch_money(first['id'], {'client_price': '999'})
        self.assertEqual(self.client.get(self.url('api-billing-invoice-detail', invoice['id'])).json()['total'], '1400.00')
        # Everything is invoiced, so a second invoice has nothing to list.
        self.as_user(self.owner)
        self.assertEqual(self.client.post(self.url('api-billing-invoices'), {'project_id': self.project_id}, format='json').status_code, 400)
        self.task('Extra cutdown', self.editor_membership)
        Task.objects.filter(title='Extra cutdown').update(client_price=Decimal('60'))
        second = self.invoice(send=False)
        self.assertEqual((second['number'], second['total']), ('INV-0002', '60.00'))

    def test_send_sets_issue_and_due_dates(self):
        self.priced_project()
        invoice = self.invoice()
        self.assertEqual(invoice['status'], 'sent')
        self.assertEqual(invoice['issue_date'], timezone.localdate().isoformat())
        self.assertEqual(invoice['due_date'], (timezone.localdate() + timedelta(days=14)).isoformat())
        self.as_user(self.owner)
        self.assertEqual(self.client.post(self.url('api-billing-invoice-send', invoice['id'])).status_code, 409)

    def test_partial_payments_then_paid(self):
        self.priced_project()
        invoice = self.invoice()
        after_first = self.pay(invoice['id'], '400', method='bank_transfer', note='Deposit', paid_on='2026-09-30')
        self.assertEqual((after_first['paid'], after_first['outstanding'], after_first['status']), ('400.00', '1000.00', 'sent'))
        self.assertEqual(after_first['payments'][0]['note'], 'Deposit')
        self.assertEqual(after_first['payments'][0]['provider'], 'manual')
        self.pay(invoice['id'], '1000.01', expect=400)
        self.pay(invoice['id'], '-5', expect=400)
        self.pay(invoice['id'], 'lots', expect=400)
        after_second = self.pay(invoice['id'], 600)
        self.assertEqual((after_second['outstanding'], after_second['status']), ('400.00', 'sent'))
        done = self.pay(invoice['id'])  # no amount: the rest
        self.assertEqual((done['paid'], done['outstanding'], done['status'], done['display_status']), ('1400.00', '0.00', 'paid', 'paid'))
        self.assertIsNotNone(done['paid_at'])
        self.pay(invoice['id'], expect=409)

    def test_a_draft_cannot_be_paid(self):
        self.priced_project()
        draft = self.invoice(send=False)
        self.pay(draft['id'], expect=409)

    def test_overdue_is_sent_past_due_with_money_outstanding(self):
        self.priced_project()
        invoice = self.invoice(due_date=timezone.localdate() - timedelta(days=3))
        self.assertEqual(invoice['display_status'], 'overdue')
        obj = Invoice.objects.get(id=invoice['id'])
        self.assertEqual(billing.invoice_display_status(obj, today=obj.due_date), 'sent')  # due today is not overdue
        self.pay(invoice['id'], '400')
        summary = self.client.get(self.url('api-billing-summary')).json()
        self.assertEqual((summary['totals']['clients_owe'], summary['totals']['overdue']), ('1000.00', '1000.00'))
        self.assertEqual(self.pay(invoice['id'])['display_status'], 'paid')
        self.assertEqual(self.client.get(self.url('api-billing-summary')).json()['totals']['overdue'], '0.00')

    def test_summary_totals_and_margin(self):
        first, second = self.priced_project()
        self.move(first['id'], TaskStageKind.APPROVED)
        invoice = self.invoice()
        self.pay(invoice['id'], '500')
        self.as_user(self.owner)
        self.client.post(self.url('api-billing-payouts'), {'membership_id': str(self.editor_membership.id), 'amount': '100'}, format='json')
        summary = self.client.get(self.url('api-billing-summary')).json()
        totals = summary['totals']
        self.assertEqual(summary['currency'], 'GBP')
        self.assertEqual((totals['billed'], totals['collected'], totals['clients_owe']), ('1400.00', '500.00', '900.00'))
        self.assertEqual((totals['we_owe_editors'], totals['editors_paid'], totals['editors_pending']), ('200.00', '100.00', '120.50'))
        # Margin = project value (1400) - all editor pay on it (300 + 120.50).
        self.assertEqual((totals['project_value'], totals['editor_cost'], totals['margin']), ('1400.00', '420.50', '979.50'))
        self.assertAlmostEqual(totals['margin_percent'], 70.0)
        receivable = summary['receivables'][0]
        self.assertEqual((receivable['client']['name'], receivable['billed'], receivable['paid'], receivable['outstanding']), ('Northlight Coffee', '1400.00', '500.00', '900.00'))

    def test_summary_without_rates_visibility_has_no_editor_numbers(self):
        role = self.custom_role('Accounts', [*MEMBER_PERMISSION_KEYS, BILLING_VIEW])
        user, _ = self.add_member('accounts@example.com', role=role)
        self.priced_project()
        self.as_user(user)
        summary = self.client.get(self.url('api-billing-summary')).json()
        self.assertNotIn('payouts', summary)
        self.assertFalse({'we_owe_editors', 'margin', 'editor_cost'} & set(summary['totals']))
        self.assertEqual(self.client.get(self.url('api-billing-payouts')).status_code, 403)

    def test_currency_is_a_workspace_setting_stored_on_each_amount(self):
        self.as_user(self.owner)
        self.assertEqual(self.client.get(self.url('api-billing-settings')).json()['currency'], 'GBP')
        self.assertEqual(self.client.patch(self.url('api-billing-settings'), {'currency': 'usd'}, format='json').json()['currency'], 'USD')
        self.assertEqual(self.client.patch(self.url('api-billing-settings'), {'currency': '$$'}, format='json').status_code, 400)
        self.priced_project()
        self.assertEqual(Project.objects.get(id=self.project_id).client_fee_currency, 'USD')
        self.assertEqual(self.invoice()['currency'], 'USD')
        self.assertEqual(EditorPay.objects.filter(workspace=self.workspace).values_list('currency', flat=True).distinct().get(), 'USD')


class RecordPaymentIsTheOnlyPathTests(BillingBase, TestCase):
    def test_the_invoice_and_payout_routes_call_record_payment_with_the_manual_provider(self):
        first, _ = self.priced_project()
        self.move(first['id'], TaskStageKind.APPROVED)
        invoice = self.invoice()
        with mock.patch.object(billing, 'record_payment', wraps=billing.record_payment) as spy:
            self.pay(invoice['id'])
            self.as_user(self.owner)
            self.client.post(self.url('api-billing-payouts'), {'membership_id': str(self.editor_membership.id)}, format='json')
        self.assertEqual(spy.call_count, 2)
        self.assertEqual({call.kwargs['provider'] for call in spy.call_args_list}, {'manual'})
        self.assertEqual(Payment.objects.count(), 2)

    def test_nothing_else_writes_payments_or_marks_an_invoice_paid(self):
        app_dir = Path(__file__).resolve().parent
        billing_source = inspect.getsource(billing.record_payment)
        offenders = []
        for path in app_dir.rglob('*.py'):
            if path.name.startswith('test') or 'migrations' in path.parts:
                continue
            text = path.read_text()
            for pattern in (r'Payment\.objects\.(create|bulk_create|update|get_or_create)', r'(?<![A-Za-z])Payment\((?!models\.Model)', r'InvoiceStatus\.PAID\b', r"status\s*=\s*['\"]paid['\"]"):
                for match in re.finditer(pattern, text):
                    line = text[:match.start()].count('\n')
                    snippet = text.splitlines()[line].strip()
                    if path.name == 'billing.py' and snippet in billing_source:
                        continue
                    offenders.append(f'{path.name}:{line + 1}: {snippet}')
        self.assertEqual(offenders, [])

    def test_the_status_field_cannot_be_set_to_paid_through_the_api(self):
        self.priced_project()
        invoice = self.invoice()
        self.as_user(self.owner)
        response = self.client.patch(self.url('api-billing-invoice-detail', invoice['id']), {'status': 'paid'}, format='json')
        self.assertEqual(response.status_code, 405)
        self.assertEqual(Invoice.objects.get(id=invoice['id']).status, InvoiceStatus.SENT)

    def test_a_gateway_reference_makes_a_repeat_delivery_a_no_op(self):
        """What a future Stripe webhook relies on: same provider_reference, one payment."""
        self.priced_project()
        invoice = Invoice.objects.get(id=self.invoice()['id'])
        first = billing.record_payment(workspace=self.workspace, invoice=invoice, amount='100', provider='manual', provider_reference='evt_demo_1')
        again = billing.record_payment(workspace=self.workspace, invoice=invoice, amount='100', provider='manual', provider_reference='evt_demo_1')
        self.assertEqual(first.id, again.id)
        self.assertEqual(billing.invoice_paid(invoice), Decimal('100.00'))
        self.assertIsNone(first.recorded_by_user)

    def test_record_payment_refuses_ambiguous_or_unknown_input(self):
        self.priced_project()
        invoice = Invoice.objects.get(id=self.invoice()['id'])
        with self.assertRaises(billing.BillingError):
            billing.record_payment(workspace=self.workspace, amount='1')
        with self.assertRaises(billing.BillingError):
            billing.record_payment(workspace=self.workspace, invoice=invoice, payee_membership=self.editor_membership, amount='1')
        with self.assertRaises(billing.BillingError):
            billing.record_payment(workspace=self.workspace, invoice=invoice, amount='1', provider='stripe')


class SeedCommandTests(BillingBase, TestCase):
    def test_seed_billing_demo_runs_and_is_repeatable(self):
        self.task('Hero 30s', self.editor_membership)
        approved = self.task('Thumbnail options', self.other_membership)
        self.move(approved['id'], TaskStageKind.APPROVED)
        call_command('seed_billing_demo', workspace=self.workspace.slug, stdout=open('/dev/null', 'w'))
        self.assertTrue(Invoice.objects.filter(workspace=self.workspace).exists())
        self.assertTrue(Payment.objects.filter(workspace=self.workspace).exists())
        first_counts = (Invoice.objects.count(), Payment.objects.count(), EditorPay.objects.count())
        call_command('seed_billing_demo', workspace=self.workspace.slug, reset=True, stdout=open('/dev/null', 'w'))
        self.assertEqual((Invoice.objects.count(), Payment.objects.count(), EditorPay.objects.count()), first_counts)

    def test_seed_refuses_a_second_run_without_reset(self):
        call_command('seed_billing_demo', workspace=self.workspace.slug, stdout=open('/dev/null', 'w'))
        from django.core.management.base import CommandError
        with self.assertRaises(CommandError):
            call_command('seed_billing_demo', workspace=self.workspace.slug, stdout=open('/dev/null', 'w'))
