import shutil
import tempfile
import uuid
from unittest.mock import patch

from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.files.storage import FileSystemStorage, default_storage
from django.test import SimpleTestCase, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .http_range import RangeNotSatisfiable, parse_range
from .models import AuditLog, FileStatus, FileVariant, MediaVersion, Project
from .test_access_projects import WorkspaceAccessSetupMixin

PAYLOAD = bytes(range(256)) * 40  # 10,240 bytes, every offset distinguishable


class ParseRangeTests(SimpleTestCase):
    def test_no_header_or_unknown_syntax_means_whole_file(self):
        for header in (None, '', 'items=0-1', 'bytes=', 'bytes=-', 'bytes=abc', 'bytes=5-2', 'bytes=0-1,4-5'):
            self.assertIsNone(parse_range(header, 100), header)

    def test_closed_open_and_suffix_ranges(self):
        self.assertEqual(parse_range('bytes=0-0', 100), (0, 0))
        self.assertEqual(parse_range('bytes=10-19', 100), (10, 19))
        self.assertEqual(parse_range('bytes=90-', 100), (90, 99))
        self.assertEqual(parse_range('bytes=-10', 100), (90, 99))
        self.assertEqual(parse_range('BYTES = 1 - 2', 100), (1, 2))

    def test_end_past_the_file_is_clamped_and_long_suffix_is_whole_file(self):
        self.assertEqual(parse_range('bytes=50-5000', 100), (50, 99))
        self.assertEqual(parse_range('bytes=-500', 100), (0, 99))

    def test_ranges_outside_the_file_are_unsatisfiable(self):
        for header in ('bytes=100-', 'bytes=100-200', 'bytes=-0'):
            with self.assertRaises(RangeNotSatisfiable, msg=header):
                parse_range(header, 100)
        with self.assertRaises(RangeNotSatisfiable):
            parse_range('bytes=-1', 0)


class RangedMediaEndpointTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='blazeflow-range-tests-')
        self.settings_override = override_settings(MEDIA_ROOT=self.media_root)
        self.settings_override.enable()
        super().setUp()
        self.client.force_authenticate(self.owner)
        project = self.client.post(reverse('api-projects', args=[self.workspace.id]), {'name': 'Range Project'}, format='json')
        self.project = Project.objects.get(id=project.json()['id'])
        uploaded = self.client.post(
            reverse('api-media-versions', args=[self.workspace.id, self.project.id]),
            {'file': SimpleUploadedFile('frame.png', b'\x89PNG\r\n\x1a\n' + PAYLOAD, content_type='image/png'),
             'title': 'Ranged', 'allow_download': 'true'},
            format='multipart',
        )
        self.assertEqual(uploaded.status_code, 201, uploaded.content)
        self.media = MediaVersion.objects.select_related('original_file').get(id=uploaded.json()['id'])
        self.original = b'\x89PNG\r\n\x1a\n' + PAYLOAD
        self.variant = self._make_proxy_variant()
        self.preview_url = reverse('api-media-version-preview', args=[self.workspace.id, self.project.id, self.media.id])
        self.download_url = reverse('api-media-version-download', args=[self.workspace.id, self.project.id, self.media.id])

    def tearDown(self):
        self.settings_override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)
        super().tearDown()

    def _make_proxy_variant(self):
        file_record = self.media.original_file
        key = default_storage.save(f'tests/{uuid.uuid4()}.mp4', ContentFile(PAYLOAD))
        now = timezone.now()
        return FileVariant.objects.create(
            id=uuid.uuid4(), file=file_record, storage_backend=file_record.storage_backend,
            object_key=key, original_name='clip.preview.mp4', mime_type='video/mp4',
            size_bytes=len(PAYLOAD), checksum='abc123', checksum_algorithm='sha256',
            metadata={'variant_type': 'VIDEO_PROXY'}, status=FileStatus.READY,
            created_at=now + timezone.timedelta(minutes=1), updated_at=now,
        )

    def body(self, response):
        return b''.join(response.streaming_content) if response.streaming else response.content

    def test_full_preview_advertises_ranges_and_etag(self):
        response = self.client.get(self.preview_url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Accept-Ranges'], 'bytes')
        self.assertEqual(response['Content-Length'], str(len(PAYLOAD)))
        self.assertEqual(response['Content-Type'], 'video/mp4')
        self.assertEqual(response['ETag'], '"abc123"')
        self.assertEqual(self.body(response), PAYLOAD)

    def test_single_range_returns_206_with_exact_bytes(self):
        response = self.client.get(self.preview_url, HTTP_RANGE='bytes=1000-2023')
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response['Content-Range'], f'bytes 1000-2023/{len(PAYLOAD)}')
        self.assertEqual(response['Content-Length'], '1024')
        self.assertEqual(response['Accept-Ranges'], 'bytes')
        self.assertEqual(self.body(response), PAYLOAD[1000:2024])

    def test_open_ended_and_suffix_ranges(self):
        tail = self.client.get(self.preview_url, HTTP_RANGE='bytes=10000-')
        self.assertEqual(tail.status_code, 206)
        self.assertEqual(self.body(tail), PAYLOAD[10000:])
        suffix = self.client.get(self.preview_url, HTTP_RANGE='bytes=-16')
        self.assertEqual(suffix.status_code, 206)
        self.assertEqual(suffix['Content-Range'], f'bytes {len(PAYLOAD) - 16}-{len(PAYLOAD) - 1}/{len(PAYLOAD)}')
        self.assertEqual(self.body(suffix), PAYLOAD[-16:])

    def test_unsatisfiable_range_is_416(self):
        response = self.client.get(self.preview_url, HTTP_RANGE=f'bytes={len(PAYLOAD)}-')
        self.assertEqual(response.status_code, 416)
        self.assertEqual(response['Content-Range'], f'bytes */{len(PAYLOAD)}')

    def test_multi_range_and_stale_if_range_fall_back_to_full_body(self):
        multi = self.client.get(self.preview_url, HTTP_RANGE='bytes=0-1,5-6')
        self.assertEqual(multi.status_code, 200)
        self.assertEqual(self.body(multi), PAYLOAD)
        stale = self.client.get(self.preview_url, HTTP_RANGE='bytes=0-1', HTTP_IF_RANGE='"other"')
        self.assertEqual(stale.status_code, 200)
        fresh = self.client.get(self.preview_url, HTTP_RANGE='bytes=0-1', HTTP_IF_RANGE='"abc123"')
        self.assertEqual(fresh.status_code, 206)

    def test_head_returns_headers_without_body(self):
        full = self.client.head(self.preview_url)
        self.assertEqual(full.status_code, 200)
        self.assertEqual(full['Content-Length'], str(len(PAYLOAD)))
        self.assertEqual(full['Accept-Ranges'], 'bytes')
        self.assertEqual(full.content, b'')
        ranged = self.client.head(self.preview_url, HTTP_RANGE='bytes=0-99')
        self.assertEqual(ranged.status_code, 206)
        self.assertEqual(ranged['Content-Length'], '100')

    def test_permission_is_checked_before_any_file_io(self):
        outsider = type(self.owner).objects.create_user(
            email='range-outsider@example.com', password='a-secure-test-password',
            first_name='Range', last_name='Outsider',
        )
        self.client.force_authenticate(outsider)
        with patch.object(FileSystemStorage, 'open') as opened, patch.object(FileSystemStorage, 'size') as sized, \
                patch.object(FileSystemStorage, 'exists') as exists:
            self.assertEqual(self.client.get(self.preview_url, HTTP_RANGE='bytes=0-10').status_code, 403)
            self.assertEqual(self.client.head(self.preview_url).status_code, 403)
            self.assertEqual(self.client.get(self.download_url, HTTP_RANGE='bytes=0-10').status_code, 403)
        opened.assert_not_called()
        sized.assert_not_called()
        exists.assert_not_called()

    def test_ranged_download_keeps_attachment_and_audits_once(self):
        first = self.client.get(self.download_url, HTTP_RANGE='bytes=0-7')
        self.assertEqual(first.status_code, 206)
        self.assertEqual(self.body(first), self.original[:8])
        self.assertIn('attachment', first['Content-Disposition'])
        rest = self.client.get(self.download_url, HTTP_RANGE='bytes=8-')
        self.assertEqual(rest.status_code, 206)
        self.assertEqual(self.body(rest), self.original[8:])
        self.client.head(self.download_url)
        self.assertEqual(AuditLog.objects.filter(action='media.downloaded').count(), 1)

    def test_full_download_still_works(self):
        response = self.client.get(self.download_url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Accept-Ranges'], 'bytes')
        self.assertIn('attachment', response['Content-Disposition'])
        self.assertEqual(self.body(response), self.original)
