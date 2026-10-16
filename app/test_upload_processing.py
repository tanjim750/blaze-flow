"""The upload tray's processing endpoint: scan → preview/proxy → ready, members only."""
import shutil
import uuid
import tempfile

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .models import File, FileSecurityScan, FileSecurityScanStatus, FileStatus, OutboxEvent
from .services.upload_processing import processing_state
from .test_access_projects import WorkspaceAccessSetupMixin
from .test_ai_visual_qa import poster_png


class UploadProcessingTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='bf-tray-')
        self.override = override_settings(MEDIA_ROOT=self.media_root)
        self.override.enable()
        super().setUp()
        self.client.force_authenticate(self.owner)
        response = self.client.post(reverse('api-asset-files', args=[self.workspace.id]),
                                    {'file': SimpleUploadedFile('frame.png', poster_png([]), content_type='image/png')}, format='multipart')
        self.assertEqual(response.status_code, 201, response.content)
        self.file = File.objects.get(id=response.json()['file']['id'])

    def tearDown(self):
        self.override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)
        super().tearDown()

    def url(self):
        return reverse('api-file-processing', args=[self.workspace.id, self.file.id])

    def test_reports_each_stage(self):
        File.objects.filter(id=self.file.id).update(status=FileStatus.PENDING)
        self.file.refresh_from_db()
        FileSecurityScan.objects.filter(file_id=self.file.id).delete()
        self.assertEqual(processing_state(self.file)['stage'], 'scanning')
        File.objects.filter(id=self.file.id).update(status=FileStatus.READY, mime_type='video/mp4')
        self.file.refresh_from_db()
        OutboxEvent.objects.filter(aggregate_id=str(self.file.id)).delete()
        self.assertEqual(processing_state(self.file)['stage'], 'ready')  # nothing queued
        event = OutboxEvent.objects.create(id=uuid.uuid4(), topic='file.preview.requested', aggregate_type='file', aggregate_id=str(self.file.id),
                                           payload={}, status='PENDING', available_at=timezone.now(), created_at=timezone.now(), updated_at=timezone.now(),
                                           deduplication_key=f'tray-test:{self.file.id}')
        self.assertEqual(processing_state(self.file), {'stage': 'proxy', 'label': 'Making proxy', 'ready': False})
        OutboxEvent.objects.filter(id=event.id).update(status='DEAD_LETTER')
        self.assertEqual(processing_state(self.file)['label'], 'Ready (no preview)')
        File.objects.filter(id=self.file.id).update(status=FileStatus.FAILED)
        self.file.refresh_from_db()
        self.assertEqual(processing_state(self.file)['stage'], 'failed')

    def test_infected_files_fail(self):
        scan = FileSecurityScan.objects.filter(file_id=self.file.id).first()
        if scan is None:
            self.skipTest('scans are not created in this configuration')
        FileSecurityScan.objects.filter(id=scan.id).update(status=FileSecurityScanStatus.INFECTED)
        self.assertEqual(self.client.get(self.url()).json()['stage'], 'failed')

    def test_members_only(self):
        self.assertEqual(self.client.get(self.url()).status_code, 200)
        outsider = get_user_model().objects.create_user(email='o@example.com', password='x-pass-12345', first_name='O', last_name='S')
        self.client.force_authenticate(outsider)
        self.assertEqual(self.client.get(self.url()).status_code, 404)
