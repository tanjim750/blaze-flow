"""Opening files in review: the asset download route's ``?inline=1`` display mode.

The review page shows images in the frame and PDFs in the browser's viewer, which needs the
bytes served for display rather than as an attachment, and a PDF needs to be frameable by the
app's own origin. Everything a browser would run as a document stays an attachment.
"""
import io
import shutil
import tempfile

from PIL import Image
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse

from .models import File, FileStatus, ProjectAccessMode
from .services.outbox import process_outbox_events
from .test_access_projects import WorkspaceAccessSetupMixin


class InlineAssetDownloadTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='blazeflow-open-in-review-tests-')
        self.settings_override = override_settings(MEDIA_ROOT=self.media_root, MAX_PROJECT_FILE_BYTES=1024 * 1024)
        self.settings_override.enable()
        super().setUp()
        self.client.force_authenticate(self.owner)
        buffer = io.BytesIO()
        Image.new('RGB', (24, 16), '#583be8').save(buffer, format='PNG')
        response = self.client.post(
            reverse('api-asset-files', args=[self.workspace.id]),
            {'file': SimpleUploadedFile('still.png', buffer.getvalue(), content_type='image/png')},
            format='multipart',
        )
        self.assertEqual(response.status_code, 201)
        self.asset = response.json()
        process_outbox_events()
        process_outbox_events()
        File.objects.filter(id=self.asset['file']['id']).update(status=FileStatus.READY)
        self.url = reverse('api-asset-file-download', args=[self.workspace.id, self.asset['id']])

    def tearDown(self):
        self.settings_override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)

    def set_mime(self, mime_type):
        File.objects.filter(id=self.asset['file']['id']).update(mime_type=mime_type)

    def test_default_download_is_still_an_attachment_and_not_frameable(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response['Content-Disposition'].startswith('attachment'))
        self.assertEqual(response['X-Frame-Options'], 'DENY')

    def test_inline_serves_an_image_for_display_frameable_by_the_app_only(self):
        response = self.client.get(self.url + '?inline=1')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response['Content-Disposition'].startswith('inline'))
        self.assertEqual(response['X-Frame-Options'], 'SAMEORIGIN')
        self.assertEqual(response['X-Content-Type-Options'], 'nosniff')

    def test_inline_pdf_video_and_audio_are_allowed(self):
        for mime in ('application/pdf', 'video/mp4', 'audio/mpeg', 'image/jpeg; charset=binary'):
            with self.subTest(mime=mime):
                self.set_mime(mime)
                response = self.client.get(self.url + '?inline=1')
                self.assertTrue(response['Content-Disposition'].startswith('inline'), mime)

    def test_documents_a_browser_would_run_always_download(self):
        for mime in ('text/html', 'image/svg+xml', 'application/xhtml+xml', 'text/javascript', 'application/octet-stream', ''):
            with self.subTest(mime=mime):
                self.set_mime(mime)
                response = self.client.get(self.url + '?inline=1')
                self.assertTrue(response['Content-Disposition'].startswith('attachment'), mime)
                self.assertEqual(response['X-Frame-Options'], 'DENY')

    def test_only_the_exact_flag_switches_modes(self):
        for query in ('?inline=true', '?inline=0', '?inline='):
            with self.subTest(query=query):
                self.assertTrue(self.client.get(self.url + query)['Content-Disposition'].startswith('attachment'))

    def test_inline_does_not_widen_who_can_read_the_file(self):
        # Same permission check either way: a member gets exactly what a plain download gives
        # them, and an anonymous request is refused.
        self.invite_and_accept(project_access_mode=ProjectAccessMode.SELECTED)
        self.client.force_authenticate(self.member_user)
        self.assertEqual(self.client.get(self.url + '?inline=1').status_code, self.client.get(self.url).status_code)
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(self.url + '?inline=1').status_code, (401, 403))
