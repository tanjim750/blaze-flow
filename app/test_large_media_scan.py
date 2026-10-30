import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse

from .models import File, FileSecurityScan, OutboxEvent
from .services import file_processing
from .services.file_processing import (
    BLOCKED_TOO_LARGE, PREVIEW_TOPIC, SKIPPED_LARGE_MEDIA, _sniff_video_container, process_security_scan,
)
from .test_access_projects import WorkspaceAccessSetupMixin

HAS_FFMPEG = bool(shutil.which('ffmpeg') and shutil.which('ffprobe'))
SCANNED = []
PNG = b'\x89PNG\r\n\x1a\n' + b'asset-media'


class RecordingScanner:
    name = 'recording-test-scanner'

    def scan(self, stream):
        SCANNED.append(stream.read())
        return {'clean': True}


def _tiny_mp4():
    with tempfile.TemporaryDirectory() as directory:
        out = Path(directory) / 'clip.mp4'
        subprocess.run(
            ['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=5', '-t', '1',
             '-pix_fmt', 'yuv420p', str(out)], check=True, timeout=60,
        )
        return out.read_bytes()


class SniffVideoContainerTests(unittest.TestCase):
    def test_recognises_video_containers_by_magic_bytes(self):
        self.assertEqual(_sniff_video_container(b'\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00'), 'isobmff')
        self.assertEqual(_sniff_video_container(b'\x1a\x45\xdf\xa3\x01\x00\x00\x00'), 'matroska')
        self.assertEqual(_sniff_video_container(b'RIFF\x00\x00\x00\x00AVI LIST'), 'avi')

    def test_rejects_non_video_bytes(self):
        for header in (b'%PDF-1.7\n', b'\x89PNG\r\n\x1a\n\x00\x00', b'PK\x03\x04\x14\x00', b'RIFF\x00\x00\x00\x00WAVEfmt ', b''):
            self.assertIsNone(_sniff_video_container(header))


@override_settings(FILE_SECURITY_SCANNER='app.test_large_media_scan.RecordingScanner')
class LargeMediaScanTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='blazeflow-large-scan-')
        self.override = override_settings(
            MEDIA_ROOT=self.media_root, MAX_MEDIA_UPLOAD_BYTES=10 * 1024 * 1024,
            MAX_REVIEW_ATTACHMENT_BYTES=10 * 1024 * 1024,
        )
        self.override.enable()
        super().setUp()
        SCANNED.clear()
        self.client.force_authenticate(self.owner)
        project = self.client.post(reverse('api-projects', args=[self.workspace.id]), {'name': 'Scan'}, format='json')
        self.project_id = project.json()['id']

    def tearDown(self):
        self.override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)
        super().tearDown()

    def upload_media(self, name, content, content_type):
        response = self.client.post(
            reverse('api-media-versions', args=[self.workspace.id, self.project_id]),
            {'file': SimpleUploadedFile(name, content, content_type=content_type), 'title': name},
            format='multipart',
        )
        self.assertEqual(response.status_code, 201, response.content)
        file = File.objects.filter(original_name=name).latest('created_at')
        OutboxEvent.objects.filter(aggregate_id=str(file.id), topic=PREVIEW_TOPIC).delete()
        return file

    @unittest.skipUnless(HAS_FFMPEG, 'ffmpeg/ffprobe required')
    def test_oversized_verified_video_skips_scan_and_continues_to_processing(self):
        content = _tiny_mp4()
        file = self.upload_media('clip.mp4', content, 'video/mp4')
        with override_settings(CLAMAV_MAX_STREAM_BYTES=len(content) - 1):
            with self.assertLogs('app.services.file_processing', level='WARNING') as logs:
                scan = process_security_scan(file_id=file.id)
        self.assertEqual(SCANNED, [])
        self.assertEqual(scan.status, 'CLEAN')
        self.assertEqual(scan.result['scan_status'], SKIPPED_LARGE_MEDIA)
        self.assertTrue(scan.result['skipped'])
        self.assertGreaterEqual(scan.result['video_streams'], 1)
        file.refresh_from_db()
        self.assertEqual(file.status, 'READY')
        self.assertTrue(OutboxEvent.objects.filter(aggregate_id=str(file.id), topic=PREVIEW_TOPIC).exists())
        self.assertIn('skipped for large verified video', logs.output[0])

    @unittest.skipUnless(HAS_FFMPEG, 'ffmpeg/ffprobe required')
    def test_video_magic_without_a_video_stream_is_blocked(self):
        content = _tiny_mp4()
        file = self.upload_media('clip2.mp4', content, 'video/mp4')
        with override_settings(CLAMAV_MAX_STREAM_BYTES=16), \
                patch.object(file_processing, '_ffprobe_video_streams', return_value=({'mov', 'mp4'}, 0)):
            scan = process_security_scan(file_id=file.id)
        self.assertEqual(SCANNED, [])
        self.assertEqual(scan.status, 'FAILED')
        self.assertEqual(scan.result['scan_status'], BLOCKED_TOO_LARGE)
        file.refresh_from_db()
        self.assertEqual(file.status, 'FAILED')

    def test_oversized_non_video_claiming_video_mime_is_blocked(self):
        content = PNG + b'0' * 4096
        file = self.upload_media('still.png', content, 'image/png')
        File.objects.filter(id=file.id).update(mime_type='video/mp4', original_name='still.mp4')
        with override_settings(CLAMAV_MAX_STREAM_BYTES=1024):
            scan = process_security_scan(file_id=file.id)
        self.assertEqual(SCANNED, [])
        self.assertEqual(scan.status, 'FAILED')
        self.assertIn('not a verified video', scan.result['error'])
        self.assertFalse(OutboxEvent.objects.filter(aggregate_id=str(file.id), topic=PREVIEW_TOPIC).exists())

    def test_files_within_the_limit_are_still_scanned(self):
        content = PNG
        file = self.upload_media('small.png', content, 'image/png')
        with override_settings(CLAMAV_MAX_STREAM_BYTES=1024 * 1024):
            scan = process_security_scan(file_id=file.id)
        self.assertEqual(SCANNED, [content])
        self.assertEqual(scan.status, 'CLEAN')
        self.assertNotIn('scan_status', scan.result)
