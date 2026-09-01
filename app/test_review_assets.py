import hashlib
import io
import shutil
import struct
import tempfile
import wave
from datetime import timedelta
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.files.storage import default_storage
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from PIL import Image

from .models import Annotation, AnnotationRevision, AuditLog, File, FileSecurityScan, FileVariant, OutboxEvent, ReviewCommentContent
from .services.file_processing import ClamAVTcpScanner
from .services.media import _storage_backend
from .services.outbox import process_outbox_events
from .services.retention import purge_deleted_review_files
from .test_access_projects import WorkspaceAccessSetupMixin


class FailingTestScanner:
    name = 'failing-test-scanner'

    def scan(self, stream):
        raise RuntimeError('scanner unavailable')


class FakeClamAVSocket:
    def __init__(self, response):
        self.response = response
        self.sent = bytearray()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return None

    def settimeout(self, timeout):
        self.timeout = timeout

    def sendall(self, data):
        self.sent.extend(data)

    def recv(self, size):
        response, self.response = self.response, b''
        return response


class ReviewAssetsApiTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='blazeflow-review-assets-')
        self.settings_override = override_settings(
            MEDIA_ROOT=self.media_root,
            MAX_MEDIA_UPLOAD_BYTES=1024 * 1024,
            MAX_REVIEW_ATTACHMENT_BYTES=1024 * 1024,
        )
        self.settings_override.enable()
        super().setUp()
        self.client.force_authenticate(self.owner)
        project = self.client.post(reverse('api-projects', args=[self.workspace.id]), {'name': 'Review Assets'}, format='json')
        self.project_id = project.json()['id']
        media = self.client.post(
            reverse('api-media-versions', args=[self.workspace.id, self.project_id]),
            {'file': SimpleUploadedFile('frame.png', b'\x89PNG\r\n\x1a\nasset-media', content_type='image/png'), 'title': 'Asset media'},
            format='multipart',
        )
        self.media_id = media.json()['id']
        comment = self.client.post(
            reverse('api-review-comments', args=[self.workspace.id, self.project_id, self.media_id]),
            {'text': 'Reference files and markup'}, format='json',
        )
        self.comment_id = comment.json()['id']

    def tearDown(self):
        self.settings_override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)
        super().tearDown()

    def attachment_upload_url(self):
        return reverse('api-review-attachment-upload', args=[self.workspace.id, self.project_id, self.media_id, self.comment_id])

    def annotations_url(self):
        return reverse('api-annotations', args=[self.workspace.id, self.project_id, self.media_id])

    def test_verified_attachment_upload_private_download_and_soft_delete(self):
        content = b'%PDF-1.7\nreview reference'
        uploaded = self.client.post(
            self.attachment_upload_url(),
            {'file': SimpleUploadedFile('reference.pdf', content, content_type='application/pdf')},
            format='multipart',
        )
        content_id = uploaded.json()['id']
        detail_url = reverse('api-review-attachment-detail', args=[self.workspace.id, self.project_id, self.media_id, self.comment_id, content_id])
        self.assertEqual(uploaded.status_code, 201)
        self.assertEqual(uploaded.json()['file']['status'], 'PENDING')
        self.assertEqual(uploaded.json()['file']['checksum_sha256'], hashlib.sha256(content).hexdigest())
        self.assertEqual(self.client.get(detail_url).status_code, 409)
        process_outbox_events()
        process_outbox_events()
        downloaded = self.client.get(detail_url)
        self.assertEqual(b''.join(downloaded.streaming_content), content)
        variant = FileVariant.objects.get(file_id=uploaded.json()['file']['id'])
        self.assertEqual(variant.status, 'READY')
        preview_url = reverse('api-review-attachment-preview', args=[self.workspace.id, self.project_id, self.media_id, self.comment_id, content_id, variant.id])
        preview = self.client.get(preview_url)
        self.assertEqual(preview.status_code, 200)
        self.assertIn(b'<svg', b''.join(preview.streaming_content))
        self.assertTrue(AuditLog.objects.filter(action='review.attachment.downloaded').exists())
        self.assertEqual(self.client.delete(detail_url).status_code, 204)
        self.assertEqual(self.client.get(detail_url).status_code, 404)
        attachment = ReviewCommentContent.objects.get(id=content_id)
        self.assertIsNotNone(attachment.deleted_at)
        self.assertIsNotNone(attachment.file.deleted_at)

    def test_retention_dry_run_then_physically_purges_deleted_attachment_and_preview(self):
        uploaded = self.client.post(
            self.attachment_upload_url(),
            {'file': SimpleUploadedFile('old.pdf', b'%PDF-1.7\nold', content_type='application/pdf')},
            format='multipart',
        )
        process_outbox_events()
        process_outbox_events()
        attachment = ReviewCommentContent.objects.get(id=uploaded.json()['id'])
        variant = FileVariant.objects.get(file=attachment.file)
        detail_url = reverse('api-review-attachment-detail', args=[self.workspace.id, self.project_id, self.media_id, self.comment_id, attachment.id])
        self.client.delete(detail_url)
        old = timezone.now() - timedelta(days=31)
        File.objects.filter(id=attachment.file_id).update(deleted_at=old)
        ReviewCommentContent.objects.filter(id=attachment.id).update(deleted_at=old)
        self.assertTrue(default_storage.exists(attachment.file.object_key))
        self.assertTrue(default_storage.exists(variant.object_key))

        command_output = io.StringIO()
        call_command('purge_review_files', older_than_days=30, dry_run=True, stdout=command_output)
        preview = purge_deleted_review_files(older_than_days=30, dry_run=True)
        purged = purge_deleted_review_files(older_than_days=30)

        self.assertIn('"dry_run": true', command_output.getvalue())
        self.assertEqual(preview['examined'], 1)
        self.assertEqual(preview['purged'], 0)
        self.assertEqual(purged['purged'], 1)
        self.assertFalse(default_storage.exists(attachment.file.object_key))
        self.assertFalse(default_storage.exists(variant.object_key))
        attachment.file.refresh_from_db()
        self.assertIn('physical_deleted_at', attachment.file.metadata)
        self.assertEqual(purge_deleted_review_files(older_than_days=30)['examined'], 0)

    def test_spoofed_or_oversized_attachment_is_rejected_without_file_row(self):
        initial_files = File.objects.count()
        spoofed = self.client.post(
            self.attachment_upload_url(),
            {'file': SimpleUploadedFile('fake.pdf', b'not-a-pdf', content_type='application/pdf')},
            format='multipart',
        )
        self.assertEqual(spoofed.status_code, 400)
        self.assertEqual(File.objects.count(), initial_files)

    def test_eicar_marker_is_quarantined_and_never_downloadable(self):
        uploaded = self.client.post(
            self.attachment_upload_url(),
            {'file': SimpleUploadedFile('unsafe.pdf', b'%PDF-1.7\nEICAR-STANDARD-ANTIVIRUS-TEST-FILE', content_type='application/pdf')},
            format='multipart',
        )
        process_outbox_events()
        detail_url = reverse('api-review-attachment-detail', args=[self.workspace.id, self.project_id, self.media_id, self.comment_id, uploaded.json()['id']])
        self.assertEqual(uploaded.status_code, 201)
        self.assertEqual(self.client.get(detail_url).status_code, 409)
        self.assertEqual(FileSecurityScan.objects.get(file_id=uploaded.json()['file']['id']).status, 'INFECTED')

    def test_real_image_and_wav_generate_decoded_derivatives(self):
        image_bytes = io.BytesIO()
        Image.new('RGB', (1600, 900), '#2563eb').save(image_bytes, format='PNG')
        image_upload = self.client.post(
            self.attachment_upload_url(),
            {'file': SimpleUploadedFile('large.png', image_bytes.getvalue(), content_type='image/png')},
            format='multipart',
        )
        wav_bytes = io.BytesIO()
        with wave.open(wav_bytes, 'wb') as audio:
            audio.setparams((1, 2, 8000, 0, 'NONE', 'not compressed'))
            audio.writeframes(b''.join(struct.pack('<h', 16000 if index % 20 < 10 else -16000) for index in range(8000)))
        wav_upload = self.client.post(
            self.attachment_upload_url(),
            {'file': SimpleUploadedFile('voice.wav', wav_bytes.getvalue(), content_type='audio/wav')},
            format='multipart',
        )
        process_outbox_events()
        process_outbox_events()
        image_variant = FileVariant.objects.get(file_id=image_upload.json()['file']['id'])
        audio_variant = FileVariant.objects.get(file_id=wav_upload.json()['file']['id'])
        self.assertEqual(image_variant.metadata['variant_type'], 'IMAGE_THUMBNAIL')
        self.assertEqual(image_variant.mime_type, 'image/jpeg')
        self.assertLessEqual(image_variant.metadata['width'], 1280)
        self.assertEqual(audio_variant.metadata['variant_type'], 'AUDIO_WAVEFORM')
        self.assertEqual(audio_variant.metadata['duration_ms'], 1000)

    def test_pdf_and_mp3_generate_decoder_backed_previews(self):
        pdf_upload = self.client.post(
            self.attachment_upload_url(),
            {'file': SimpleUploadedFile('brief.pdf', b'%PDF-1.7\nbrief', content_type='application/pdf')},
            format='multipart',
        )
        mp3_upload = self.client.post(
            self.attachment_upload_url(),
            {'file': SimpleUploadedFile('voice.mp3', b'ID3\x04\x00\x00\x00\x00\x00\x00audio', content_type='audio/mpeg')},
            format='multipart',
        )
        process_outbox_events()

        def fake_decoder(command, **kwargs):
            if 'pdftoppm' in command[0]:
                Image.new('RGB', (900, 1200), '#ffffff').save(f'{command[-1]}.jpg', format='JPEG')
            else:
                with open(command[-1], 'wb') as output:
                    output.write(b''.join(struct.pack('<h', 12000 if index % 40 < 20 else -12000) for index in range(8000)))

        with patch('app.services.file_processing.shutil.which', side_effect=lambda command: command), patch(
            'app.services.file_processing.subprocess.run', side_effect=fake_decoder,
        ):
            process_outbox_events()
        pdf_variant = FileVariant.objects.get(file_id=pdf_upload.json()['file']['id'])
        mp3_variant = FileVariant.objects.get(file_id=mp3_upload.json()['file']['id'])
        self.assertEqual(pdf_variant.metadata['variant_type'], 'PDF_FIRST_PAGE')
        self.assertEqual(pdf_variant.mime_type, 'image/jpeg')
        self.assertEqual(pdf_variant.metadata['page'], 1)
        self.assertEqual(mp3_variant.metadata['variant_type'], 'MP3_WAVEFORM')
        self.assertEqual(mp3_variant.metadata['duration_ms'], 1000)

    def test_prometheus_metrics_are_manager_protected(self):
        metrics_url = reverse('api-operations-metrics', args=[self.workspace.id])
        owner_response = self.client.get(metrics_url)
        self.assertEqual(owner_response.status_code, 200)
        self.assertTrue(owner_response['Content-Type'].startswith('text/plain'))
        self.assertIn('blazeflow_operations_health', owner_response.content.decode())
        self.invite_and_accept()
        denied = self.client.get(metrics_url)
        self.assertEqual(denied.status_code, 403)

    @override_settings(
        CLAMAV_HOST='scanner.internal', CLAMAV_PORT=3310,
        CLAMAV_TIMEOUT_SECONDS=5, CLAMAV_MAX_STREAM_BYTES=1024,
    )
    def test_clamav_adapter_streams_and_parses_threat_response(self):
        connection = FakeClamAVSocket(b'stream: Win.Test.EICAR_HDB-1 FOUND\0')
        with patch('app.services.file_processing.socket.create_connection', return_value=connection) as connect:
            result = ClamAVTcpScanner().scan(io.BytesIO(b'test payload'))
        self.assertFalse(result['clean'])
        self.assertEqual(result['threat'], 'Win.Test.EICAR_HDB-1')
        self.assertTrue(connection.sent.startswith(b'zINSTREAM\0'))
        connect.assert_called_once_with(('scanner.internal', 3310), timeout=5)

    @override_settings(
        STORAGE_PROVIDER='s3-compatible',
        STORAGE_PUBLIC_METADATA={'driver': 's3', 'bucket': 'private-assets', 'region': 'eu-west-2'},
    )
    def test_storage_backend_records_s3_metadata_without_credentials(self):
        backend = _storage_backend(timezone.now())
        self.assertEqual(backend.provider, 's3-compatible')
        self.assertEqual(backend.config['bucket'], 'private-assets')
        self.assertNotIn('access_key', backend.config)
        self.assertNotIn('secret_key', backend.config)

    @override_settings(FILE_SECURITY_SCANNER='app.test_review_assets.FailingTestScanner')
    def test_scanner_outage_is_observable_and_retried(self):
        uploaded = self.client.post(
            self.attachment_upload_url(),
            {'file': SimpleUploadedFile('retry.pdf', b'%PDF-1.7\nretry', content_type='application/pdf')},
            format='multipart',
        )
        result = process_outbox_events(retry_base_seconds=1, retry_max_seconds=1)
        scan = FileSecurityScan.objects.get(file_id=uploaded.json()['file']['id'])
        event = OutboxEvent.objects.get(topic='file.security-scan.requested', aggregate_id=uploaded.json()['file']['id'])
        self.assertEqual(result['failed'], 1)
        self.assertEqual(scan.status, 'FAILED')
        self.assertEqual(event.status, 'FAILED')
        self.assertEqual(scan.file.status, 'PENDING')

    def test_operations_health_reports_processing_alerts(self):
        uploaded = self.client.post(
            self.attachment_upload_url(),
            {'file': SimpleUploadedFile('unsafe.pdf', b'%PDF-1.7\nEICAR-STANDARD-ANTIVIRUS-TEST-FILE', content_type='application/pdf')},
            format='multipart',
        )
        process_outbox_events()
        report = self.client.get(reverse('api-operations-health', args=[self.workspace.id]))
        self.assertEqual(report.status_code, 200)
        self.assertEqual(report.json()['status'], 'critical')
        self.assertEqual(report.json()['scans']['INFECTED'], 1)

    def test_annotation_create_validates_normalized_geometry(self):
        valid = self.client.post(
            self.annotations_url(),
            {'review_comment_id': self.comment_id, 'start_time_ms': 1200, 'elements': [{'element_type': 'RECTANGLE', 'geometry': {'x': 0.1, 'y': 0.2, 'width': 0.3, 'height': 0.4}, 'style': {'color': '#ff0000'}}]},
            format='json',
        )
        invalid = self.client.post(
            self.annotations_url(),
            {'elements': [{'element_type': 'RECTANGLE', 'geometry': {'x': 0.8, 'y': 0.2, 'width': 0.4, 'height': 0.4}}]},
            format='json',
        )
        self.assertEqual(valid.status_code, 201)
        self.assertEqual(valid.json()['elements'][0]['element_type'], 'RECTANGLE')
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(Annotation.objects.count(), 1)

    def test_annotation_edit_preserves_revision_and_author_rule(self):
        created = self.client.post(
            self.annotations_url(),
            {'elements': [{'element_type': 'POINT', 'geometry': {'x': 0.2, 'y': 0.3}}]},
            format='json',
        )
        annotation_id = created.json()['id']
        detail = reverse('api-annotation-detail', args=[self.workspace.id, self.project_id, self.media_id, annotation_id])
        self.invite_and_accept()
        self.client.force_authenticate(self.member_user)
        self.assertEqual(self.client.patch(detail, {'elements': [{'element_type': 'POINT', 'geometry': {'x': 0.4, 'y': 0.5}}]}, format='json').status_code, 403)

        self.client.force_authenticate(self.owner)
        edited = self.client.patch(detail, {'elements': [{'element_type': 'ARROW', 'geometry': {'start': {'x': 0.1, 'y': 0.1}, 'end': {'x': 0.9, 'y': 0.9}}}]}, format='json')
        revisions = self.client.get(reverse('api-annotation-revisions', args=[self.workspace.id, self.project_id, self.media_id, annotation_id]))
        self.assertEqual(edited.status_code, 200)
        self.assertEqual(edited.json()['revision_count'], 1)
        self.assertEqual(revisions.json()[0]['snapshot']['elements'][0]['element_type'], 'POINT')
        self.assertEqual(AnnotationRevision.objects.count(), 1)

    def test_annotation_manager_soft_deletes_and_health_is_owner_only(self):
        created = self.client.post(self.annotations_url(), {'elements': [{'element_type': 'TEXT', 'geometry': {'x': 0.2, 'y': 0.3}, 'payload': {'text': 'Move title'}}]}, format='json')
        detail = reverse('api-annotation-detail', args=[self.workspace.id, self.project_id, self.media_id, created.json()['id']])
        self.assertEqual(self.client.delete(detail).status_code, 204)
        self.assertEqual(self.client.get(self.annotations_url()).json(), [])
        health_url = reverse('api-delivery-health', args=[self.workspace.id])
        self.assertEqual(self.client.get(health_url).status_code, 200)
        self.invite_and_accept()
        self.client.force_authenticate(self.member_user)
        self.assertEqual(self.client.get(health_url).status_code, 403)

    def test_supervised_worker_once_mode_loads(self):
        with patch('app.management.commands.run_outbox_worker.close_old_connections') as close_connections:
            call_command('run_outbox_worker', once=True, batch_size=10, interval_seconds=0.1)
        close_connections.assert_not_called()
