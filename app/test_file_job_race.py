"""Post-upload jobs must never run before their File is committed, and a job whose File
is missing or deleted must not burn its attempts and dead-letter."""
import threading
import uuid
from datetime import timedelta
from unittest.mock import patch

from django.conf import settings
from django.db import connection, transaction
from django.test import TestCase, TransactionTestCase
from django.utils import timezone

from .models import File, FileSecurityScan, FileStatus, OutboxEvent, OutboxEventStatus
from .services.file_processing import (
    SCAN_TOPIC, FileNotCommittedYet, enqueue_file_event, process_security_scan,
)
from .services.media import _storage_backend
from .services.outbox import process_outbox_events
from .test_access_projects import WorkspaceAccessSetupMixin


def _file(workspace, **extra):
    now = timezone.now()
    return File.objects.create(
        id=uuid.uuid4(), workspace=workspace, storage_backend=_storage_backend(now), object_key=f'k/{uuid.uuid4()}',
        original_name='clip.mp4', mime_type='video/mp4', size_bytes=10, checksum='x' * 64,
        checksum_algorithm='sha256', metadata={}, status=FileStatus.PENDING,
        created_at=now, updated_at=now, **extra,
    )


class UncommittedUploadTests(WorkspaceAccessSetupMixin, TransactionTestCase):
    def _claim_from_other_connection(self):
        result = {}

        def run():
            try:
                result['claimed'] = process_outbox_events(event_dispatcher=lambda event: None)['claimed']
            finally:
                connection.close()

        thread = threading.Thread(target=run)
        thread.start()
        thread.join()
        return result['claimed']

    def test_worker_cannot_claim_the_scan_before_the_file_commits(self):
        with transaction.atomic():
            file = _file(self.workspace)
            FileSecurityScan.objects.create(file=file, engine=settings.FILE_SECURITY_SCANNER)
            enqueue_file_event(file=file, topic=SCAN_TOPIC)
            self.assertEqual(self._claim_from_other_connection(), 0)
        self.assertEqual(self._claim_from_other_connection(), 1)

    def test_rolled_back_upload_queues_nothing(self):
        with self.assertRaises(RuntimeError), transaction.atomic():
            enqueue_file_event(file=_file(self.workspace), topic=SCAN_TOPIC)
            raise RuntimeError('upload failed')
        self.assertFalse(OutboxEvent.objects.filter(topic=SCAN_TOPIC).exists())


class MissingFileRetryTests(WorkspaceAccessSetupMixin, TestCase):
    def _event(self, file_id):
        now = timezone.now()
        return OutboxEvent.objects.create(
            id=uuid.uuid4(), topic=SCAN_TOPIC, aggregate_type='file', aggregate_id=str(file_id),
            deduplication_key=f'{SCAN_TOPIC}:{file_id}', payload={'file_id': str(file_id)},
            available_at=now, created_at=now, updated_at=now,
        )

    def test_missing_file_raises_retryable_error(self):
        with self.assertRaises(FileNotCommittedYet):
            process_security_scan(file_id=uuid.uuid4())

    def test_missing_file_is_retried_on_a_short_backoff(self):
        event = self._event(uuid.uuid4())
        before = timezone.now()
        result = process_outbox_events(retry_base_seconds=60, retry_max_seconds=3600, max_attempts=5)
        event.refresh_from_db()
        self.assertEqual(result['failed'], 1)
        self.assertEqual(event.status, OutboxEventStatus.FAILED)
        self.assertLess(event.available_at, before + timedelta(seconds=30))

    def test_missing_file_still_dead_letters_after_max_attempts(self):
        event = self._event(uuid.uuid4())
        OutboxEvent.objects.filter(id=event.id).update(attempts=4)
        result = process_outbox_events(max_attempts=5)
        event.refresh_from_db()
        self.assertEqual(result['dead_lettered'], 1)
        self.assertEqual(event.status, OutboxEventStatus.DEAD_LETTER)

    def test_scan_for_soft_deleted_file_completes_without_dead_lettering(self):
        file = _file(self.workspace, deleted_at=timezone.now())
        FileSecurityScan.objects.create(file=file, engine=settings.FILE_SECURITY_SCANNER)
        event = self._event(file.id)
        with patch('app.services.file_processing.scanner_backend') as scanner:
            result = process_outbox_events()
        scanner.assert_not_called()
        event.refresh_from_db()
        self.assertEqual(result['published'], 1)
        self.assertEqual(event.status, OutboxEventStatus.PUBLISHED)

    def test_other_errors_keep_the_normal_backoff(self):
        event = self._event(uuid.uuid4())
        before = timezone.now()
        process_outbox_events(event_dispatcher=lambda e: (_ for _ in ()).throw(ValueError('boom')), retry_base_seconds=60)
        event.refresh_from_db()
        self.assertGreaterEqual(event.available_at, before + timedelta(seconds=59))
