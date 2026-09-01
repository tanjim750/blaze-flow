import time

from django.core.management.base import BaseCommand, CommandError
from django.db import close_old_connections

from app.services import process_outbox_events


class Command(BaseCommand):
    help = 'Run the durable outbox processor continuously under a process supervisor.'

    def add_arguments(self, parser):
        parser.add_argument('--batch-size', type=int, default=100)
        parser.add_argument('--interval-seconds', type=float, default=5.0)
        parser.add_argument('--once', action='store_true')

    def handle(self, *args, **options):
        if options['batch_size'] < 1:
            raise CommandError('--batch-size must be at least 1.')
        if not 0.1 <= options['interval_seconds'] <= 60:
            raise CommandError('--interval-seconds must be between 0.1 and 60.')
        while True:
            close_old_connections()
            result = process_outbox_events(limit=options['batch_size'])
            if any(result.values()):
                self.stdout.write(str(result))
            if options['once']:
                return
            time.sleep(options['interval_seconds'])
