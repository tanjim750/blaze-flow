import os
import subprocess
import sys
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
        parser.add_argument('--processes', type=int, default=1,
                            help='Run this many worker processes (different workspaces in parallel); the cores are split between them.')
        parser.add_argument('--no-warm', action='store_true', help='Skip loading the OCR model at start-up.')

    def handle(self, *args, **options):
        if options['processes'] > 1:
            return self._supervise(options)
        if not options['no_warm'] and settings.AI_QA_ENGINE == 'paddleocr':
            from app.ai_qa.engines import PaddleOcrEngine
            self.stdout.write(f'Loading PaddleOCR models ({settings.AI_QA_CPU_THREADS} threads)…')
            PaddleOcrEngine._detector()
            PaddleOcrEngine._recogniser()
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

    def _supervise(self, options):
        """N single workers, each with an equal share of the cores. Jobs are claimed with
        SKIP LOCKED, so two workers never take the same run; the per-workspace limit still
        applies, so parallelism is across workspaces."""
        count = options['processes']
        threads = str(max(1, (os.cpu_count() or count) // count))
        env = {**os.environ, 'AI_QA_CPU_THREADS': os.environ.get('AI_QA_CPU_THREADS', threads)}
        argv = [sys.executable, sys.argv[0], 'run_ai_qa_worker', '--interval-seconds', str(options['interval_seconds'])]
        if options['no_warm']:
            argv.append('--no-warm')
        children = [subprocess.Popen(argv, env=env) for _ in range(count)]
        self.stdout.write(f'Started {count} AI QA workers with {env["AI_QA_CPU_THREADS"]} threads each.')
        try:
            for child in children:
                child.wait()
        except KeyboardInterrupt:
            for child in children:
                child.terminate()
