import time

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import close_old_connections

from app.services import process_outbox_events


class Command(BaseCommand):
    help = 'Run AI Visual QA jobs from the outbox, one at a time, apart from the general worker.'

    def add_arguments(self, parser):
        parser.add_argument('--interval-seconds', type=float, default=2.0)
        parser.add_argument('--once', action='store_true')
        parser.add_argument('--no-warm', action='store_true', help='Skip loading the OCR model at start-up.')

    def handle(self, *args, **options):
        if not options['no_warm'] and settings.AI_QA_ENGINE == 'paddleocr':
            from app.ai_qa.engines import PaddleOcrEngine
            self.stdout.write('Loading PaddleOCR models…')
            PaddleOcrEngine._model()
        while True:
            if not options['once']:
                close_old_connections()
            # A run can take minutes, so reclaim only well past the longest expected run.
            result = process_outbox_events(limit=1, topic_prefix='ai_visual_qa.', reclaim_after_seconds=1800)
            if any(result.values()):
                self.stdout.write(str(result))
            if options['once']:
                return
            time.sleep(options['interval_seconds'])
