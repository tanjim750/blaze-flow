"""``GET /api/workspaces/<id>/permissions/``: the viewer's effective permission keys.

The UI hides controls the API would refuse (a comment composer for a read-only member, task
writes for a client), so the answer must match ``has_workspace_permission`` and
``has_project_permission`` exactly. The tests check that agreement key by key.
"""
import uuid

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .models import Project, ProjectAccessMode, ResourceAccess, Role, WorkspaceMembership
from .permissions import (
    ALL_PERMISSION_KEYS, BILLING_VIEW, MEDIA_READ, PROJECT_READ, REVIEW_COMMENT_CREATE, REVIEW_COMMENT_READ, TASK_CREATE,
    TASK_READ, WORKSPACE_READ, has_project_permission, has_workspace_permission,
)
from .services.roles import create_role
from .test_access_projects import WorkspaceAccessSetupMixin

READ_ONLY = [WORKSPACE_READ, PROJECT_READ, MEDIA_READ, REVIEW_COMMENT_READ, TASK_READ]


class PermissionsEndpointTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.owner)
        self.project = Project.objects.get(id=self.client.post(reverse('api-projects', args=[self.workspace.id]), {'name': 'Spring'}, format='json').json()['id'])
        self.other = Project.objects.get(id=self.client.post(reverse('api-projects', args=[self.workspace.id]), {'name': 'Autumn'}, format='json').json()['id'])

    def url(self, project=None):
        base = reverse('api-workspace-permissions', args=[self.workspace.id])
        return f'{base}?project_id={project.id}' if project else base

    def add_user(self, email, role, mode=ProjectAccessMode.ALL):
        model = WorkspaceMembership._meta.get_field('user').remote_field.model
        user = model.objects.create_user(email=email, password='a-secure-test-password', first_name='Jo', last_name='Viewer')
        now = timezone.now()
        membership = WorkspaceMembership.objects.create(
            id=uuid.uuid4(), workspace=self.workspace, principal_type='USER', user=user, role=role,
            project_access_mode=mode, status='ACTIVE', joined_at=now, created_at=now, updated_at=now,
        )
        return user, membership

    def assert_agrees(self, user, project):
        self.client.force_authenticate(user)
        body = self.client.get(self.url(project)).json()
        for key in sorted(ALL_PERMISSION_KEYS):
            self.assertEqual(key in body['permissions'], has_workspace_permission(user=user, workspace=self.workspace, permission_key=key), f'workspace {key}')
            self.assertEqual(key in body['project']['permissions'], has_project_permission(user=user, project=project, permission_key=key), f'project {key}')
        return body

    def test_owner_has_every_key_and_the_owner_layout(self):
        body = self.assert_agrees(self.owner, self.project)
        self.assertEqual(body['dashboard_role'], 'owner')
        self.assertIn(REVIEW_COMMENT_CREATE, body['project']['permissions'])
        self.assertIn(BILLING_VIEW, body['permissions'])

    def test_read_only_member_gets_read_keys_only(self):
        role = create_role(workspace=self.workspace, created_by_user=self.owner, name='Viewer (read only)', permission_keys=READ_ONLY)
        viewer, _ = self.add_user('viewer@example.com', role)
        body = self.assert_agrees(viewer, self.project)
        self.assertEqual(sorted(body['project']['permissions']), sorted(READ_ONLY))
        self.assertNotIn(REVIEW_COMMENT_CREATE, body['project']['permissions'])
        self.assertNotIn(TASK_CREATE, body['permissions'])

    def test_selected_access_only_counts_on_granted_projects(self):
        member_role = Role.objects.get(workspace=self.workspace, name='Member')
        user, membership = self.add_user('selected@example.com', member_role, mode=ProjectAccessMode.SELECTED)
        ResourceAccess.objects.create(id=uuid.uuid4(), workspace_membership=membership, project=self.project, created_at=timezone.now())
        granted = self.assert_agrees(user, self.project)
        self.assertIn(REVIEW_COMMENT_CREATE, granted['project']['permissions'])
        other = self.assert_agrees(user, self.other)
        self.assertEqual(other['project']['permissions'], [])
        # Workspace-level keys still come from the role.
        self.assertIn(TASK_CREATE, other['permissions'])

    def test_without_project_id_there_is_no_project_block(self):
        body = self.client.get(self.url()).json()
        self.assertIsNone(body['project'])
        self.assertEqual(body['workspace_id'], str(self.workspace.id))

    def test_outsiders_are_refused(self):
        model = WorkspaceMembership._meta.get_field('user').remote_field.model
        stranger = model.objects.create_user(email='stranger@example.com', password='a-secure-test-password', first_name='Sam', last_name='Stranger')
        self.client.force_authenticate(stranger)
        self.assertEqual(self.client.get(self.url()).status_code, 403)
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(self.url()).status_code, (401, 403))

    def test_a_project_from_another_workspace_is_not_found(self):
        response = self.client.get(f"{reverse('api-workspace-permissions', args=[self.workspace.id])}?project_id={uuid.uuid4()}")
        self.assertEqual(response.status_code, 404)
