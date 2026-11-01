import time

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import close_old_connections

from app.services import process_outbox_events
from app.services.file_processing import HQ_PREVIEW_TOPIC


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
            if not options['once']:
                close_old_connections()
            # AI Visual QA runs belong to `run_ai_qa_worker` (see AI_QA_DEDICATED_WORKER).
            exclude = ('ai_visual_qa.',) if settings.AI_QA_DEDICATED_WORKER else ()
            result = process_outbox_events(
                limit=options['batch_size'], exclude_topic_prefix=(*exclude, HQ_PREVIEW_TOPIC),
            )
            if not result['claimed']:
                # Optional HQ proxies are low priority: one at a time, only when nothing else
                # is waiting, so review proxies and emails never queue behind a 1080p encode.
                result = process_outbox_events(limit=1, topic_prefix=HQ_PREVIEW_TOPIC)
            if any(result.values()):
                self.stdout.write(str(result))
            if options['once']:
                return
            time.sleep(options['interval_seconds'])
