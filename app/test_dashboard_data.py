"""API fields the dashboard reads: the viewer's own membership id, and a cut's poster."""
import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse

from .models import Project, ProjectAccessMode, WorkspaceMembership, WorkspaceMembershipStatus
from .services.outbox import process_outbox_events
from .test_access_projects import WorkspaceAccessSetupMixin
from .test_media import _make_test_clip


class WorkspaceListMembershipTests(WorkspaceAccessSetupMixin, TestCase):
    def test_each_workspace_carries_the_viewers_own_membership_id(self):
        self.client.force_authenticate(self.owner)
        listed = self.client.get(reverse('api-workspaces'))
        self.assertEqual(listed.status_code, 200)
        row = next(item for item in listed.json() if item['id'] == str(self.workspace.id))
        self.assertEqual(row['my_membership_id'], str(self.owner_membership.id))

    def test_a_member_sees_their_own_membership_not_the_owners(self):
        membership = self.invite_and_accept()
        self.client.force_authenticate(self.member_user)
        row = next(item for item in self.client.get(reverse('api-workspaces')).json() if item['id'] == str(self.workspace.id))
        self.assertEqual(row['my_membership_id'], str(membership.id))
        self.assertNotEqual(row['my_membership_id'], str(self.owner_membership.id))

    def test_the_membership_id_matches_task_assignee_ids(self):
        """The dashboard filters "My tasks" by comparing these two ids, so they must agree."""
        self.client.force_authenticate(self.owner)
        created = self.client.post(
            reverse('api-tasks', args=[self.workspace.id]),
            {'title': 'Mine', 'assignee_id': str(self.owner_membership.id)}, format='json',
        )
        self.assertEqual(created.status_code, 201, created.content)
        row = next(item for item in self.client.get(reverse('api-workspaces')).json() if item['id'] == str(self.workspace.id))
        self.assertEqual([a['id'] for a in created.json()['assignees']], [row['my_membership_id']])

    def test_an_inactive_membership_is_not_reported(self):
        membership = self.invite_and_accept()
        self.client.force_authenticate(self.member_user)
        WorkspaceMembership.objects.filter(id=membership.id).update(status=WorkspaceMembershipStatus.SUSPENDED)
        rows = [item for item in self.client.get(reverse('api-workspaces')).json() if item['id'] == str(self.workspace.id)]
        # A suspended member may or may not still list the workspace; either way, no id.
        for row in rows:
            self.assertIsNone(row['my_membership_id'])


class MediaVersionPosterTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='blazeflow-dashboard-tests-')
        self.settings_override = override_settings(MEDIA_ROOT=self.media_root, MAX_MEDIA_UPLOAD_BYTES=1024 * 1024)
        self.settings_override.enable()
        super().setUp()
        self.client.force_authenticate(self.owner)
        response = self.client.post(reverse('api-projects', args=[self.workspace.id]), {'name': 'Posters'}, format='json')
        self.project = Project.objects.get(id=response.json()['id'])

    def tearDown(self):
        self.settings_override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)
        super().tearDown()

    def upload_clip(self):
        return self.client.post(
            reverse('api-media-versions', args=[self.workspace.id, self.project.id]),
            {'file': SimpleUploadedFile('clip.mp4', _make_test_clip(), content_type='video/mp4'), 'title': 'Clip'},
            format='multipart',
        )

    def list_versions(self):
        return self.client.get(reverse('api-media-versions', args=[self.workspace.id, self.project.id]))

    def test_poster_is_null_until_generated_then_carries_a_working_url_and_size(self):
        uploaded = self.upload_clip()
        self.assertEqual(uploaded.status_code, 201)
        media_id = uploaded.json()['id']
        poster_url = reverse('api-media-version-poster', args=[self.workspace.id, self.project.id, media_id])

        # Nothing generated yet: no URL offered, and the route 404s rather than guessing.
        self.assertIsNone(uploaded.json()['poster'])
        self.assertIsNone(self.list_versions().json()[0]['poster'])
        self.assertEqual(self.client.get(poster_url).status_code, 404)

        process_outbox_events()
        process_outbox_events()

        poster = self.list_versions().json()[0]['poster']
        self.assertEqual(poster['url'], poster_url)
        # The frame's own size travels with it so the dashboard can letterbox, not crop.
        self.assertEqual((poster['width'], poster['height']), (320, 240))
        detail = self.client.get(reverse('api-media-version-detail', args=[self.workspace.id, self.project.id, media_id]))
        self.assertEqual(detail.json()['poster']['url'], poster_url)

        served = self.client.get(poster_url)
        self.assertEqual(served.status_code, 200)
        self.assertEqual(served['Content-Type'], 'image/jpeg')
        self.assertNotIn('attachment', served.get('Content-Disposition', ''))
        self.assertGreater(len(b''.join(served.streaming_content)), 0)

    def test_poster_route_needs_project_access(self):
        media_id = self.upload_clip().json()['id']
        process_outbox_events()
        process_outbox_events()
        poster_url = reverse('api-media-version-poster', args=[self.workspace.id, self.project.id, media_id])

        self.invite_and_accept(project_access_mode=ProjectAccessMode.SELECTED)
        self.client.force_authenticate(self.member_user)
        self.assertEqual(self.client.get(poster_url).status_code, 403)

        self.client.logout()
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(poster_url).status_code, (401, 403))
