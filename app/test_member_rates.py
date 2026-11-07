from django.test import TestCase
from django.urls import reverse

from .test_billing import BillingBase


class MemberRatesTests(BillingBase, TestCase):
    def test_lists_every_active_team_member_with_rates(self):
        self.as_user(self.owner)
        self.client.patch(self.url('api-billing-member-rate', self.editor_membership.id), {'default_task_rate': '120'}, format='json')
        response = self.client.get(reverse('api-billing-member-rates', args=[self.workspace.id]))
        self.assertEqual(response.status_code, 200, response.content)
        rows = {row['email']: row for row in response.json()['results']}
        self.assertEqual(rows['maya@example.com']['default_rate'], '120.00')
        self.assertIsNone(rows['theo@example.com']['default_rate'])
        self.assertIn(self.owner.email, rows)

    def test_members_without_rates_view_are_refused(self):
        self.as_user(self.editor)
        self.assertEqual(self.client.get(reverse('api-billing-member-rates', args=[self.workspace.id])).status_code, 403)
