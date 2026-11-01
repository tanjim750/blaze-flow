"""Query-count budgets for the main list endpoints.

Each endpoint is measured with a small and a larger data set. The number of queries must not
grow with the number of rows (no N+1). Set PERF_REPORT=1 to print the table.
"""
import os
import time
import shutil
import tempfile
import uuid

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone

from .models import SubscriptionPlan, SubscriptionStatus, UserSubscription
from .test_access_projects import WorkspaceAccessSetupMixin

REPORT = os.environ.get('PERF_REPORT') == '1'


class QueryCountTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='blazeflow-perf-')
        self.override = override_settings(MEDIA_ROOT=self.media_root, MAX_MEDIA_UPLOAD_BYTES=1024 * 1024)
        self.override.enable()
        super().setUp()
        now = timezone.now()
        UserSubscription.objects.filter(user=self.owner).delete()
        UserSubscription.objects.create(id=uuid.uuid4(), user=self.owner, plan=SubscriptionPlan.PRO, status=SubscriptionStatus.ACTIVE, started_at=now, created_at=now, updated_at=now)
        self.client.force_authenticate(self.owner)
        self.projects, self.medias = [], []
        self.ws = self.workspace.id

    def tearDown(self):
        self.override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)
        super().tearDown()

    def grow(self, n):
        """Add n projects, each with a version, n comments on the first version and 2 tasks."""
        for i in range(n):
            pid = self.client.post(reverse('api-projects', args=[self.ws]), {'name': f'P{len(self.projects)}'}, format='json').json()['id']
            self.projects.append(pid)
            up = self.client.post(
                reverse('api-media-versions', args=[self.ws, pid]),
                {'file': SimpleUploadedFile('f.png', b'\x89PNG\r\n\x1a\nperf', content_type='image/png'), 'title': f'Cut {i}'},
                format='multipart',
            )
            self.assertEqual(up.status_code, 201, up.content)
            self.medias.append((pid, up.json()['id']))
            for t in range(2):
                r = self.client.post(reverse('api-tasks', args=[self.ws]), {
                    'title': f'T{i}-{t}', 'project_id': pid, 'assignee_id': str(self.owner_membership.id),
                }, format='json')
                self.assertEqual(r.status_code, 201, r.content)
        pid, mid = self.medias[0]
        for i in range(n):  # more cuts on the first project, so its version list grows too
            r = self.client.post(
                reverse('api-media-versions', args=[self.ws, pid]),
                {'file': SimpleUploadedFile('g.png', b'\x89PNG\r\n\x1a\nperf', content_type='image/png'), 'title': f'Extra {i}'},
                format='multipart',
            )
            self.assertEqual(r.status_code, 201, r.content)
        url = reverse('api-review-comments', args=[self.ws, pid, mid])
        for i in range(n):
            self.assertEqual(self.client.post(url, {'text': f'note {i}', 'start_time_ms': i * 100}, format='json').status_code, 201)

    def endpoints(self):
        pid, mid = self.medias[0]
        return {
            'workspaces': reverse('api-workspaces'),
            'projects': reverse('api-projects', args=[self.ws]),
            'project detail': reverse('api-project-detail', args=[self.ws, pid]),
            'tasks': reverse('api-tasks', args=[self.ws]),
            'media versions': reverse('api-media-versions', args=[self.ws, pid]),
            'comments': reverse('api-review-comments', args=[self.ws, pid, mid]),
            'asset files': reverse('api-asset-files', args=[self.ws]),
            'members': reverse('api-workspace-members', args=[self.ws]),
            'notifications': reverse('api-notifications'),
            'dashboard my-cuts': reverse('api-dashboard-my-cuts', args=[self.ws]),
            'dashboard notes': reverse('api-dashboard-notes-to-address', args=[self.ws]),
            'dashboard workload': reverse('api-dashboard-workload', args=[self.ws]),
            'invoices': reverse('api-billing-invoices', args=[self.ws]),
        }

    def measure(self):
        counts = {}
        self.timings = getattr(self, 'timings', {})
        for name, url in self.endpoints().items():
            started = time.perf_counter()
            with CaptureQueriesContext(connection) as ctx:
                response = self.client.get(url)
            self.timings[name] = (time.perf_counter() - started) * 1000
            self.assertLess(response.status_code, 400, f'{name}: {response.status_code}')
            counts[name] = len(ctx.captured_queries)
        return counts

    def test_list_endpoints_do_not_scale_queries_with_rows(self):
        self.grow(2)
        small = self.measure()
        self.grow(8)
        large = self.measure()
        if REPORT:
            print('\n%-20s %6s %6s' % ('endpoint', 'n=2', 'n=10'))
            for name in small:
                print('%-20s %6d %6d %8.1fms' % (name, small[name], large[name], self.timings[name]))
        growing = {name: (small[name], large[name]) for name in small if large[name] > small[name] + 1}
        self.assertEqual(growing, {}, 'query count grows with rows (N+1)')
