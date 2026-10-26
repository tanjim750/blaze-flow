"""The project pricing route says what a new invoice would hold, so the dialog can explain."""
from django.test import TestCase

from .test_billing import BillingBase


class BillableSummaryTests(BillingBase, TestCase):
    def billable(self, user=None, expect=200):
        self.as_user(user or self.owner)
        response = self.client.get(self.url('api-billing-project', self.project_id))
        self.assertEqual(response.status_code, expect, response.content)
        return response.json().get('billable')

    def test_unpriced_project(self):
        self.task('Unpriced cut', self.editor_membership)
        self.assertEqual(self.billable(), {'state': 'unpriced', 'items': 0, 'total': '0.00', 'has_client': True})

    def test_billable_counts_fee_and_priced_tasks(self):
        self.priced_project()
        self.assertEqual(self.billable(), {'state': 'billable', 'items': 3, 'total': '1400.00', 'has_client': True})

    def test_open_draft_is_its_own_state(self):
        self.priced_project()
        self.invoice(send=False)
        self.assertEqual(self.billable()['state'], 'draft')

    def test_everything_invoiced(self):
        self.priced_project()
        self.invoice()
        self.assertEqual(self.billable(), {'state': 'invoiced', 'items': 0, 'total': '0.00', 'has_client': True})

    def test_a_new_priced_task_after_invoicing_is_billable_again(self):
        self.priced_project()
        self.invoice()
        task = self.task('Bonus cut', self.editor_membership)
        self.patch_money(task['id'], {'client_price': '75'})
        self.assertEqual(self.billable(), {'state': 'billable', 'items': 1, 'total': '75.00', 'has_client': True})

    def test_editor_cannot_read_it(self):
        self.billable(self.editor, expect=403)
