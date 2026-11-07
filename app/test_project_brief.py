"""Brief & Specs: the project description, dates, priority and deliverable specs."""
from django.test import TestCase
from django.urls import reverse

from .models import Project, WorkspaceMembership
from .permissions import PROJECT_READ, WORKSPACE_READ
from .services.roles import create_role
from .test_access_projects import WorkspaceAccessSetupMixin


class ProjectBriefTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.owner)
        self.project_id = self.client.post(
            reverse('api-projects', args=[self.workspace.id]), {'name': 'Spring Launch'}, format='json',
        ).json()['id']
        self.url = reverse('api-project-detail', args=[self.workspace.id, self.project_id])

    def viewer(self):
        """A workspace user whose role can read projects but not edit them."""
        role = create_role(
            workspace=self.workspace, created_by_user=self.owner, name='Viewer',
            permission_keys=[WORKSPACE_READ, PROJECT_READ],
        )
        self.member_role = role
        self.invite_and_accept()
        return self.member_user

    def test_editor_saves_description_dates_priority_and_specs(self):
        response = self.client.patch(self.url, {
            'description': 'Three cutdowns for the spring push.',
            'due_at': '2026-10-20T17:00:00Z',
            'priority': 'HIGH',
            'deliverable_specs': {'aspect_ratio': '9:16', 'target_length_seconds': 30, 'platform': 'Instagram', 'resolution': '1080x1920'},
        }, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(data['priority'], 'HIGH')
        self.assertEqual(data['deliverable_specs'], {
            'aspect_ratio': '9:16', 'target_length_seconds': 30, 'platform': 'Instagram',
            'resolution': '1080x1920', 'notes': None,
        })
        self.assertTrue(data['viewer_can_edit'])
        self.assertEqual(self.client.get(self.url).json()['description'], 'Three cutdowns for the spring push.')

    def test_spec_patches_merge_and_null_clears_one_field(self):
        self.client.patch(self.url, {'deliverable_specs': {'aspect_ratio': '16:9', 'platform': 'YouTube'}}, format='json')
        self.client.patch(self.url, {'deliverable_specs': {'notes': 'Burned-in captions', 'platform': None}}, format='json')
        stored = Project.objects.get(id=self.project_id).deliverable_specs
        self.assertEqual(stored, {'aspect_ratio': '16:9', 'notes': 'Burned-in captions'})

    def test_invalid_specs_are_refused(self):
        for specs in (
            {'aspect_ratio': '21:9'},
            {'platform': 'Myspace'},
            {'target_length_seconds': 0},
            {'colour': 'blue'},
        ):
            response = self.client.patch(self.url, {'deliverable_specs': specs}, format='json')
            self.assertEqual(response.status_code, 400, specs)
        self.assertEqual(Project.objects.get(id=self.project_id).deliverable_specs, {})

    def test_description_can_be_cleared(self):
        self.client.patch(self.url, {'description': 'Something'}, format='json')
        response = self.client.patch(self.url, {'description': ''}, format='json')
        self.assertEqual(response.status_code, 200)
        cleared = self.client.patch(self.url, {'description': None}, format='json')
        self.assertEqual(cleared.status_code, 200, cleared.content)

    def test_read_only_viewer_sees_the_brief_but_cannot_change_it(self):
        self.client.patch(self.url, {'description': 'Locked brief'}, format='json')
        viewer = self.viewer()
        self.client.force_authenticate(viewer)
        data = self.client.get(self.url).json()
        self.assertEqual(data['description'], 'Locked brief')
        self.assertFalse(data['viewer_can_edit'])
        for payload in ({'description': 'Hijacked'}, {'deliverable_specs': {'aspect_ratio': '1:1'}}, {'priority': 'LOW'}):
            self.assertEqual(self.client.patch(self.url, payload, format='json').status_code, 403)
        self.assertEqual(Project.objects.get(id=self.project_id).description, 'Locked brief')

    def test_members_with_project_update_can_edit(self):
        self.invite_and_accept()
        self.client.force_authenticate(self.member_user)
        self.assertTrue(self.client.get(self.url).json()['viewer_can_edit'])
        self.assertEqual(self.client.patch(self.url, {'description': 'Member edit'}, format='json').status_code, 200)

    def test_outsiders_cannot_read_or_edit(self):
        user_model = WorkspaceMembership._meta.get_field('user').remote_field.model
        outsider = user_model.objects.create_user(email='o@example.com', password='a-secure-test-password', first_name='O', last_name='S')
        self.client.force_authenticate(outsider)
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self.assertEqual(self.client.patch(self.url, {'description': 'x'}, format='json').status_code, 403)

    def test_project_list_includes_specs_but_not_edit_rights(self):
        row = self.client.get(reverse('api-projects', args=[self.workspace.id])).json()[0]
        self.assertIn('deliverable_specs', row)
        self.assertIsNone(row['viewer_can_edit'])
