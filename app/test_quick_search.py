"""⌘K quick search: grouped results scoped to the viewer's role and project access."""
from django.test import TestCase
from django.urls import reverse

from .models import ProjectAccessMode
from .test_role_dashboards import DashboardBase, _user


class QuickSearchTests(DashboardBase, TestCase):
    def search(self, user, q):
        self.as_user(user)
        response = self.client.get(reverse('api-workspace-search', args=[self.workspace.id]), {'q': q})
        self.assertEqual(response.status_code, 200, response.content)
        return {group['key']: group['items'] for group in response.json()['groups']}

    def setUp(self):
        super().setUp()
        self.media = self.upload(title='Spring hero cut')
        self.task('Spring colour pass')
        self.as_user(self.owner)
        self.other_project = self.client.post(reverse('api-projects', args=[self.workspace.id]), {'name': 'Spring Secret'}, format='json').json()['id']

    def test_owner_sees_every_group_with_links(self):
        groups = self.search(self.owner, 'spring')
        self.assertEqual({p['title'] for p in groups['projects']}, {'Spring Launch', 'Spring Secret'})
        self.assertTrue(groups['projects'][0]['href'].startswith('/projects?campaign='))
        self.assertEqual(groups['cuts'][0]['href'], f"/review?project={self.project_id}&version={self.media['id']}")
        self.assertEqual(groups['tasks'][0]['title'], 'Spring colour pass')
        self.assertIn('chat', groups)

    def test_editor_only_sees_granted_projects_and_no_studio_admin_groups(self):
        editor, membership = self.add_member('ed@studio.example', mode=ProjectAccessMode.SELECTED)
        from .models import ResourceAccess
        import uuid
        from django.utils import timezone
        ResourceAccess.objects.create(id=uuid.uuid4(), workspace_membership=membership, project_id=self.project_id, created_at=timezone.now())
        groups = self.search(editor, 'spring')
        self.assertEqual([p['title'] for p in groups['projects']], ['Spring Launch'])
        self.assertNotIn('clients', groups)
        self.assertNotIn('people', groups)
        owner_name = self.search(editor, self.owner.first_name)
        self.assertNotIn('people', owner_name)

    def test_client_gets_portal_links_and_never_tasks_files_clients_or_people(self):
        client = self.add_client_member()
        groups = self.search(client, 'spring')
        self.assertTrue(all(p['href'].startswith('/portal/projects/') for p in groups['projects']))
        for hidden in ('tasks', 'files', 'clients', 'people'):
            self.assertNotIn(hidden, groups)
        self.assertTrue(all(c['href'].startswith('/portal/chat/') for c in groups.get('chat', [])))

    def test_short_queries_return_nothing_and_outsiders_are_refused(self):
        self.assertEqual(self.search(self.owner, 's'), {})
        outsider = _user('nobody@else.example')
        self.as_user(outsider)
        response = self.client.get(reverse('api-workspace-search', args=[self.workspace.id]), {'q': 'spring'})
        self.assertEqual(response.status_code, 403)
