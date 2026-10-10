from django.core.management.base import BaseCommand, CommandError

from app.services import process_outbox_events


class Command(BaseCommand):
    help = 'Publish pending durable outbox events to the in-process event dispatcher.'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=100)
        parser.add_argument('--reclaim-after-seconds', type=int, default=300)

    def handle(self, *args, **options):
        limit = options['limit']
        if limit < 1:
            raise CommandError('--limit must be at least 1.')
        reclaim_after_seconds = options['reclaim_after_seconds']
        if reclaim_after_seconds < 1:
            raise CommandError('--reclaim-after-seconds must be at least 1.')
        result = process_outbox_events(
            limit=limit,
            reclaim_after_seconds=reclaim_after_seconds,
        )
        self.stdout.write(
            self.style.SUCCESS(
                'Claimed {claimed}; published {published}; failed {failed}; '
                'dead-lettered {dead_lettered}.'.format(**result)
            )
        )
