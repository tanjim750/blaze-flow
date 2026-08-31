import uuid

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from .models import (
    ClientTeam,
    ClientTeamMember,
    ClientTeamMemberStatus,
    Project,
    ProjectAccessMode,
    ResourceAccess,
    Role,
    WorkspaceInvite,
    WorkspaceMembership,
    WorkspaceMembershipStatus,
    WorkspacePrincipalType,
)
from .permissions import PROJECT_READ, WORKSPACE_READ, has_workspace_permission
from .services import create_workspace


class WorkspaceAccessSetupMixin:
    def setUp(self):
        self.client = APIClient()
        user_model = WorkspaceMembership._meta.get_field('user').remote_field.model
        self.owner = user_model.objects.create_user(
            email='access-owner@example.com',
            password='a-secure-test-password',
            first_name='Access',
            last_name='Owner',
        )
        self.member_user = user_model.objects.create_user(
            email='member@example.com',
            password='a-secure-test-password',
            first_name='Workspace',
            last_name='Member',
        )
        self.workspace, self.owner_membership = create_workspace(
            owner=self.owner,
            name='Access Workspace',
            slug='access-workspace',
            workspace_timezone='UTC',
        )
        self.member_role = Role.objects.get(workspace=self.workspace, name='Member')

    def invite_and_accept(self, *, project_access_mode=ProjectAccessMode.ALL):
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            reverse('api-workspace-invitations', args=[self.workspace.id]),
            {
                'email': self.member_user.email,
                'role_id': str(self.member_role.id),
                'project_access_mode': project_access_mode,
            },
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        token = response.json()['token']
        self.last_invite_token = token
        invitation = WorkspaceInvite.objects.get(id=response.json()['id'])
        self.assertNotEqual(invitation.token_hash, token)

        self.client.force_authenticate(self.member_user)
        accepted = self.client.post(
            reverse('api-workspace-invite-accept'),
            {'token': token},
            format='json',
        )
        self.assertEqual(accepted.status_code, 201)
        return WorkspaceMembership.objects.get(workspace=self.workspace, user=self.member_user)


