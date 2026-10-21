"""Project status: change it, archive, list archived, unarchive (within the plan limit)."""
from django.test import TestCase
from django.urls import reverse

from .models import Project, ProjectStatus
from .test_access_projects import WorkspaceAccessSetupMixin


class ProjectStatusTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.owner)
        self.list_url = reverse('api-projects', args=[self.workspace.id])
        self.project_id = self.client.post(self.list_url, {'name': 'Spring'}, format='json').json()['id']
        self.url = reverse('api-project-detail', args=[self.workspace.id, self.project_id])

    def test_change_status(self):
        for value in ('ACTIVE', 'ON_HOLD', 'COMPLETED', 'DRAFT'):
            response = self.client.patch(self.url, {'status': value}, format='json')
            self.assertEqual(response.status_code, 200, response.content)
            self.assertEqual(response.json()['status'], value)

    def test_pending_deletion_is_refused(self):
        response = self.client.patch(self.url, {'status': 'PENDING_DELETION'}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_archive_list_and_unarchive(self):
        self.assertEqual(self.client.patch(self.url, {'status': 'ARCHIVED'}, format='json').status_code, 200)
        self.assertEqual([row['id'] for row in self.client.get(self.list_url).json()], [])
        archived = self.client.get(self.list_url, {'archived': '1'}).json()
        self.assertEqual([row['id'] for row in archived], [self.project_id])
        response = self.client.patch(self.url, {'status': 'ACTIVE'}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual([row['id'] for row in self.client.get(self.list_url).json()], [self.project_id])

    def test_unarchive_respects_the_plan_limit(self):
        self.client.patch(self.url, {'status': 'ARCHIVED'}, format='json')
        for index in range(10):
            if self.client.post(self.list_url, {'name': f'P{index}'}, format='json').status_code != 201:
                break
        response = self.client.patch(self.url, {'status': 'ACTIVE'}, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'plan_limit')
        self.assertIn('plan allows up to', response.json()['detail'])
        self.assertEqual(Project.objects.get(pk=self.project_id).status, ProjectStatus.ARCHIVED)
