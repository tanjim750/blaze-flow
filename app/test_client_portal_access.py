from django.test import TestCase

from app.models import (
    ClientTeam, RolePermission, User, WorkspaceMembership, WorkspacePrincipalType,
)
from app.permissions import PROJECT_FILE_UPDATE, PROJECT_READ, has_workspace_permission, WORKSPACE_READ
from app.services.client_team_invites import accept_client_team_invite, create_client_team_invite
from app.services.client_teams import create_client_team
from app.services.workspaces import create_workspace


class ClientInviteGrantsPortalAccessTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(email='owner@example.com', password='pw-12345678!', first_name='A', last_name='B')
        self.workspace, self.owner_membership = create_workspace(owner=self.owner, name='Studio', slug='studio', workspace_timezone='Europe/London')
        self.team = create_client_team(workspace=self.workspace, name='Acme', created_by_membership=self.owner_membership)
        self.client_user = User.objects.create_user(email='client@example.com', password='pw-12345678!', first_name='A', last_name='B')

    def _accept(self, **kwargs):
        invite, token = create_client_team_invite(
            client_team=self.team, created_by_membership=self.owner_membership, **kwargs,
        )
        return accept_client_team_invite(user=self.client_user, token=token)

    def test_link_invite_grants_restricted_client_role(self):
        self._accept(invite_type='LINK')
        membership = WorkspaceMembership.objects.get(
            principal_type=WorkspacePrincipalType.CLIENT_TEAM, client_team=self.team,
        )
        self.assertEqual(membership.role.name, 'Client')
        self.assertEqual(membership.project_access_mode, 'SELECTED')
        keys = set(RolePermission.objects.filter(role=membership.role).values_list('permission_key', flat=True))
        self.assertIn(PROJECT_READ, keys)
        self.assertNotIn(PROJECT_FILE_UPDATE, keys)
        self.assertTrue(has_workspace_permission(user=self.client_user, workspace=self.workspace, permission_key=WORKSPACE_READ))

    def test_second_accept_does_not_duplicate_access(self):
        self._accept(invite_type='LINK')
        other = User.objects.create_user(email='c2@example.com', password='pw-12345678!', first_name='A', last_name='B')
        invite, token = create_client_team_invite(client_team=self.team, created_by_membership=self.owner_membership, invite_type='LINK')
        accept_client_team_invite(user=other, token=token)
        self.assertEqual(WorkspaceMembership.objects.filter(client_team=self.team).count(), 1)

    def test_email_invite_marks_email_verified(self):
        self._accept(invite_type='EMAIL', recipient_email='client@example.com')
        self.client_user.refresh_from_db()
        self.assertIsNotNone(self.client_user.email_verified_at)


class InvitePreviewThrottleTests(TestCase):
    def test_invite_preview_keys_on_forwarded_client_ip(self):
        from unittest import mock

        from django.conf import settings
        from django.core.cache import cache
        from django.test import override_settings
        from rest_framework.test import APIClient

        from app.throttles import InvitePreviewThrottle

        cache.clear()
        self.addCleanup(cache.clear)
        with override_settings(REST_FRAMEWORK={**settings.REST_FRAMEWORK, 'NUM_PROXIES': 1}), \
                mock.patch.object(InvitePreviewThrottle, 'rate', '2/hour', create=True):
            client = APIClient()
            url = '/api/auth/invite-preview/?token=nope'
            for _ in range(2):
                self.assertNotEqual(client.get(url, HTTP_X_FORWARDED_FOR='203.0.113.1').status_code, 429)
            self.assertEqual(client.get(url, HTTP_X_FORWARDED_FOR='203.0.113.1').status_code, 429)
            # A different visitor behind the same frontend has their own bucket.
            self.assertNotEqual(client.get(url, HTTP_X_FORWARDED_FOR='203.0.113.2').status_code, 429)