class WorkspaceAccessApiTests(WorkspaceAccessSetupMixin, TestCase):

    def test_invitation_creates_limited_member_and_cannot_be_reused(self):
        membership = self.invite_and_accept()
        self.assertEqual(membership.role, self.member_role)
        self.assertFalse(membership.is_primary_owner)

        reused = self.client.post(
            reverse('api-workspace-invite-accept'),
            {'token': self.last_invite_token},
            format='json',
        )
        self.assertEqual(reused.status_code, 400)

        forbidden = self.client.post(
            reverse('api-workspace-invitations', args=[self.workspace.id]),
            {
                'email': 'another@example.com',
                'role_id': str(self.member_role.id),
            },
            format='json',
        )
        self.assertEqual(forbidden.status_code, 403)

    def test_invitation_cannot_be_accepted_by_a_different_email(self):
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            reverse('api-workspace-invitations', args=[self.workspace.id]),
            {'email': self.member_user.email, 'role_id': str(self.member_role.id)},
            format='json',
        )
        token = response.json()['token']

        self.client.force_authenticate(self.owner)
        rejected = self.client.post(
            reverse('api-workspace-invite-accept'),
            {'token': token},
            format='json',
        )
        self.assertEqual(rejected.status_code, 400)
        self.assertFalse(
            WorkspaceMembership.objects.filter(
                workspace=self.workspace,
                user=self.member_user,
            ).exists()
        )

    def test_primary_owner_cannot_be_suspended_through_membership_api(self):
        self.client.force_authenticate(self.owner)
        response = self.client.patch(
            reverse(
                'api-workspace-member-detail',
                args=[self.workspace.id, self.owner_membership.id],
            ),
            {'status': WorkspaceMembershipStatus.SUSPENDED},
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.owner_membership.refresh_from_db()
        self.assertEqual(self.owner_membership.status, WorkspaceMembershipStatus.ACTIVE)

    def test_client_team_members_inherit_workspace_permissions(self):
        now = timezone.now()
        team = ClientTeam.objects.create(
            id=uuid.uuid4(),
            workspace=self.workspace,
            created_by_workspace_membership=self.owner_membership,
            name='Client Team',
            created_at=now,
            updated_at=now,
        )
        ClientTeamMember.objects.create(
            id=uuid.uuid4(),
            client_team=team,
            user=self.member_user,
            status=ClientTeamMemberStatus.ACTIVE,
            joined_at=now,
            created_at=now,
            updated_at=now,
        )
        WorkspaceMembership.objects.create(
            id=uuid.uuid4(),
            workspace=self.workspace,
            principal_type=WorkspacePrincipalType.CLIENT_TEAM,
            client_team=team,
            role=self.member_role,
            project_access_mode=ProjectAccessMode.ALL,
            status=WorkspaceMembershipStatus.ACTIVE,
            joined_at=now,
            created_at=now,
            updated_at=now,
        )

        self.assertTrue(
            has_workspace_permission(
                user=self.member_user,
                workspace=self.workspace,
                permission_key=WORKSPACE_READ,
            )
        )


class ProjectAuthorizationApiTests(WorkspaceAccessSetupMixin, TestCase):
    def create_project_as_owner(self, name='Campaign'):
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            reverse('api-projects', args=[self.workspace.id]),
            {'name': name, 'priority': 'HIGH'},
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        return Project.objects.get(id=response.json()['id'])

    def test_member_can_read_and_update_but_not_archive_project(self):
        self.invite_and_accept()
        project = self.create_project_as_owner()
        self.client.force_authenticate(self.member_user)

        read = self.client.get(
            reverse('api-project-detail', args=[self.workspace.id, project.id])
        )
        updated = self.client.patch(
            reverse('api-project-detail', args=[self.workspace.id, project.id]),
            {'name': 'Updated Campaign'},
            format='json',
        )
        archived = self.client.delete(
            reverse('api-project-detail', args=[self.workspace.id, project.id])
        )

        self.assertEqual(read.status_code, 200)
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(archived.status_code, 403)
        project.refresh_from_db()
        self.assertEqual(project.name, 'Updated Campaign')

    def test_selected_access_hides_ungranted_projects(self):
        membership = self.invite_and_accept(project_access_mode=ProjectAccessMode.SELECTED)
        project = self.create_project_as_owner()
        self.client.force_authenticate(self.member_user)

        project_list = self.client.get(reverse('api-projects', args=[self.workspace.id]))
        denied = self.client.get(
            reverse('api-project-detail', args=[self.workspace.id, project.id])
        )
        self.assertEqual(project_list.status_code, 200)
        self.assertEqual(project_list.json(), [])
        self.assertEqual(denied.status_code, 403)

        ResourceAccess.objects.create(
            id=uuid.uuid4(),
            workspace_membership=membership,
            project=project,
            created_at=timezone.now(),
        )
        allowed = self.client.get(
            reverse('api-project-detail', args=[self.workspace.id, project.id])
        )
        self.assertEqual(allowed.status_code, 200)

    def test_user_cannot_access_another_workspace_project(self):
        project = self.create_project_as_owner()
        user_model = type(self.owner)
        outsider = user_model.objects.create_user(
            email='outsider@example.com',
            password='a-secure-test-password',
            first_name='Outside',
            last_name='User',
        )
        other_workspace, _ = create_workspace(
            owner=outsider,
            name='Other Workspace',
            slug='other-project-workspace',
            workspace_timezone='UTC',
        )
        self.client.force_authenticate(outsider)

        denied = self.client.get(
            reverse('api-project-detail', args=[self.workspace.id, project.id])
        )
        mismatched_route = self.client.get(
            reverse('api-project-detail', args=[other_workspace.id, project.id])
        )

        self.assertEqual(denied.status_code, 403)
        self.assertEqual(mismatched_route.status_code, 404)

    def test_selected_member_gets_access_to_project_they_create(self):
        membership = self.invite_and_accept(project_access_mode=ProjectAccessMode.SELECTED)
        self.client.force_authenticate(self.member_user)
        response = self.client.post(
            reverse('api-projects', args=[self.workspace.id]),
            {'name': 'Member Project'},
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        self.assertTrue(
            ResourceAccess.objects.filter(
                workspace_membership=membership,
                project_id=response.json()['id'],
            ).exists()
        )


class RoleAdministrationApiTests(WorkspaceAccessSetupMixin, TestCase):
    def test_owner_can_create_update_and_archive_custom_role(self):
        self.client.force_authenticate(self.owner)
        created = self.client.post(
            reverse('api-workspace-roles', args=[self.workspace.id]),
            {
                'name': 'Reviewer',
                'description': 'Reviews assigned projects.',
                'permission_keys': [WORKSPACE_READ, PROJECT_READ],
            },
            format='json',
        )
        self.assertEqual(created.status_code, 201)
        self.assertFalse(created.json()['is_system'])
        self.assertSetEqual(set(created.json()['permissions']), {WORKSPACE_READ, PROJECT_READ})

        role_id = created.json()['id']
        updated = self.client.patch(
            reverse('api-workspace-role-detail', args=[self.workspace.id, role_id]),
            {'name': 'Senior Reviewer', 'permission_keys': [PROJECT_READ]},
            format='json',
        )
        archived = self.client.delete(
            reverse('api-workspace-role-detail', args=[self.workspace.id, role_id])
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()['name'], 'Senior Reviewer')
        self.assertEqual(archived.status_code, 204)
        self.assertEqual(Role.objects.get(id=role_id).status, 'ARCHIVED')

    def test_system_roles_are_protected(self):
        self.client.force_authenticate(self.owner)
        owner_role = self.owner_membership.role

        updated = self.client.patch(
            reverse('api-workspace-role-detail', args=[self.workspace.id, owner_role.id]),
            {'name': 'Changed Owner'},
            format='json',
        )
        archived = self.client.delete(
            reverse('api-workspace-role-detail', args=[self.workspace.id, owner_role.id])
        )

        self.assertEqual(updated.status_code, 400)
        self.assertEqual(archived.status_code, 400)
        owner_role.refresh_from_db()
        self.assertEqual(owner_role.name, 'Owner')

    def test_member_cannot_manage_roles_or_escalate_permissions(self):
        self.invite_and_accept()
        self.client.force_authenticate(self.member_user)
        response = self.client.post(
            reverse('api-workspace-roles', args=[self.workspace.id]),
            {
                'name': 'Escalated',
                'permission_keys': ['workspace.members.manage'],
            },
            format='json',
        )
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Role.objects.filter(workspace=self.workspace, name='Escalated').exists())

    def test_role_names_are_unique_case_insensitively(self):
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            reverse('api-workspace-roles', args=[self.workspace.id]),
            {'name': 'member', 'permission_keys': []},
            format='json',
        )
        self.assertEqual(response.status_code, 400)


class ResourceAccessAdministrationApiTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.membership = self.invite_and_accept(project_access_mode=ProjectAccessMode.SELECTED)
        self.client.force_authenticate(self.owner)
        project_response = self.client.post(
            reverse('api-projects', args=[self.workspace.id]),
            {'name': 'Grant Project'},
            format='json',
        )
        self.project = Project.objects.get(id=project_response.json()['id'])

    def test_owner_can_grant_list_and_revoke_selected_project_access(self):
        created = self.client.post(
            reverse('api-project-access', args=[self.workspace.id, self.project.id]),
            {'membership_id': str(self.membership.id)},
            format='json',
        )
        self.assertEqual(created.status_code, 201)
        grant_id = created.json()['id']

        listed = self.client.get(
            reverse('api-project-access', args=[self.workspace.id, self.project.id])
        )
        duplicate = self.client.post(
            reverse('api-project-access', args=[self.workspace.id, self.project.id]),
            {'membership_id': str(self.membership.id)},
            format='json',
        )
        self.assertEqual(len(listed.json()), 1)
        self.assertEqual(duplicate.status_code, 400)

        self.client.force_authenticate(self.member_user)
        self.assertEqual(
            self.client.get(
                reverse('api-project-detail', args=[self.workspace.id, self.project.id])
            ).status_code,
            200,
        )

        self.client.force_authenticate(self.owner)
        revoked = self.client.delete(
            reverse(
                'api-project-access-detail',
                args=[self.workspace.id, self.project.id, grant_id],
            )
        )
        self.assertEqual(revoked.status_code, 204)
        self.client.force_authenticate(self.member_user)
        self.assertEqual(
            self.client.get(
                reverse('api-project-detail', args=[self.workspace.id, self.project.id])
            ).status_code,
            403,
        )

    def test_explicit_grant_rejects_all_access_membership(self):
        self.membership.project_access_mode = ProjectAccessMode.ALL
        self.membership.save(update_fields=['project_access_mode'])
        response = self.client.post(
            reverse('api-project-access', args=[self.workspace.id, self.project.id]),
            {'membership_id': str(self.membership.id)},
            format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_member_cannot_manage_project_access(self):
        self.client.force_authenticate(self.member_user)
        response = self.client.get(
            reverse('api-project-access', args=[self.workspace.id, self.project.id])
        )
        self.assertEqual(response.status_code, 403)
