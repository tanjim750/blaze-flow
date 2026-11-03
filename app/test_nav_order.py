"""Workspace sidebar order: everyone reads it, only the primary owner sets it, keys are validated."""
from django.test import TestCase
from django.urls import reverse

from .models import Workspace
from .permissions import WORKSPACE_MANAGE, WORKSPACE_READ
from .services.nav_order import NAV_KEYS, effective_nav_order
from .test_role_dashboards import DashboardBase

CUSTOM = ['projects', 'files', 'analytics', 'tasks', 'chat', 'clients', 'team', 'money']


class NavOrderTests(DashboardBase, TestCase):
    def url(self):
        return reverse('api-workspace-nav-order', args=[self.workspace.id])

    def test_default_order_starts_with_files(self):
        self.as_user(self.owner)
        body = self.client.get(self.url()).json()
        self.assertEqual(body['order'], list(NAV_KEYS))
        self.assertEqual(body['order'][0], 'files')
        self.assertTrue(body['is_default'])
        self.assertTrue(body['can_edit'])
        member, _ = self.add_member('ed@example.com')
        self.as_user(member)
        self.assertFalse(self.client.get(self.url()).json()['can_edit'])

    def test_owner_sets_and_every_member_sees_it(self):
        self.as_user(self.owner)
        response = self.client.put(self.url(), {'order': CUSTOM}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['order'], CUSTOM)
        member, _ = self.add_member('ed@example.com')
        self.assertEqual(self.listed_workspace(member)['nav_order'], CUSTOM)
        self.as_user(member)
        self.assertEqual(self.client.get(self.url()).json()['order'], CUSTOM)

    def test_reset_to_default(self):
        self.as_user(self.owner)
        self.client.put(self.url(), {'order': CUSTOM}, format='json')
        response = self.client.put(self.url(), {'reset': True}, format='json')
        self.assertEqual(response.json()['order'], list(NAV_KEYS))
        self.workspace.refresh_from_db()
        self.assertEqual(self.workspace.nav_order, [])

    def test_member_and_admin_cannot_set(self):
        member, _ = self.add_member('ed@example.com')
        admin, _ = self.add_member('ad@example.com', role=self.custom_role('Admin', [WORKSPACE_READ, WORKSPACE_MANAGE]))
        for user in (member, admin):
            self.as_user(user)
            self.assertEqual(self.client.put(self.url(), {'order': CUSTOM}, format='json').status_code, 403)
        self.assertEqual(Workspace.objects.get(id=self.workspace.id).nav_order, [])

    def test_rejects_unknown_duplicate_and_partial(self):
        self.as_user(self.owner)
        for order in (
            CUSTOM[:-1] + ['billing'],
            CUSTOM[:-1] + ['files'],
            CUSTOM[:3],
            [],
        ):
            response = self.client.put(self.url(), {'order': order}, format='json')
            self.assertEqual(response.status_code, 400, order)
        self.assertEqual(self.client.put(self.url(), {}, format='json').status_code, 400)

    def test_outsider_cannot_read(self):
        from .test_role_dashboards import _user
        self.as_user(_user('out@example.com'))
        self.assertIn(self.client.get(self.url()).status_code, (403, 404))

    def test_effective_order_tolerates_stale_values(self):
        self.assertEqual(effective_nav_order(['money', 'bogus', 'money']), ['money'] + [k for k in NAV_KEYS if k != 'money'])
        self.assertEqual(effective_nav_order(None), list(NAV_KEYS))
