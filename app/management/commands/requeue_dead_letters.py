import uuid

from django.core.management.base import BaseCommand, CommandError

from app.services import requeue_dead_letter_events


class Command(BaseCommand):
    help = 'Requeue terminal outbox events after the delivery problem has been corrected.'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=100)
        parser.add_argument('--event-id', type=uuid.UUID)

    def handle(self, *args, **options):
        limit = options['limit']
        if limit < 1:
            raise CommandError('--limit must be at least 1.')
        updated = requeue_dead_letter_events(
            limit=limit,
            event_id=options['event_id'],
        )
        self.stdout.write(self.style.SUCCESS(f'Requeued {updated} dead-letter event(s).'))
