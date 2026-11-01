"""What a cut's review preview is doing right now, in one place.

The review page, the guest page, the preview route and the upload tray all ask the same
question ("can this be played, and if not, why?"), and they used to answer it differently:
a video whose proxy encode failed kept a review-card SVG that every reader counted as a
ready preview, so the player was handed an image and said "may still be generating".

For a video only a real `VIDEO_PROXY` counts. Anything else uses the general preview types.
"""
from app.models import FileStatus, FileVariant, OutboxEvent
from app.services.file_processing import (
    FALLBACK_CARD_VARIANT_TYPE, PREVIEW_TOPIC, PREVIEW_VARIANT_TYPES, VIDEO_PROXY_VARIANT_TYPE,
)

READY = 'READY'
PENDING = 'PENDING'
PROCESSING = 'PROCESSING'
RETRYING = 'RETRYING'
FAILED = 'FAILED'
CANCELLED = 'CANCELLED'


def is_video(file):
    return (getattr(file, 'mime_type', '') or '').startswith('video/')


def playable_types(file):
    """The variant types that make `file` playable / viewable in the review player."""
    return (VIDEO_PROXY_VARIANT_TYPE,) if is_video(file) else PREVIEW_VARIANT_TYPES


def playable_variant(file):
    """The newest ready variant the player can use for `file`, or None."""
    return FileVariant.objects.filter(
        file=file, status=FileStatus.READY, deleted_at__isnull=True,
        metadata__variant_type__in=playable_types(file),
    ).order_by('-created_at').first()


def latest_preview_event(file_id):
    return OutboxEvent.objects.filter(
        topic=PREVIEW_TOPIC, aggregate_id=str(file_id),
    ).order_by('-created_at').first()


def preview_status(file, variants, event):
    """READY, PENDING, PROCESSING, RETRYING, FAILED or CANCELLED.

    `variants` is an iterable of `(variant_type, status)` for the file's live variants;
    `event` its newest preview job (or None).
    """
    wanted = playable_types(file)
    variants = list(variants)
    statuses = [status for variant_type, status in variants if variant_type in wanted]
    if any(status == FileStatus.READY for status in statuses):
        return READY
    if not is_video(file):
        # Unchanged for images, audio and PDFs: the variant's own status, then the job's.
        if statuses:
            return statuses[0]
        if event is None:
            return PENDING
        if (event.payload or {}).get('cancelled'):
            return CANCELLED
        return {'DEAD_LETTER': FAILED, 'FAILED': FAILED, 'PROCESSING': PROCESSING}.get(event.status, PENDING)
    if event is not None:
        if (event.payload or {}).get('cancelled'):
            return CANCELLED
        if event.status == 'PROCESSING':
            return PROCESSING
        if event.status == 'PENDING':
            return PENDING
        if event.status == 'FAILED':
            return RETRYING  # failed once, another attempt is scheduled
        # DEAD_LETTER, or PUBLISHED with no proxy: an older run that stored a fallback card.
        return FAILED
    if statuses and all(status == FileStatus.FAILED for status in statuses):
        return FAILED
    if any(variant_type == FALLBACK_CARD_VARIANT_TYPE for variant_type, _ in variants):
        return FAILED
    return PENDING


def file_preview_status(file):
    variants = FileVariant.objects.filter(file=file, deleted_at__isnull=True).values_list(
        'metadata__variant_type', 'status',
    )
    return preview_status(file, variants, latest_preview_event(file.id))
