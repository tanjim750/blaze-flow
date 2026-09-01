import json

from django.core.management.base import BaseCommand, CommandError

from app.services.retention import purge_deleted_review_files


class Command(BaseCommand):
    help = 'Physically purge soft-deleted review attachments after the retention period.'

    def add_arguments(self, parser):
        parser.add_argument('--older-than-days', type=int)
        parser.add_argument('--limit', type=int, default=100)
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **options):
        try:
            result = purge_deleted_review_files(
                older_than_days=options['older_than_days'], limit=options['limit'],
                dry_run=options['dry_run'],
            )
        except ValueError as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(json.dumps(result, sort_keys=True))
        if result['failed']:
            raise CommandError(f"{result['failed']} file purge(s) failed.")
