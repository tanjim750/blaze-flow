import json
import tempfile
import time
from pathlib import Path

from django.core.management.base import BaseCommand

from app.ai_qa.engines import get_engine
from app.ai_qa.eval_set import GLOSSARY
from app.ai_qa.eval_video_set import CASES, render
from app.ai_qa.pipeline import analyse_video
from app.ai_qa.spelling import normalize

SLACK_MS = 600  # a finding counts for a typo when its time range overlaps the truth ± this


class Command(BaseCommand):
    help = 'Score AI Visual QA on the synthetic short-video set (same gates as posters, plus timing).'

    def add_arguments(self, parser):
        parser.add_argument('--engine', default='paddleocr')
        parser.add_argument('--out', default='')
        parser.add_argument('--only', default='', help='Comma-separated case ids.')

    def handle(self, *args, **options):
        engine = get_engine(options['engine'])
        out = Path(options['out']) if options['out'] else Path(tempfile.mkdtemp(prefix='aiqa-veval-'))
        out.mkdir(parents=True, exist_ok=True)
        only = {c for c in options['only'].split(',') if c}
        if hasattr(engine, '_model'):
            engine._detector(); engine._recogniser()  # load the models outside the timings
        rows, started = [], time.monotonic()
        for case in CASES:
            case_id, seconds, _, typos = case
            if only and case_id not in only:
                continue
            path = render(case, out / f'{case_id}.mp4')
            t0 = time.monotonic()
            with tempfile.TemporaryDirectory() as work:
                findings, _, usage = analyse_video(path, work, engine=engine, glossary=GLOSSARY)
            elapsed = time.monotonic() - t0
            scored, hit_typos = [], {}
            for f in findings:
                match = None
                for word, a, b in typos:
                    overlaps = f['start_time_ms'] <= b * 1000 + SLACK_MS and f['end_time_ms'] >= a * 1000 - SLACK_MS
                    if normalize(f['detected_text']) == normalize(word) and overlaps:
                        match = (word, a, b)
                duplicate = bool(match and match[0] in hit_typos)
                if match and not duplicate:
                    hit_typos[match[0]] = abs(f['start_time_ms'] - match[1] * 1000)
                scored.append({'text': f['detected_text'], 'suggestion': f['suggested_text'], 'band': f['band'],
                               'category': f['category'], 'start_ms': f['start_time_ms'], 'end_ms': f['end_time_ms'],
                               'sightings': len(f['track']), 'correct': bool(match), 'duplicate': duplicate})
            missed = [w for w, _, _ in typos if w not in hit_typos]
            rows.append({'case': case_id, 'clean': not typos, 'seconds': seconds, 'findings': scored, 'missed': missed,
                         'start_error_ms': list(hit_typos.values()), 'elapsed_s': round(elapsed, 1), 'usage': usage})
            self.stdout.write(f"{case_id:22} {elapsed:5.1f}s frames={usage['frames_total']} ocr={usage['frames_ocr']} skipped={usage.get('frames_skipped', 0)} rec={usage.get('regions_recognised', '-')}/{usage.get('regions', '-')} "
                              f"found={[(s['text'], s['band'], s['start_ms'], s['end_ms'], 'TP' if s['correct'] else 'FP') for s in scored]} missed={missed}")

        flat = [s for r in rows for s in r['findings']]
        high = [s for s in flat if s['band'] == 'high']
        hm = [s for s in flat if s['band'] in ('high', 'medium')]
        clean = [r for r in rows if r['clean']]
        total = sum(len(c[3]) for c in CASES if not only or c[0] in only)
        found = total - sum(len(r['missed']) for r in rows)
        video_s = sum(r['seconds'] for r in rows)
        proc_s = sum(r['elapsed_s'] for r in rows)
        errors = [e for r in rows for e in r['start_error_ms']]
        summary = {
            'engine': engine.name, 'cases': len(rows), 'clean_cases': len(clean), 'seeded_typos': total,
            'high_precision': sum(s['correct'] for s in high) / len(high) if high else None, 'high_count': len(high),
            'precision_high_medium': sum(s['correct'] for s in hm) / len(hm) if hm else None,
            'recall_any_band': round(found / total, 3) if total else None,
            'recall_high': round(len({(r['case'], s['text']) for r in rows for s in r['findings'] if s['correct'] and s['band'] == 'high'}) / total, 3) if total else None,
            'duplicate_findings': sum(s['duplicate'] for s in flat),
            'max_fp_per_clean_video_all_bands': max((len(r['findings']) for r in clean), default=0),
            'max_fp_per_clean_video_high_medium': max((sum(s['band'] in ('high', 'medium') for s in r['findings']) for r in clean), default=0),
            'median_start_error_ms': sorted(errors)[len(errors) // 2] if errors else None,
            'processing_seconds_per_video_minute': round(proc_s / video_s * 60, 1) if video_s else None,
            'total_seconds': round(time.monotonic() - started, 1),
        }
        summary['gate_high_precision_ge_0_8'] = summary['high_precision'] is not None and summary['high_precision'] >= 0.8
        summary['gate_le_1_fp_per_clean_video'] = summary['max_fp_per_clean_video_all_bands'] <= 1
        (out / 'report.json').write_text(json.dumps({'summary': summary, 'cases': rows}, indent=2))
        self.stdout.write(json.dumps(summary, indent=2))
        self.stdout.write(f'Report: {out / "report.json"}')
