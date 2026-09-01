import hashlib
import html
import uuid
from pathlib import Path

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.db import transaction
from django.utils import timezone
from django.utils.module_loading import import_string

from app.models import (
    File,
    FileSecurityScan,
    FileSecurityScanStatus,
    FileStatus,
    FileVariant,
    OutboxEvent,
    OutboxEventStatus,
)


SCAN_TOPIC = 'file.security-scan.requested'
PREVIEW_TOPIC = 'file.preview.requested'


class EicarAwareScanner:
    """Development-safe scanner contract; replace this backend in production."""

    name = 'builtin-eicar-aware'

    def scan(self, stream):
        marker = b'EICAR-STANDARD-ANTIVIRUS-TEST-FILE'
        tail = b''
        while True:
            chunk = stream.read(64 * 1024)
            if not chunk:
                break
            sample = tail + chunk
            if marker in sample:
                return {'clean': False, 'threat': 'EICAR-Test-File'}
            tail = sample[-len(marker):]
        return {'clean': True}


def scanner_backend():
    scanner_class = import_string(settings.FILE_SECURITY_SCANNER)
    return scanner_class()


def enqueue_file_event(*, file, topic):
    now = timezone.now()
    return OutboxEvent.objects.get_or_create(
        deduplication_key=f'{topic}:{file.id}',
        defaults={
            'id': uuid.uuid4(), 'topic': topic, 'aggregate_type': 'file',
            'aggregate_id': str(file.id), 'payload': {'file_id': str(file.id)},
            'status': OutboxEventStatus.PENDING, 'available_at': now,
            'created_at': now, 'updated_at': now,
        },
    )[0]


def process_security_scan(*, file_id):
    file = File.objects.get(id=file_id, deleted_at__isnull=True)
    scan = FileSecurityScan.objects.get(file=file)
    if scan.status in {FileSecurityScanStatus.CLEAN, FileSecurityScanStatus.INFECTED}:
        return scan
    scanner = scanner_backend()
    try:
        with default_storage.open(file.object_key, 'rb') as stream:
            result = scanner.scan(stream)
    except Exception as exc:
        failed_at = timezone.now()
        FileSecurityScan.objects.filter(file=file).update(
            engine=scanner.name, status=FileSecurityScanStatus.FAILED,
            result={'error': str(exc)[:1000]}, scanned_at=failed_at,
            updated_at=failed_at,
        )
        raise
    with transaction.atomic():
        file = File.objects.select_for_update().get(id=file_id, deleted_at__isnull=True)
        scan = FileSecurityScan.objects.select_for_update().get(file=file)
        if scan.status in {FileSecurityScanStatus.CLEAN, FileSecurityScanStatus.INFECTED}:
            return scan
        scan.result = result
        if result.get('clean'):
            scan.status = FileSecurityScanStatus.CLEAN
            file.status = FileStatus.READY
            enqueue_file_event(file=file, topic=PREVIEW_TOPIC)
        else:
            scan.status = FileSecurityScanStatus.INFECTED
            file.status = FileStatus.FAILED
        scan.engine = scanner.name
        scan.scanned_at = timezone.now()
        scan.save(update_fields=['engine', 'status', 'result', 'scanned_at', 'updated_at'])
        file.updated_at = timezone.now()
        file.save(update_fields=['status', 'updated_at'])
    return scan


@transaction.atomic
def generate_preview(*, file_id):
    file = File.objects.select_for_update().get(
        id=file_id, status=FileStatus.READY, deleted_at__isnull=True,
    )
    existing = FileVariant.objects.filter(
        file=file, metadata__variant_type='REVIEW_CARD', deleted_at__isnull=True,
    ).first()
    if existing:
        return existing
    safe_name = html.escape(file.original_name)
    safe_type = html.escape(file.mime_type)
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">'
        '<rect width="100%" height="100%" fill="#111827"/>'
        '<text x="40" y="155" fill="#f9fafb" font-size="28" font-family="sans-serif">'
        f'{safe_name}</text><text x="40" y="205" fill="#9ca3af" font-size="18" '
        f'font-family="sans-serif">{safe_type} · {file.size_bytes} bytes</text></svg>'
    ).encode()
    digest = hashlib.sha256(svg).hexdigest()
    object_key = f'{Path(file.object_key).parent}/previews/{file.id}.svg'
    stored_key = default_storage.save(object_key, ContentFile(svg))
    now = timezone.now()
    try:
        return FileVariant.objects.create(
            id=uuid.uuid4(), file=file, storage_backend=file.storage_backend,
            object_key=stored_key, original_name=f'{file.original_name}.preview.svg',
            mime_type='image/svg+xml', size_bytes=len(svg), checksum=digest,
            checksum_algorithm='sha256', metadata={'variant_type': 'REVIEW_CARD'},
            status=FileStatus.READY, created_at=now, updated_at=now,
        )
    except Exception:
        default_storage.delete(stored_key)
        raise


def handle_security_scan_event(event):
    return process_security_scan(file_id=event.payload['file_id'])


def handle_preview_event(event):
    return generate_preview(file_id=event.payload['file_id'])
