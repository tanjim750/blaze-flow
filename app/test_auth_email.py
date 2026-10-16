from io import StringIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core import mail
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from .models import Role
from .services import create_workspace
from .services.invitations import create_invitation
from .services.mailer import render_email


User = get_user_model()


def _payload(email='new@example.com', **extra):
    return {
        'email': email, 'password': 'a-long-unique-passphrase-91', 'first_name': 'New',
        'last_name': 'Person', **extra,
    }


class _WorkspaceMixin:
    def make_workspace(self):
        self.owner = User.objects.create_user(
            email='owner@example.com', password='a-secure-test-password', first_name='Olive', last_name='Owner',
        )
        self.workspace, self.membership = create_workspace(
            owner=self.owner, name='Acme Studio', slug='acme-studio', workspace_timezone='UTC',
        )
        self.role = Role.objects.filter(workspace=self.workspace).first()

    def invite(self, email):
        return create_invitation(
            workspace=self.workspace, email=email, role=self.role,
            invited_by_membership=self.membership, project_access_mode='ALL',
        )


class SignupModeTests(_WorkspaceMixin, TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_config_reports_mode(self):
        self.assertEqual(self.client.get(reverse('api-auth-config')).json(), {'signup_mode': 'open'})
        with override_settings(SIGNUP_MODE='invite_only'):
            self.assertEqual(self.client.get(reverse('api-auth-config')).json()['signup_mode'], 'invite_only')

    def test_open_mode_allows_anyone(self):
        response = self.client.post(reverse('api-register'), _payload(), format='json')
        self.assertEqual(response.status_code, 201)

    @override_settings(SIGNUP_MODE='invite_only')
    def test_invite_only_blocks_uninvited(self):
        response = self.client.post(reverse('api-register'), _payload(), format='json')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['code'], 'signup_closed')
        self.assertFalse(User.objects.filter(email='new@example.com').exists())

    @override_settings(SIGNUP_MODE='invite_only')
    def test_invite_only_allows_pending_workspace_invite_by_email(self):
        self.make_workspace()
        self.invite('new@example.com')
        response = self.client.post(reverse('api-register'), _payload(), format='json')
        self.assertEqual(response.status_code, 201)

    @override_settings(SIGNUP_MODE='invite_only')
    def test_invite_only_token_must_match_email(self):
        self.make_workspace()
        _, token = self.invite('someone-else@example.com')
        response = self.client.post(reverse('api-register'), _payload(invite_token=token), format='json')
        self.assertEqual(response.status_code, 403)
        response = self.client.post(
            reverse('api-register'), _payload('someone-else@example.com', invite_token=token), format='json',
        )
        self.assertEqual(response.status_code, 201)

    @override_settings(SIGNUP_MODE='invite_only', GOOGLE_OAUTH_CLIENT_ID='cid')
    @patch('app.services.google_oauth.verify_google_id_token')
    def test_google_new_account_blocked_but_existing_user_signs_in(self, verify):
        verify.return_value = {'sub': 's1', 'email': 'g@example.com', 'email_verified': True}
        response = self.client.post(reverse('api-google-login'), {'id_token': 't'}, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('invite-only', response.json()['detail'])
        User.objects.create_user(email='g@example.com', password='x-secure-password-1', first_name='G', last_name='U')
        response = self.client.post(reverse('api-google-login'), {'id_token': 't'}, format='json')
        self.assertEqual(response.status_code, 200)

    def test_invite_preview(self):
        self.make_workspace()
        _, token = self.invite('new@example.com')
        data = self.client.get(reverse('api-auth-invite-preview'), {'token': token}).json()
        self.assertEqual(data['workspace_name'], 'Acme Studio')
        self.assertEqual(data['state'], 'valid')
        self.assertEqual(data['email'], 'new@example.com')
        self.assertEqual(self.client.get(reverse('api-auth-invite-preview'), {'token': 'nope'}).status_code, 404)

    def test_platform_overview_shows_mode(self):
        from .test_platform_admin import grant
        staff = grant(User.objects.create_user(email='s@example.com', password='pw-123456789', first_name='S', last_name='S'))
        self.client.force_authenticate(staff)
        with override_settings(SIGNUP_MODE='invite_only'):
            response = self.client.get(reverse('api-platform-overview'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['signup_mode'], 'invite_only')


class EmailTemplateTests(_WorkspaceMixin, TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_register_sends_branded_verification_email(self):
        self.client.post(reverse('api-register'), _payload(), format='json')
        self.assertEqual(len(mail.outbox), 1)
        message = mail.outbox[0]
        self.assertEqual(message.subject, 'Verify your Blaze Flow email')
        self.assertIn('/verify-email?token=', message.body)
        html, mime = message.alternatives[0]
        self.assertEqual(mime, 'text/html')
        self.assertIn('Verify email', html)
        self.assertNotIn('&amp;', message.body)

    def test_password_reset_email(self):
        User.objects.create_user(email='r@example.com', password='x-secure-password-1', first_name='Rae', last_name='R')
        self.client.post(reverse('api-password-reset-request'), {'email': 'r@example.com'}, format='json')
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn('Reset your Blaze Flow password', mail.outbox[0].subject)
        self.assertIn('Hi Rae', mail.outbox[0].body)
        self.assertIn('Choose a new password', mail.outbox[0].alternatives[0][0])

    def test_workspace_invite_sends_email(self):
        self.make_workspace()
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            reverse('api-workspace-invitations', args=[self.workspace.id]),
            {'email': 'guest@example.com', 'role_id': str(self.role.id)}, format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertTrue(response.json()['email_sent'])
        message = mail.outbox[-1]
        self.assertEqual(message.to, ['guest@example.com'])
        self.assertIn('Acme Studio', message.subject)
        self.assertIn('/invite?token=', message.body)

    def test_mention_template_escapes_html(self):
        subject, text, html = render_email('mention', {
            'actor_name': 'Ann', 'excerpt': '<script>x</script>', 'action_url': 'https://a/b?x=1&y=2',
        })
        self.assertEqual(subject, 'Ann mentioned you in Blaze Flow')
        self.assertNotIn('<script>', html)
        self.assertIn('x=1&y=2', text)

    def test_send_test_email_command(self):
        out = StringIO()
        call_command('send_test_email', 'ops@example.com', stdout=out)
        self.assertIn('Sent test email', out.getvalue())
        self.assertEqual(mail.outbox[-1].to, ['ops@example.com'])
        with self.assertRaises(CommandError):
            call_command('send_test_email', 'not-an-email')
