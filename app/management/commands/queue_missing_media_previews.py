"""Queue the scan and preview for review media that never got them.

Before image uploads were queued for processing, image versions sat on "Generating
preview…" / Pending forever. Run once after deploying the fix:

    python manage.py queue_missing_media_previews [--dry-run]
"""
from django.core.management.base import BaseCommand

from app.models import FileSecurityScan, MediaVersion, OutboxEvent
from app.services.file_processing import PREVIEW_TOPIC
from app.services.media import queue_media_processing


class Command(BaseCommand):
    help = 'Queue security scans and previews for media versions that have neither.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, dry_run=False, **options):
        queued_previews = set(
            OutboxEvent.objects.filter(topic=PREVIEW_TOPIC).values_list('aggregate_id', flat=True)
        )
        scanned = set(FileSecurityScan.objects.values_list('file_id', flat=True))
        count = 0
        versions = MediaVersion.objects.filter(
            original_file__deleted_at__isnull=True,
        ).select_related('original_file')
        for version in versions.iterator():
            file_record = version.original_file
            if str(file_record.id) in queued_previews or file_record.id in scanned:
                continue
            count += 1
            self.stdout.write(f'{file_record.id} {file_record.original_name}')
            if not dry_run:
                queue_media_processing(file_record)
        verb = 'Would queue' if dry_run else 'Queued'
        self.stdout.write(self.style.SUCCESS(f'{verb} processing for {count} media file(s).'))
