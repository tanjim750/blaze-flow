import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, TestCase, override_settings
from django.urls import reverse

from .models import File, FileSecurityScan, Project, ProjectFile
from .services.outbox import process_outbox_events
from .services.project_files import resolve_stored_type, safe_download_content_type
from .test_access_projects import WorkspaceAccessSetupMixin

PNG = b'\x89PNG\r\n\x1a\n' + b'\x00' * 24
GENERIC = 'application/octet-stream'


class ResolveStoredTypeTests(SimpleTestCase):
    def test_matching_claim_keeps_the_type(self):
        self.assertEqual(resolve_stored_type('image/png', 'image/png'), 'image/png')

    def test_false_video_or_image_claims_become_generic(self):
        self.assertEqual(resolve_stored_type(None, 'video/mp4'), GENERIC)
        self.assertEqual(resolve_stored_type(None, 'image/png'), GENERIC)
        self.assertEqual(resolve_stored_type('video/mp4', 'image/png'), GENERIC)

    def test_unknown_types_are_generic(self):
        self.assertEqual(resolve_stored_type(None, 'text/html'), GENERIC)
        self.assertEqual(resolve_stored_type(None, ''), GENERIC)

    def test_signature_wins_when_nothing_was_claimed(self):
        self.assertEqual(resolve_stored_type('image/png', ''), 'image/png')

    def test_video_brands_are_still_video(self):
        self.assertEqual(resolve_stored_type('video/mp4', 'video/quicktime'), 'video/mp4')

    def test_dangerous_types_download_as_generic(self):
        for mime in ('text/html', 'image/svg+xml', 'application/javascript', 'application/x-msdownload', 'text/xml', ''):
            self.assertEqual(safe_download_content_type(mime), GENERIC)
        self.assertEqual(safe_download_content_type('video/mp4'), 'video/mp4')


class AnyProjectFileTypeTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='blazeflow-anytype-')
        self.override = override_settings(MEDIA_ROOT=self.media_root, MAX_PROJECT_FILE_BYTES=1024 * 1024)
        self.override.enable()
        super().setUp()
        self.client.force_authenticate(self.owner)
        r = self.client.post(reverse('api-projects', args=[self.workspace.id]), {'name': 'Any'}, format='json')
        self.project = Project.objects.get(id=r.json()['id'])

    def tearDown(self):
        self.override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)

    def upload(self, name, content, content_type):
        return self.client.post(
            reverse('api-project-files', args=[self.workspace.id, self.project.id]),
            {'file': SimpleUploadedFile(name, content, content_type=content_type)}, format='multipart',
        )

    def download(self, project_file_id):
        return self.client.get(reverse('api-project-file-download', args=[self.workspace.id, self.project.id, project_file_id]))

    def test_unknown_types_are_accepted(self):
        for name, data, mime in (('notes.txt', b'hello', 'text/plain'), ('model.blend', b'BLENDER-v300', ''),
                                 ('font.ttf', b'\x00\x01\x00\x00', 'font/ttf')):
            response = self.upload(name, data, mime)
            self.assertEqual(response.status_code, 201, response.content)

    def test_fake_video_and_image_are_stored_as_generic_files(self):
        for name, mime in (('fake.mp4', 'video/mp4'), ('fake.jpg', 'image/jpeg')):
            response = self.upload(name, b'not really media', mime)
            self.assertEqual(response.status_code, 201, response.content)
            self.assertEqual(File.objects.get(original_name=name).mime_type, GENERIC)

    def test_html_and_executables_download_as_safe_attachments(self):
        for name, data, mime in (('page.html', b'<script>alert(1)</script>', 'text/html'),
                                 ('setup.exe', b'MZ\x90\x00', 'application/x-msdownload')):
            response = self.upload(name, data, mime)
            self.assertEqual(response.status_code, 201, response.content)
            process_outbox_events()
            got = self.download(response.json()['id'])
            self.assertEqual(got.status_code, 200)
            self.assertEqual(got['Content-Type'], GENERIC)
            self.assertTrue(got['Content-Disposition'].startswith('attachment'))
            self.assertEqual(got['X-Content-Type-Options'], 'nosniff')

    def test_legacy_html_row_is_never_served_as_html(self):
        response = self.upload('legacy.html', b'<b>x</b>', 'text/html')
        process_outbox_events()
        File.objects.filter(original_name='legacy.html').update(mime_type='text/html')
        got = self.download(response.json()['id'])
        self.assertEqual(got['Content-Type'], GENERIC)
        self.assertTrue(got['Content-Disposition'].startswith('attachment'))

    def test_generic_files_are_still_scanned_and_infected_ones_blocked(self):
        response = self.upload('payload.bin', b'EICAR-STANDARD-ANTIVIRUS-TEST-FILE', '')
        self.assertEqual(response.status_code, 201, response.content)
        process_outbox_events()
        file_id = ProjectFile.objects.get(id=response.json()['id']).file_id
        self.assertEqual(FileSecurityScan.objects.get(file_id=file_id).status, 'INFECTED')
        self.assertEqual(self.download(response.json()['id']).status_code, 409)
