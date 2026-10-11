"""What happens to a file after its bytes land: scan, then preview / proxy, then ready.

Used by the global upload tray to show "Scanning…", "Making proxy…", "Ready" without each
upload entry point knowing the pipeline.
"""
from app.models import File, FileSecurityScan, FileSecurityScanStatus, FileStatus, FileVariant, OutboxEvent
from app.services.file_processing import PREVIEW_VARIANT_TYPES

PREVIEWED = ('image/', 'video/', 'audio/', 'application/pdf')


def processing_state(file: File):
    scan = FileSecurityScan.objects.filter(file_id=file.id).values_list('status', flat=True).first()
    if scan == FileSecurityScanStatus.INFECTED:
        return {'stage': 'failed', 'label': 'Failed the security scan', 'ready': False}
    if file.status == FileStatus.FAILED:
        return {'stage': 'failed', 'label': 'Could not be processed', 'ready': False}
    if scan == FileSecurityScanStatus.PENDING or (scan is None and file.status == FileStatus.PENDING):
        return {'stage': 'scanning', 'label': 'Scanning', 'ready': False}
    mime = file.mime_type or ''
    if not mime.startswith(PREVIEWED):
        return {'stage': 'ready', 'label': 'Ready', 'ready': True}
    kind = 'proxy' if mime.startswith('video/') else 'preview'
    label = 'Making proxy' if kind == 'proxy' else 'Making preview'
    variants = list(FileVariant.objects.filter(
        file=file, deleted_at__isnull=True, metadata__variant_type__in=PREVIEW_VARIANT_TYPES,
    ).values_list('status', flat=True))
    if any(status == FileStatus.READY for status in variants):
        return {'stage': 'ready', 'label': 'Ready', 'ready': True}
    if variants and all(status == FileStatus.FAILED for status in variants):
        return {'stage': 'ready', 'label': 'Ready (no preview)', 'ready': True}
    event = OutboxEvent.objects.filter(topic='file.preview.requested', aggregate_id=str(file.id)).order_by('-created_at').first()
    if event is None and not variants:
        # Nothing queued: either previews are off here or this type gets none.
        return {'stage': 'ready', 'label': 'Ready', 'ready': True}
    if event is not None and event.status in ('DEAD_LETTER', 'FAILED'):
        return {'stage': 'ready', 'label': 'Ready (no preview)', 'ready': True}
    return {'stage': kind, 'label': label, 'ready': False}
