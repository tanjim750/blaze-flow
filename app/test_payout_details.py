"""Editor payout details: saved per membership, encrypted, visible to the editor and billing managers only."""
from cryptography.fernet import Fernet
from django.test import TestCase, override_settings
from django.urls import reverse

from .models import AuditLog, MemberPayoutMethod, TaskStageKind
from .services import billing
from .test_billing import BillingBase

KEY = dict(GATEWAY_ENCRYPTION_KEY=Fernet.generate_key().decode())

BANK = {'method': 'bank_transfer', 'details': {'account_name': 'Maya Editor', 'bank_name': 'Dutch-Bangla Bank',
                                              'account_number': 'BD12345678901234', 'swift': 'DBBLBDDH', 'country': 'Bangladesh'}}
WISE = {'method': 'wise', 'details': {'email': 'maya@wise.example'}, 'is_preferred': True}


@override_settings(**KEY)
class PayoutDetailsTests(BillingBase, TestCase):
    def me(self):
        return reverse('api-billing-my-payout-details', args=[self.workspace.id])

    def member(self, membership):
        return reverse('api-billing-member-payout-details', args=[self.workspace.id, membership.id])

    def save(self, methods, user=None, expect=200):
        self.as_user(user or self.editor)
        response = self.client.put(self.me(), {'methods': methods}, format='json')
        self.assertEqual(response.status_code, expect, response.content)
        return response.json()

    def test_editor_saves_several_methods_with_one_preferred(self):
        data = self.save([BANK, WISE])
        self.assertEqual([m['method'] for m in data['methods']], ['bank_transfer', 'wise'])
        self.assertEqual(data['preferred']['method'], 'wise')
        self.assertEqual(sum(m['is_preferred'] for m in data['methods']), 1)
        self.as_user(self.editor)
        again = self.client.get(self.me()).json()
        self.assertEqual(again['methods'][0]['details']['account_number'], 'BD12345678901234')
        self.assertEqual(again['methods'][0]['fields'][0], {'name': 'account_name', 'label': 'Account name', 'value': 'Maya Editor'})

    def test_first_method_becomes_preferred_when_none_marked(self):
        data = self.save([BANK, {'method': 'paypal', 'details': {'email': 'm@pp.example'}}])
        self.assertEqual(data['preferred']['method'], 'bank_transfer')

    def test_details_are_encrypted_at_rest(self):
        self.save([BANK])
        row = MemberPayoutMethod.objects.get(workspace_membership=self.editor_membership)
        self.assertNotIn('BD12345678901234', row.encrypted_details)
        self.assertNotIn('Maya', row.encrypted_details)

    def test_validation(self):
        self.save([{'method': 'paypal', 'details': {'email': 'nope'}}], expect=400)
        self.save([{'method': 'upi', 'details': {'upi_id': 'maya'}}], expect=400)
        self.save([{'method': 'gcash', 'details': {'phone': 'abc'}}], expect=400)
        bad = self.save([{'method': 'bank_transfer', 'details': {'account_name': 'M'}}], expect=400)
        self.assertEqual(bad['field'], 'methods.0.bank_name')
        self.save([{'method': 'crypto', 'details': {}}], expect=400)
        ok = self.save([{'method': 'upi', 'details': {'upi_id': 'maya@okhdfc'}}, {'method': 'bkash_nagad', 'details': {'phone': '+8801712345678'}},
                        {'method': 'gcash', 'details': {'phone': '09171234567'}}, {'method': 'payoneer', 'details': {'email': 'm@p.example'}},
                        {'method': 'other', 'details': {'details': 'Cash at the office'}}])
        self.assertEqual(len(ok['methods']), 5)

    def test_change_writes_audit_without_secrets(self):
        self.save([BANK])
        self.save([WISE])
        logs = AuditLog.objects.filter(action='billing.payout_details.updated').order_by('created_at')
        self.assertEqual(logs.count(), 2)
        last = logs.last()
        self.assertEqual(last.metadata, {'before': ['bank_transfer'], 'after': ['wise'], 'preferred': 'wise'})
        self.assertTrue(last.team_only)
        self.assertNotIn('maya@wise.example', str(last.metadata))

    def test_owner_can_read_but_other_editors_and_clients_cannot(self):
        self.save([BANK, WISE])
        self.as_user(self.owner)
        response = self.client.get(self.member(self.editor_membership))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['preferred']['details']['email'], 'maya@wise.example')
        self.as_user(self.other_editor)
        self.assertEqual(self.client.get(self.member(self.editor_membership)).status_code, 403)
        self.as_user(self.editor)
        self.assertEqual(self.client.get(self.member(self.editor_membership)).status_code, 200)

    def test_client_has_no_payout_details(self):
        self.save([BANK])
        client_user = self.add_client_member('client@example.com')
        self.as_user(client_user)
        self.assertEqual(self.client.get(self.me()).status_code, 403)
        self.assertEqual(self.client.get(self.member(self.editor_membership)).status_code, 403)

    def test_only_billing_managers_see_preferred_method_in_ledger(self):
        self.priced_project()
        self.save([BANK, WISE])
        ledger = billing.payouts_ledger(workspace=self.workspace, with_payout_methods=True)
        maya = next(row for row in ledger if row['membership_id'] == str(self.editor_membership.id))
        self.assertEqual(maya['preferred_payout_method'], {'method': 'wise', 'label': 'Wise'})
        theo = next(row for row in ledger if row['membership_id'] == str(self.other_membership.id))
        self.assertIsNone(theo['preferred_payout_method'])
        self.assertNotIn('preferred_payout_method', billing.payouts_ledger(workspace=self.workspace)[0])
        self.as_user(self.owner)
        rows = self.client.get(self.url('api-billing-payouts')).json()['results']
        self.assertIn('preferred_payout_method', rows[0])

    def test_payout_can_be_recorded_with_new_methods(self):
        first, _ = self.priced_project()
        self.move(first['id'], TaskStageKind.APPROVED)
        self.as_user(self.owner)
        response = self.client.post(self.url('api-billing-payouts'), {'membership_id': str(self.editor_membership.id), 'amount': '10', 'method': 'wise'}, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()['method'], 'wise')

    @override_settings(GATEWAY_ENCRYPTION_KEY='')
    def test_refuses_to_save_without_encryption_key(self):
        self.save([WISE], expect=503)
        self.assertFalse(MemberPayoutMethod.objects.exists())
