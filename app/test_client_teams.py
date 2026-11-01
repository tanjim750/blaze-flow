from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from .models import (
    ClientTeam,
    ClientTeamInvite,
    ClientTeamInviteAcceptance,
    ClientTeamMember,
    ClientTeamMemberStatus,
    ClientTeamStatus,
    WorkspaceMembership,
    WorkspaceMembershipStatus,
    WorkspacePrincipalType,
)
from .permissions import WORKSPACE_READ, has_workspace_permission
from .services import create_workspace
from .test_access_projects import WorkspaceAccessSetupMixin


class ClientTeamAdministrationApiTests(WorkspaceAccessSetupMixin, TestCase):
    def create_client_team_as_owner(self, name='Acme Corp'):
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            reverse('api-client-teams', args=[self.workspace.id]),
            {'name': name, 'website': 'https://acme.example.com'},
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        return ClientTeam.objects.get(id=response.json()['id'])

    def test_owner_can_create_and_read_client_team(self):
        team = self.create_client_team_as_owner()
        self.assertEqual(team.workspace, self.workspace)
        self.assertEqual(team.status, ClientTeamStatus.ACTIVE)

        response = self.client.get(
            reverse('api-client-team-detail', args=[self.workspace.id, team.id])
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['name'], 'Acme Corp')

    def test_member_cannot_create_client_team(self):
        self.invite_and_accept()
        self.client.force_authenticate(self.member_user)

        response = self.client.post(
            reverse('api-client-teams', args=[self.workspace.id]),
            {'name': 'Should Fail'},
            format='json',
        )

        self.assertEqual(response.status_code, 403)
        self.assertFalse(ClientTeam.objects.filter(name='Should Fail').exists())

    def test_member_can_read_client_teams(self):
        self.create_client_team_as_owner()
        self.invite_and_accept()
        self.client.force_authenticate(self.member_user)

        response = self.client.get(reverse('api-client-teams', args=[self.workspace.id]))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 1)

    def test_outsider_cannot_read_client_teams(self):
        team = self.create_client_team_as_owner()
        outsider = WorkspaceMembership._meta.get_field('user').remote_field.model.objects.create_user(
            email='outsider@example.com',
            password='a-secure-test-password',
            first_name='Out',
            last_name='Sider',
        )
        self.client.force_authenticate(outsider)

        response = self.client.get(
            reverse('api-client-team-detail', args=[self.workspace.id, team.id])
        )

        self.assertEqual(response.status_code, 403)

    def test_owner_can_update_client_team_profile(self):
        team = self.create_client_team_as_owner()

        response = self.client.patch(
            reverse('api-client-team-detail', args=[self.workspace.id, team.id]),
            {'phone': '+1-555-0100', 'city': 'Austin'},
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        team.refresh_from_db()
        self.assertEqual(team.phone, '+1-555-0100')
        self.assertEqual(team.city, 'Austin')

    def test_owner_can_archive_client_team(self):
        team = self.create_client_team_as_owner()

        response = self.client.delete(
            reverse('api-client-team-detail', args=[self.workspace.id, team.id])
        )

        self.assertEqual(response.status_code, 204)
        team.refresh_from_db()
        self.assertEqual(team.status, ClientTeamStatus.ARCHIVED)

    def test_archiving_twice_is_rejected(self):
        team = self.create_client_team_as_owner()
        self.client.delete(reverse('api-client-team-detail', args=[self.workspace.id, team.id]))

        response = self.client.delete(
            reverse('api-client-team-detail', args=[self.workspace.id, team.id])
        )

        self.assertEqual(response.status_code, 400)

    def test_cross_workspace_client_team_is_not_found(self):
        team = self.create_client_team_as_owner()
        other_owner = WorkspaceMembership._meta.get_field('user').remote_field.model.objects.create_user(
            email='other-owner@example.com',
            password='a-secure-test-password',
            first_name='Other',
            last_name='Owner',
        )
        other_workspace, _ = create_workspace(
            owner=other_owner,
            name='Other Workspace',
            slug='other-workspace-client-teams',
            workspace_timezone='UTC',
        )

        response = self.client.get(
            reverse('api-client-team-detail', args=[other_workspace.id, team.id])
        )

        self.assertEqual(response.status_code, 404)


class ClientTeamMemberApiTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            reverse('api-client-teams', args=[self.workspace.id]),
            {'name': 'Acme Corp'},
            format='json',
        )
        self.team = ClientTeam.objects.get(id=response.json()['id'])

    def test_owner_can_add_existing_user_as_member(self):
        response = self.client.post(
            reverse('api-client-team-members', args=[self.workspace.id, self.team.id]),
            {'email': self.member_user.email, 'title': 'Marketing Manager'},
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        member = ClientTeamMember.objects.get(client_team=self.team, user=self.member_user)
        self.assertEqual(member.status, ClientTeamMemberStatus.ACTIVE)
        self.assertEqual(member.title, 'Marketing Manager')

    def test_adding_unknown_email_is_rejected(self):
        response = self.client.post(
            reverse('api-client-team-members', args=[self.workspace.id, self.team.id]),
            {'email': 'nobody@example.com'},
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn('email', response.json())

    def test_adding_the_same_member_twice_is_rejected(self):
        self.client.post(
            reverse('api-client-team-members', args=[self.workspace.id, self.team.id]),
            {'email': self.member_user.email},
            format='json',
        )

        response = self.client.post(
            reverse('api-client-team-members', args=[self.workspace.id, self.team.id]),
            {'email': self.member_user.email},
            format='json',
        )

        self.assertEqual(response.status_code, 400)

    def test_removing_and_reactivating_a_member(self):
        add_response = self.client.post(
            reverse('api-client-team-members', args=[self.workspace.id, self.team.id]),
            {'email': self.member_user.email},
            format='json',
        )
        member_id = add_response.json()['id']

        remove_response = self.client.delete(
            reverse(
                'api-client-team-member-detail',
                args=[self.workspace.id, self.team.id, member_id],
            )
        )
        self.assertEqual(remove_response.status_code, 204)
        member = ClientTeamMember.objects.get(id=member_id)
        self.assertEqual(member.status, ClientTeamMemberStatus.REMOVED)
        self.assertIsNotNone(member.removed_at)
        original_joined_at = member.joined_at

        reactivate_response = self.client.post(
            reverse('api-client-team-members', args=[self.workspace.id, self.team.id]),
            {'email': self.member_user.email},
            format='json',
        )

        self.assertEqual(reactivate_response.status_code, 201)
        member.refresh_from_db()
        self.assertEqual(member.status, ClientTeamMemberStatus.ACTIVE)
        self.assertIsNone(member.removed_at)
        self.assertEqual(member.joined_at, original_joined_at)
        self.assertEqual(ClientTeamMember.objects.filter(client_team=self.team, user=self.member_user).count(), 1)

    def test_removing_an_already_removed_member_is_rejected(self):
        add_response = self.client.post(
            reverse('api-client-team-members', args=[self.workspace.id, self.team.id]),
            {'email': self.member_user.email},
            format='json',
        )
        member_id = add_response.json()['id']
        self.client.delete(
            reverse(
                'api-client-team-member-detail',
                args=[self.workspace.id, self.team.id, member_id],
            )
        )

        response = self.client.delete(
            reverse(
                'api-client-team-member-detail',
                args=[self.workspace.id, self.team.id, member_id],
            )
        )

        self.assertEqual(response.status_code, 400)

    def test_member_cannot_add_client_team_members(self):
        self.invite_and_accept()
        self.client.force_authenticate(self.member_user)

        response = self.client.post(
            reverse('api-client-team-members', args=[self.workspace.id, self.team.id]),
            {'email': self.owner.email},
            format='json',
        )

        self.assertEqual(response.status_code, 403)


class ClientTeamWorkspaceAccessApiTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            reverse('api-client-teams', args=[self.workspace.id]),
            {'name': 'Acme Corp'},
            format='json',
        )
        self.team = ClientTeam.objects.get(id=response.json()['id'])
        self.client.post(
            reverse('api-client-team-members', args=[self.workspace.id, self.team.id]),
            {'email': self.member_user.email},
            format='json',
        )

    def test_granting_workspace_access_creates_client_team_membership_and_inherits_permissions(self):
        response = self.client.post(
            reverse('api-client-team-workspace-access', args=[self.workspace.id, self.team.id]),
            {'role_id': str(self.member_role.id), 'project_access_mode': 'ALL'},
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        membership = WorkspaceMembership.objects.get(
            workspace=self.workspace,
            principal_type=WorkspacePrincipalType.CLIENT_TEAM,
            client_team=self.team,
        )
        self.assertEqual(membership.status, WorkspaceMembershipStatus.ACTIVE)
        self.assertTrue(
            has_workspace_permission(
                user=self.member_user,
                workspace=self.workspace,
                permission_key=WORKSPACE_READ,
            )
        )

    def test_granting_workspace_access_twice_is_rejected(self):
        self.client.post(
            reverse('api-client-team-workspace-access', args=[self.workspace.id, self.team.id]),
            {'role_id': str(self.member_role.id)},
            format='json',
        )

        response = self.client.post(
            reverse('api-client-team-workspace-access', args=[self.workspace.id, self.team.id]),
            {'role_id': str(self.member_role.id)},
            format='json',
        )

        self.assertEqual(response.status_code, 400)

    def test_only_workspace_members_manage_permission_can_grant_access(self):
        self.invite_and_accept()
        self.client.force_authenticate(self.member_user)

        response = self.client.post(
            reverse('api-client-team-workspace-access', args=[self.workspace.id, self.team.id]),
            {'role_id': str(self.member_role.id)},
            format='json',
        )

        self.assertEqual(response.status_code, 403)

    def test_archived_client_team_cannot_be_granted_workspace_access(self):
        self.client.delete(
            reverse('api-client-team-detail', args=[self.workspace.id, self.team.id])
        )

        response = self.client.post(
            reverse('api-client-team-workspace-access', args=[self.workspace.id, self.team.id]),
            {'role_id': str(self.member_role.id)},
            format='json',
        )

        self.assertEqual(response.status_code, 404)


class ClientTeamInviteApiTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            reverse('api-client-teams', args=[self.workspace.id]),
            {'name': 'Acme Corp'},
            format='json',
        )
        self.team = ClientTeam.objects.get(id=response.json()['id'])

    def create_email_invite(self, email='invitee@example.com'):
        response = self.client.post(
            reverse('api-client-team-invites', args=[self.workspace.id, self.team.id]),
            {'invite_type': 'EMAIL', 'recipient_email': email},
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        return response.json()

    def create_link_invite(self, max_uses=None):
        payload = {'invite_type': 'LINK', 'label': 'Kickoff link'}
        if max_uses is not None:
            payload['max_uses'] = max_uses
        response = self.client.post(
            reverse('api-client-team-invites', args=[self.workspace.id, self.team.id]),
            payload,
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        return response.json()

    def test_owner_can_create_email_invite_and_token_is_returned_once(self):
        data = self.create_email_invite()

        self.assertIn('token', data)
        invite = ClientTeamInvite.objects.get(id=data['id'])
        self.assertEqual(invite.invite_type, 'EMAIL')
        self.assertEqual(invite.recipient_email, 'invitee@example.com')
        self.assertEqual(invite.max_uses, 1)
        self.assertNotEqual(invite.token_hash, data['token'])

    def test_email_invite_requires_recipient_email(self):
        response = self.client.post(
            reverse('api-client-team-invites', args=[self.workspace.id, self.team.id]),
            {'invite_type': 'EMAIL'},
            format='json',
        )

        self.assertEqual(response.status_code, 400)

    def test_link_invite_rejects_recipient_email(self):
        response = self.client.post(
            reverse('api-client-team-invites', args=[self.workspace.id, self.team.id]),
            {'invite_type': 'LINK', 'recipient_email': 'nope@example.com'},
            format='json',
        )

        self.assertEqual(response.status_code, 400)

    def test_member_cannot_create_or_list_invites(self):
        self.invite_and_accept()
        self.client.force_authenticate(self.member_user)

        create_response = self.client.post(
            reverse('api-client-team-invites', args=[self.workspace.id, self.team.id]),
            {'invite_type': 'LINK'},
            format='json',
        )
        list_response = self.client.get(
            reverse('api-client-team-invites', args=[self.workspace.id, self.team.id])
        )

        self.assertEqual(create_response.status_code, 403)
        self.assertEqual(list_response.status_code, 403)

    def test_list_invites_does_not_expose_token_hash(self):
        self.create_email_invite()

        response = self.client.get(
            reverse('api-client-team-invites', args=[self.workspace.id, self.team.id])
        )

        self.assertEqual(response.status_code, 200)
        self.assertNotIn('token_hash', response.json()[0])
        self.assertNotIn('token', response.json()[0])

    def test_accepting_email_invite_creates_member(self):
        data = self.create_email_invite(email=self.member_user.email)

        self.client.force_authenticate(self.member_user)
        response = self.client.post(
            reverse('api-client-team-invite-accept'),
            {'token': data['token']},
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        member = ClientTeamMember.objects.get(client_team=self.team, user=self.member_user)
        self.assertEqual(member.status, ClientTeamMemberStatus.ACTIVE)
        self.assertEqual(
            ClientTeamInviteAcceptance.objects.filter(
                invite_id=data['id'], user=self.member_user
            ).count(),
            1,
        )
        invite = ClientTeamInvite.objects.get(id=data['id'])
        self.assertEqual(invite.use_count, 1)

    def test_accepting_email_invite_twice_is_idempotent(self):
        data = self.create_email_invite(email=self.member_user.email)
        self.client.force_authenticate(self.member_user)
        self.client.post(
            reverse('api-client-team-invite-accept'), {'token': data['token']}, format='json'
        )

        response = self.client.post(
            reverse('api-client-team-invite-accept'), {'token': data['token']}, format='json'
        )

        self.assertEqual(response.status_code, 201)
        invite = ClientTeamInvite.objects.get(id=data['id'])
        self.assertEqual(invite.use_count, 1)
        self.assertEqual(
            ClientTeamInviteAcceptance.objects.filter(invite=invite, user=self.member_user).count(),
            1,
        )

    def test_accepting_email_invite_with_mismatched_email_is_rejected(self):
        data = self.create_email_invite(email='someone-else@example.com')

        self.client.force_authenticate(self.member_user)
        response = self.client.post(
            reverse('api-client-team-invite-accept'), {'token': data['token']}, format='json'
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(ClientTeamMember.objects.filter(client_team=self.team, user=self.member_user).exists())

    def test_link_invite_reaches_usage_limit(self):
        data = self.create_link_invite(max_uses=1)
        other_user = get_user_model().objects.create_user(
            email='second-guest@example.com',
            password='a-secure-test-password',
            first_name='Second',
            last_name='Guest',
        )

        self.client.force_authenticate(self.member_user)
        first = self.client.post(
            reverse('api-client-team-invite-accept'), {'token': data['token']}, format='json'
        )
        self.client.force_authenticate(other_user)
        second = self.client.post(
            reverse('api-client-team-invite-accept'), {'token': data['token']}, format='json'
        )

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 400)
        self.assertFalse(ClientTeamMember.objects.filter(client_team=self.team, user=other_user).exists())

    def test_link_invite_reactivates_a_removed_member(self):
        data = self.create_link_invite()
        self.client.post(
            reverse('api-client-team-members', args=[self.workspace.id, self.team.id]),
            {'email': self.member_user.email},
            format='json',
        )
        member = ClientTeamMember.objects.get(client_team=self.team, user=self.member_user)
        original_joined_at = member.joined_at
        self.client.delete(
            reverse(
                'api-client-team-member-detail',
                args=[self.workspace.id, self.team.id, member.id],
            )
        )

        self.client.force_authenticate(self.member_user)
        response = self.client.post(
            reverse('api-client-team-invite-accept'), {'token': data['token']}, format='json'
        )

        self.assertEqual(response.status_code, 201)
        member.refresh_from_db()
        self.assertEqual(member.status, ClientTeamMemberStatus.ACTIVE)
        self.assertIsNone(member.removed_at)
        self.assertEqual(member.joined_at, original_joined_at)

    def test_revoked_invite_cannot_be_accepted(self):
        data = self.create_link_invite()
        self.client.delete(
            reverse(
                'api-client-team-invite-detail',
                args=[self.workspace.id, self.team.id, data['id']],
            )
        )

        self.client.force_authenticate(self.member_user)
        response = self.client.post(
            reverse('api-client-team-invite-accept'), {'token': data['token']}, format='json'
        )

        self.assertEqual(response.status_code, 400)

    def test_revoking_an_already_revoked_invite_is_rejected(self):
        data = self.create_link_invite()
        self.client.delete(
            reverse(
                'api-client-team-invite-detail',
                args=[self.workspace.id, self.team.id, data['id']],
            )
        )

        response = self.client.delete(
            reverse(
                'api-client-team-invite-detail',
                args=[self.workspace.id, self.team.id, data['id']],
            )
        )

        self.assertEqual(response.status_code, 400)

    def test_expired_invite_cannot_be_accepted(self):
        data = self.create_link_invite()
        invite = ClientTeamInvite.objects.get(id=data['id'])
        invite.expires_at = timezone.now() - timezone.timedelta(days=1)
        invite.save(update_fields=['expires_at'])

        self.client.force_authenticate(self.member_user)
        response = self.client.post(
            reverse('api-client-team-invite-accept'), {'token': data['token']}, format='json'
        )

        self.assertEqual(response.status_code, 400)

    def test_invalid_token_is_rejected(self):
        self.client.force_authenticate(self.member_user)

        response = self.client.post(
            reverse('api-client-team-invite-accept'), {'token': 'x' * 40}, format='json'
        )

        self.assertEqual(response.status_code, 400)
