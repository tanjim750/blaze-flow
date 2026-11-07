"""Re-render the review proxy for videos whose last encode left a review-card fallback.

Before fix/video-proxy-long-videos, a proxy encode that failed (most often the fixed
10-minute timeout on a long cut) stored an SVG "review card" as the video's preview and
marked the job done, so the cut could never play and nothing retried it. Run once after
deploying the fix:

    python manage.py rerender_fallback_video_previews --dry-run
    python manage.py rerender_fallback_video_previews [--file-id <uuid> ...]

Safe by construction: it only soft-deletes the bad card variant (the row and the stored
object stay) and adds a new preview job row. It never edits or deletes an existing job,
file or variant otherwise. Files that already have a proxy, or a job still in flight, are
left alone.
"""
import uuid

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from app.models import File, FileStatus, FileVariant, OutboxEvent, OutboxEventStatus
from app.services.file_processing import PREVIEW_TOPIC, VIDEO_PROXY_VARIANT_TYPE, video_fallback_cards

IN_FLIGHT = (OutboxEventStatus.PENDING, OutboxEventStatus.PROCESSING, OutboxEventStatus.FAILED)


class Command(BaseCommand):
    help = 'Soft-delete fallback review cards on videos and queue a fresh proxy render for each.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help='List what would be re-rendered; change nothing.')
        parser.add_argument('--file-id', action='append', dest='file_ids', help='Limit to this file (repeatable).')

    def handle(self, *args, dry_run=False, file_ids=None, **options):
        cards = video_fallback_cards(file_ids)
        affected = sorted({str(file_id) for file_id in cards.values_list('file_id', flat=True)})
        queued = skipped = 0
        for file_id in affected:
            file = File.objects.filter(id=file_id, deleted_at__isnull=True, status=FileStatus.READY).first()
            if file is None:
                skipped += 1
                self.stdout.write(f'skip {file_id}: file is deleted or not ready')
                continue
            has_proxy = FileVariant.objects.filter(
                file=file, status=FileStatus.READY, deleted_at__isnull=True,
                metadata__variant_type=VIDEO_PROXY_VARIANT_TYPE,
            ).exists()
            in_flight = OutboxEvent.objects.filter(
                topic=PREVIEW_TOPIC, aggregate_id=str(file.id), status__in=IN_FLIGHT,
            ).exists()
            label = f'{file.id} {file.original_name!r} ({file.size_bytes} bytes)'
            if in_flight:
                skipped += 1
                self.stdout.write(f'skip {label}: a preview job is already queued or running')
                continue
            if dry_run:
                queued += 1
                self.stdout.write(f'would re-render {label}' + (' (has a proxy; card only retired)' if has_proxy else ''))
                continue
            now = timezone.now()
            with transaction.atomic():
                retired = video_fallback_cards([file.id]).update(deleted_at=now, updated_at=now)
                if not has_proxy:
                    OutboxEvent.objects.create(
                        id=uuid.uuid4(), topic=PREVIEW_TOPIC, aggregate_type='file',
                        aggregate_id=str(file.id), payload={'file_id': str(file.id), 'rerender': True},
                        status=OutboxEventStatus.PENDING, available_at=now,
                        deduplication_key=f'{PREVIEW_TOPIC}:{file.id}:rerender:{uuid.uuid4()}',
                        created_at=now, updated_at=now,
                    )
            queued += 1
            self.stdout.write(
                f're-render {label}: retired {retired} card(s)' + ('' if has_proxy else ', queued a proxy render')
            )
        verb = 'Would re-render' if dry_run else 'Re-rendered'
        self.stdout.write(self.style.SUCCESS(f'{verb} {queued} video(s); skipped {skipped}.'))
