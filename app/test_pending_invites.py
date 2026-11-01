from django.core import mail
from django.test import TestCase, override_settings
from django.urls import reverse

from .models import WorkspaceInvite
from .test_role_dashboards import DashboardBase


@override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
class PendingInviteTests(DashboardBase, TestCase):
    def url(self, name, *args):
        return reverse(name, args=[self.workspace.id, *args])

    def invite(self, email='new@studio.test'):
        self.as_user(self.owner)
        response = self.client.post(self.url('api-workspace-invitations'), {'email': email, 'role_id': str(self.member_role.id)}, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def test_lists_pending_with_role_and_inviter(self):
        first = self.invite()
        self.assertTrue(first['email_sent'])
        rows = self.client.get(self.url('api-workspace-invitations')).json()
        self.assertEqual([r['email'] for r in rows], ['new@studio.test'])
        self.assertEqual(rows[0]['role_name'], self.member_role.name)
        self.assertFalse(rows[0]['expired'])
        self.assertNotIn('token', rows[0])

    def test_resend_rotates_the_link_and_emails_again(self):
        first = self.invite()
        mail.outbox.clear()
        response = self.client.post(self.url('api-workspace-invitation-resend', first['id']))
        self.assertEqual(response.status_code, 201, response.content)
        data = response.json()
        self.assertNotEqual(data['id'], first['id'])
        self.assertNotEqual(data['token'], first['token'])
        self.assertEqual(len(mail.outbox), 1)
        self.assertIsNotNone(WorkspaceInvite.objects.get(id=first['id']).revoked_at)
        self.assertEqual([r['id'] for r in self.client.get(self.url('api-workspace-invitations')).json()], [data['id']])

    def test_revoke_removes_from_pending(self):
        first = self.invite()
        self.assertEqual(self.client.delete(self.url('api-workspace-invitation-detail', first['id'])).status_code, 204)
        self.assertEqual(self.client.get(self.url('api-workspace-invitations')).json(), [])
        self.assertEqual(self.client.post(self.url('api-workspace-invitation-resend', first['id'])).status_code, 400)

    def test_members_without_manage_cannot_list(self):
        self.invite()
        editor, _ = self.add_member('ed@studio.test')
        self.as_user(editor)
        self.assertEqual(self.client.get(self.url('api-workspace-invitations')).status_code, 403)
