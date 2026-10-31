"""Sharing one file from Files as a public guest link.

Guests only see published media versions, so a link for an unpublished library file used
to open an empty project ("No cut available"). Now the share either refuses with
``not_published`` or, when confirmed, publishes the file and returns its version id.
"""
import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse

from .models import File, FileStatus, GuestInvite, MediaVersion, Project
from .services.outbox import process_outbox_events
from .test_access_projects import WorkspaceAccessSetupMixin
from .test_publish_to_project import _png


class GuestFileShareTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='blazeflow-guest-share-')
        self.settings_override = override_settings(MEDIA_ROOT=self.media_root, MAX_PROJECT_FILE_BYTES=1024 * 1024)
        self.settings_override.enable()
        super().setUp()
        self.client.force_authenticate(self.owner)
        self.project = self.make_project('november')
        self.other = self.make_project('october')
        self.asset = self.upload('draft 1 $5000.png')

    def tearDown(self):
        self.settings_override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)

    def make_project(self, name):
        response = self.client.post(reverse('api-projects', args=[self.workspace.id]), {'name': name}, format='json')
        return Project.objects.get(id=response.json()['id'])

    def upload(self, name):
        response = self.client.post(
            reverse('api-asset-files', args=[self.workspace.id]),
            {'file': SimpleUploadedFile(name, _png(), content_type='image/png')}, format='multipart',
        )
        self.assertEqual(response.status_code, 201, response.content)
        process_outbox_events()
        process_outbox_events()
        File.objects.filter(id=response.json()['file']['id']).update(status=FileStatus.READY)
        return response.json()

    def share(self, project=None, **extra):
        return self.client.post(
            reverse('api-project-guest-invites', args=[self.workspace.id, (project or self.project).id]),
            {'permissions': ['media.read'], 'expires_in_hours': 24, 'asset_file_id': self.asset['id'], **extra},
            format='json',
        )

    def guest_cuts(self, token):
        self.client.force_authenticate(user=None)
        exchange = self.client.post(reverse('api-guest-exchange'), {'token': token, 'name': 'Sam', 'email': 'sam@example.com'}, format='json')
        review = self.client.get(reverse('api-guest-review', args=[self.project.id]), HTTP_X_GUEST_ACCESS_KEY=exchange.json()['access_key'])
        self.assertEqual(review.status_code, 200, review.content)
        return [item['id'] for item in review.json()['media_versions']]

    def test_unpublished_file_is_refused_without_confirmation(self):
        response = self.share()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['code'], 'not_published')
        self.assertFalse(GuestInvite.objects.filter(project=self.project).exists())
        self.assertFalse(MediaVersion.objects.exists())

    def test_confirmed_share_publishes_the_file_and_the_guest_sees_it(self):
        response = self.share(publish_file=True)
        self.assertEqual(response.status_code, 201, response.content)
        version = MediaVersion.objects.get(id=response.json()['media_version_id'])
        self.assertEqual(version.project_id, self.project.id)
        self.assertEqual(str(version.original_file_id), self.asset['file']['id'])
        self.assertEqual(self.guest_cuts(response.json()['token']), [str(version.id)])

    def test_already_published_file_reuses_its_version(self):
        first = self.share(publish_file=True).json()['media_version_id']
        again = self.share()
        self.assertEqual(again.status_code, 201, again.content)
        self.assertEqual(again.json()['media_version_id'], first)
        self.assertEqual(MediaVersion.objects.count(), 1)

    def test_file_published_elsewhere_is_refused(self):
        self.share(publish_file=True)
        response = self.share(project=self.other)
        self.assertEqual(response.status_code, 400)
        self.assertIn('november', response.json()['detail'])

    def test_project_link_without_a_file_is_unchanged(self):
        response = self.client.post(
            reverse('api-project-guest-invites', args=[self.workspace.id, self.project.id]),
            {'permissions': ['media.read'], 'expires_in_hours': 24}, format='json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertNotIn('media_version_id', response.json())
