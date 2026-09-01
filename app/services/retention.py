from datetime import timedelta

from django.conf import settings
from django.core.files.storage import default_storage
from django.db import transaction
from django.utils import timezone

from app.models import File, FileVariant, ReviewCommentContent


def purge_deleted_review_files(*, older_than_days=None, limit=100, dry_run=False):
    days = settings.REVIEW_FILE_RETENTION_DAYS if older_than_days is None else older_than_days
    if days < 1:
        raise ValueError('older_than_days must be at least 1.')
    if limit < 1:
        raise ValueError('limit must be at least 1.')
    cutoff = timezone.now() - timedelta(days=days)
    attachment_file_ids = ReviewCommentContent.objects.filter(
        file__isnull=False, deleted_at__isnull=False,
    ).values_list('file_id', flat=True)
    active_file_ids = ReviewCommentContent.objects.filter(
        file__isnull=False, deleted_at__isnull=True,
    ).values_list('file_id', flat=True)
    candidates = File.objects.filter(
        id__in=attachment_file_ids, deleted_at__isnull=False, deleted_at__lte=cutoff,
    ).exclude(
        id__in=active_file_ids,
    ).exclude(
        metadata__has_key='physical_deleted_at',
    ).order_by('deleted_at')[:limit]
    result = {'examined': 0, 'purged': 0, 'failed': 0, 'dry_run': dry_run, 'file_ids': []}
    for file in candidates:
        result['examined'] += 1
        result['file_ids'].append(str(file.id))
        if dry_run:
            continue
        variants = list(FileVariant.objects.filter(file=file))
        try:
            for variant in variants:
                default_storage.delete(variant.object_key)
            default_storage.delete(file.object_key)
        except Exception:
            result['failed'] += 1
            continue
        purged_at = timezone.now()
        with transaction.atomic():
            locked = File.objects.select_for_update().get(id=file.id)
            metadata = dict(locked.metadata or {})
            metadata['physical_deleted_at'] = purged_at.isoformat()
            locked.metadata = metadata
            locked.updated_at = purged_at
            locked.save(update_fields=['metadata', 'updated_at'])
            for variant in variants:
                variant_metadata = dict(variant.metadata or {})
                variant_metadata['physical_deleted_at'] = purged_at.isoformat()
                FileVariant.objects.filter(id=variant.id).update(
                    metadata=variant_metadata, updated_at=purged_at,
                )
        result['purged'] += 1
    return result
