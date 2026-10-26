"""GET /workspaces/<id>/client-teams/<id>/overview/: counts, editors, money and who sees what."""
import uuid

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone

from .models import ClientTeam, Project, ProjectAccessMode
from .test_billing import BillingBase


class ClientOverviewTests(BillingBase, TestCase):
    def overview(self, user=None, team=None, expect=200):
        self.as_user(user or self.owner)
        response = self.client.get(reverse('api-client-team-overview', args=[self.workspace.id, (team or self.team).id]))
        self.assertEqual(response.status_code, expect, response.content)
        return response.json()

    def extra_project(self, name, status):
        now = timezone.now()
        project = Project.objects.create(
            id=uuid.uuid4(), workspace=self.workspace, created_by_user=self.owner, client_team=self.team,
            name=name, status=status, created_at=now, updated_at=now,
        )
        return str(project.id)

    def test_counts_progress_and_editors(self):
        first, _second = self.priced_project()
        self.move(first['id'], 'approved')
        self.extra_project('Winter Promo', 'COMPLETED')
        Project.objects.filter(id=self.project_id).update(status='ACTIVE')

        data = self.overview()
        self.assertEqual(data['counts'], {'ongoing': 1, 'completed': 1, 'editors': 2})
        ongoing = data['ongoing_projects'][0]
        self.assertEqual((ongoing['name'], ongoing['tasks_total'], ongoing['tasks_done'], ongoing['progress']), ('Spring Launch', 2, 1, 50))
        self.assertEqual(data['completed_projects'][0]['name'], 'Winter Promo')
        names = sorted(editor['name'] for editor in data['editors'])
        self.assertEqual(names, ['Maya Editor', 'Theo Editor'])
        self.assertTrue(all(editor['project_count'] == 1 and editor['role'] == 'Member' for editor in data['editors']))

    def test_paid_comes_from_recorded_payments(self):
        self.priced_project()
        money = self.overview()['money']
        self.assertEqual((money['paid'], money['agreed'], money['currency']), ('0.00', '1400.00', 'GBP'))
        invoice = self.invoice()
        self.pay(invoice['id'], '400')
        money = self.overview()['money']
        self.assertEqual((money['paid'], money['invoices_issued'], money['invoices_paid']), ('400.00', 1, 0))

    def test_editor_sees_overview_without_money(self):
        self.priced_project()
        data = self.overview(self.editor)
        self.assertIsNone(data['money'])
        self.assertEqual(data['counts']['editors'], 2)
        self.assertNotIn('1400', str(data))

    def test_editor_with_selected_access_only_sees_their_projects(self):
        self.priced_project()
        user, _membership = self.add_member('sel@example.com', mode=ProjectAccessMode.SELECTED)
        data = self.overview(user)
        self.assertEqual(data['counts'], {'ongoing': 0, 'completed': 0, 'editors': 0})

    def test_client_team_member_is_refused(self):
        client_user = self.add_client_member(role=self.member_role)
        self.overview(client_user, expect=403)

    def test_other_workspace_client_and_anonymous(self):
        self.client.force_authenticate(None)
        response = self.client.get(reverse('api-client-team-overview', args=[self.workspace.id, self.team.id]))
        self.assertIn(response.status_code, (401, 403))
        self.overview(team=ClientTeam(id=uuid.uuid4()), expect=404)

    def test_query_count_does_not_grow_with_projects(self):
        self.priced_project()
        self.as_user(self.owner)
        url = reverse('api-client-team-overview', args=[self.workspace.id, self.team.id])
        self.client.get(url)
        with CaptureQueriesContext(connection) as small:
            self.client.get(url)
        for index in range(5):
            project_id = self.extra_project(f'Extra {index}', 'ACTIVE')
            self.task(f'Extra task {index}', self.editor_membership, project=False, project_id=project_id)
        with CaptureQueriesContext(connection) as large:
            self.assertEqual(self.client.get(url).status_code, 200)
        self.assertEqual(len(small), len(large))
