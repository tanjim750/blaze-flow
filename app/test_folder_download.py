import shutil
from unittest import mock
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, TestCase, override_settings
from django.urls import reverse

from .models import AuditLog, File, MediaVersion, Project, ProjectFile
from .services import folder_zip
from .services.folder_zip import FolderZipPlan, ZipEntry, safe_name
from .test_access_projects import WorkspaceAccessSetupMixin


class SafeNameTests(SimpleTestCase):
    def test_unsafe_names_cannot_escape_the_folder(self):
        self.assertEqual(safe_name('../../etc/passwd'), '.._.._etc_passwd')
        self.assertEqual(safe_name('..'), 'untitled')
        self.assertEqual(safe_name(''), 'untitled')

    def test_s3_urls_are_presigned_with_the_configured_expiry(self):
        calls = []

        class S3Like:
            def url(self, key, expire=None):
                calls.append((key, expire))
                return f'https://r2.example/{key}?X-Amz-Signature=x'
        with mock.patch.object(folder_zip, 'default_storage', S3Like()), override_settings(FOLDER_ZIP_URL_EXPIRE_SECONDS=900):
            data = folder_zip.manifest_with_urls(FolderZipPlan(root_name='R', entries=[ZipEntry('R/a.mov', 'k/a.mov', 5)], empty_dirs=['R/e']))
        self.assertEqual(calls, [('k/a.mov', 900)])
        self.assertEqual(data['entries'][0]['url'], 'https://r2.example/k/a.mov?X-Amz-Signature=x')
        self.assertEqual(data['empty_dirs'], ['R/e'])


class FolderDownloadApiTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='blazeflow-folder-zip-')
        self.override = override_settings(MEDIA_ROOT=self.media_root)
        self.override.enable()
        super().setUp()
        self.client.force_authenticate(self.owner)
        response = self.client.post(reverse('api-projects', args=[self.workspace.id]), {'name': 'Launch'}, format='json')
        self.project = Project.objects.get(id=response.json()['id'])
        self.root = self.folder('Footage')
        self.sub = self.folder('Day 1', parent=self.root)
        self.empty = self.folder('Empty', parent=self.root)
        self.a = self.upload('a.png', self.root)
        self.b = self.upload('b.png', self.sub)
        self.pending = self.upload('pending.png', self.sub, ready=False)

    def tearDown(self):
        self.override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)

    def folder(self, name, parent=None):
        response = self.client.post(reverse('api-asset-folders', args=[self.workspace.id]), {
            'name': name, 'project_id': str(self.project.id), 'client_team_id': None,
            'parent_folder_id': str(parent) if parent else None,
        }, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()['id']

    def upload(self, name, folder, ready=True):
        response = self.client.post(reverse('api-asset-files', args=[self.workspace.id]), {
            'file': SimpleUploadedFile(name, b'\x89PNG\r\n\x1a\n' + name.encode(), content_type='image/png'),
            'project_id': str(self.project.id), 'folder_id': folder,
        }, format='multipart')
        self.assertEqual(response.status_code, 201, response.content)
        item = response.json()
        File.objects.filter(id=item['file']['id']).update(status='READY' if ready else 'PENDING')
        return item

    def url(self, folder):
        return reverse('api-asset-folder-download', args=[self.workspace.id, folder])

    def manifest(self, folder):
        response = self.client.get(self.url(folder))
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_manifest_keeps_nested_structure_and_skips_files_that_are_not_ready(self):
        manifest = self.manifest(self.root)
        self.assertEqual(manifest['name'], 'Footage.zip')
        self.assertEqual([e['path'] for e in manifest['entries']], ['Footage/a.png', 'Footage/Day 1/b.png'])
        self.assertEqual(manifest['file_count'], 2)
        self.assertEqual(manifest['empty_dirs'], ['Footage/Empty'])
        self.assertEqual(manifest['skipped'], [{'path': 'Footage/Day 1/pending.png', 'reason': 'not ready (still uploading or being checked)'}])
        self.assertTrue(all(e['url'] and e['size'] > 0 for e in manifest['entries']))
        self.assertIn('urls_expire_at', manifest)
        self.assertTrue(AuditLog.objects.filter(action='folder.downloaded', entity_id=self.root).exists())

    def test_url_refresh_is_not_audited_twice(self):
        self.manifest(self.root)
        self.client.get(self.url(self.root), {'retry': '1'})
        self.assertEqual(AuditLog.objects.filter(action='folder.downloaded', entity_id=self.root).count(), 1)

    def test_server_never_streams_the_zip(self):
        response = self.client.get(self.url(self.root))
        self.assertEqual(response['Content-Type'], 'application/json')
        self.assertFalse(getattr(response, 'streaming', False))

    def test_only_latest_version_of_an_asset_is_included(self):
        older = ProjectFile.objects.get(id=self.a['id'])
        newer = ProjectFile.objects.get(id=self.b['id'])
        ProjectFile.objects.filter(id=newer.id).update(folder_id=self.root, media_asset=older.media_asset, version_number=older.version_number + 1)
        paths = [e['path'] for e in self.manifest(self.root)['entries']]
        self.assertNotIn('Footage/a.png', paths)
        self.assertIn('Footage/b.png', paths)

    def test_people_without_access_cannot_download(self):
        self.client.force_authenticate(self.member_user)
        self.assertIn(self.client.get(self.url(self.root)).status_code, (403, 404))
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(self.url(self.root)).status_code, (401, 403))

    # ------------------------------------------------------------------ guests
    def guest(self, permissions, file_scoped=False):
        self.client.force_authenticate(self.owner)
        payload = {'label': 'Client', 'permissions': permissions, 'expires_in_hours': 24}
        invite = self.client.post(reverse('api-project-guest-invites', args=[self.workspace.id, self.project.id]), payload, format='json')
        self.assertEqual(invite.status_code, 201, invite.content)
        if file_scoped:
            from .models import GuestInvite
            GuestInvite.objects.filter(id=invite.json()['id']).update(
                shared_media_version_id=MediaVersion.objects.filter(original_file_id=self.a['file']['id']).values_list('id', flat=True).first())
        self.client.force_authenticate(None)
        exchange = self.client.post(reverse('api-guest-exchange'), {'token': invite.json()['token'], 'name': 'Client', 'email': 'client@example.com'}, format='json')
        self.assertEqual(exchange.status_code, 201, exchange.content)
        return {'HTTP_X_GUEST_ACCESS_KEY': exchange.json()['access_key']}

    def test_guest_with_download_permission_gets_only_downloadable_files(self):
        MediaVersion.objects.filter(original_file_id=self.b['file']['id']).update(allow_download=True)
        headers = self.guest(['media.read', 'media.download'])
        review = self.client.get(reverse('api-guest-review', args=[self.project.id]), **headers).json()
        self.assertTrue(review['viewer']['can_download_folders'])
        self.assertEqual([f['path'] for f in review['folders']], ['Footage', 'Footage / Day 1'])
        link = self.client.post(reverse('api-guest-folder-download-link', args=[self.project.id, self.root]), **headers)
        self.assertEqual(link.status_code, 200, link.content)
        self.assertEqual([e['path'] for e in link.json()['entries']], ['Footage/Day 1/b.png'])

    def test_guest_without_download_permission_is_refused(self):
        headers = self.guest(['media.read'])
        review = self.client.get(reverse('api-guest-review', args=[self.project.id]), **headers).json()
        self.assertFalse(review['viewer']['can_download_folders'])
        self.assertEqual(review['folders'], [])
        self.assertEqual(self.client.post(reverse('api-guest-folder-download-link', args=[self.project.id, self.root]), **headers).status_code, 403)

    def test_file_scoped_link_cannot_download_folders(self):
        headers = self.guest(['media.read', 'media.download'], file_scoped=True)
        self.assertEqual(self.client.post(reverse('api-guest-folder-download-link', args=[self.project.id, self.root]), **headers).status_code, 403)

    def test_revoked_guest_link_gets_no_urls(self):
        headers = self.guest(['media.read', 'media.download'])
        from django.utils import timezone
        from .models import GuestReviewAccess
        GuestReviewAccess.objects.update(revoked_at=timezone.now())
        self.assertIn(self.client.post(reverse('api-guest-folder-download-link', args=[self.project.id, self.root]), **headers).status_code, (401, 403))
