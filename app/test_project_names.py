from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from .models import WorkspaceMembership
from .services import create_workspace


class DuplicateProjectNameTests(TestCase):
    """B7: two live projects sharing a name cannot be told apart in any picker."""

    def setUp(self):
        user_model = WorkspaceMembership._meta.get_field('user').remote_field.model
        self.owner = user_model.objects.create_user(email='names@example.com', password='a-secure-test-password', first_name='Nia', last_name='Names')
        self.workspace, _ = create_workspace(owner=self.owner, name='Names', slug='names', workspace_timezone='UTC')
        self.client = APIClient()
        self.client.force_authenticate(self.owner)
        self.url = reverse('api-projects', args=[self.workspace.id])

    def create(self, name):
        return self.client.post(self.url, {'name': name}, format='json')

    def test_create_rejects_a_name_already_in_use_case_insensitively(self):
        self.assertEqual(self.create('AI QA test').status_code, 201)
        response = self.create('  ai qa TEST ')
        self.assertEqual(response.status_code, 400)
        self.assertIn('already exists', response.json()['name'][0])

    def test_rename_rejects_another_projects_name_but_allows_its_own(self):
        self.create('Launch film')
        other = self.create('Teaser').json()
        detail = reverse('api-project-detail', args=[self.workspace.id, other['id']])
        self.assertEqual(self.client.patch(detail, {'name': 'launch film'}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(detail, {'name': 'Teaser'}, format='json').status_code, 200)
