"""Score approved-copy compare on labelled posters and clips: precision/recall per finding type."""
import json
import tempfile
import time
from pathlib import Path

from django.core.management.base import BaseCommand

from app.ai_qa import eval_set, eval_video_set
from app.ai_qa.copy_compare import CATEGORIES, compare, image_units, norm_word, tokens, video_units
from app.ai_qa.engines import get_engine
from app.ai_qa.eval_copy_set import CLIPS, POSTERS
from app.ai_qa.pipeline import analyse_video


def _hit(row, truth):
    kind, key = truth
    text = ' '.join(tokens(row['detected_text'] + ' ' + row['suggested_text']))
    return row['category'] == kind and norm_word(key) in text.split()


class Command(BaseCommand):
    help = 'Score AI Visual QA approved-copy compare (posters + clips) per finding type.'

    def add_arguments(self, parser):
        parser.add_argument('--engine', default='paddleocr')
        parser.add_argument('--out', default='')
        parser.add_argument('--skip-video', action='store_true')

    def handle(self, *args, **options):
        engine = get_engine(options['engine'])
        out = Path(options['out']) if options['out'] else Path(tempfile.mkdtemp(prefix='aiqa-copy-eval-'))
        out.mkdir(parents=True, exist_ok=True)
        cases = []
        from PIL import Image
        for case_id, approved, lines, truth in POSTERS:
            path = eval_set.render((case_id, lines, []), out / f'{case_id}.png')
            with Image.open(path) as image:
                width, height = image.size
            t0 = time.monotonic()
            ocr = engine.read(path, width=width, height=height, source_path=path)
            rows = compare(approved, image_units(ocr))
            cases.append(self.score('poster', case_id, rows, truth, time.monotonic() - t0, [l.text for l in ocr]))
        if not options['skip_video']:
            for case_id, seconds, approved, elements, truth in CLIPS:
                path = eval_video_set.render((case_id, seconds, elements, []), out / f'{case_id}.mp4')
                t0 = time.monotonic()
                with tempfile.TemporaryDirectory() as work:
                    _, observed, _ = analyse_video(path, work, engine=engine, glossary=frozenset())
                rows = compare(approved, video_units(observed))
                cases.append(self.score('clip', case_id, rows, truth, time.monotonic() - t0, []))

        summary = {'engine': engine.name, 'cases': len(cases), 'by_type': {}}
        for kind in CATEGORIES:
            found = [r for c in cases for r in c['rows'] if r['category'] == kind]
            hm = [r for r in found if r['band'] in ('high', 'medium')]
            high = [r for r in found if r['band'] == 'high']
            truths = [t for c in cases for t in c['truth'] if t[0] == kind]
            caught = sum(1 for c in cases for t in c['truth'] if t[0] == kind and t in c['caught'])
            summary['by_type'][kind] = {
                'seeded': len(truths), 'recall': round(caught / len(truths), 3) if truths else None,
                'findings': len(found), 'precision_all': round(sum(r['tp'] for r in found) / len(found), 3) if found else None,
                'precision_high_medium': round(sum(r['tp'] for r in hm) / len(hm), 3) if hm else None,
                'high': len(high), 'precision_high': round(sum(r['tp'] for r in high) / len(high), 3) if high else None,
            }
        high = [r for c in cases for r in c['rows'] if r['band'] == 'high']
        clean = [c for c in cases if not c['truth']]
        total = sum(len(c['truth']) for c in cases)
        summary.update({
            'seeded': total, 'recall_any_band': round(sum(len(c['caught']) for c in cases) / total, 3),
            'precision_high': round(sum(r['tp'] for r in high) / len(high), 3) if high else None,
            'max_fp_per_clean_case': max(len(c['rows']) for c in clean),
            'max_fp_per_clean_case_high_medium': max(sum(r['band'] != 'low' for r in c['rows']) for c in clean),
            'fp_on_seeded_cases': sum(not r['tp'] for c in cases if c['truth'] for r in c['rows']),
            'mean_s_poster': round(sum(c['s'] for c in cases if c['kind'] == 'poster') / max(1, sum(c['kind'] == 'poster' for c in cases)), 2),
        })
        summary['gate_high_precision_ge_0_8'] = summary['precision_high'] is not None and summary['precision_high'] >= 0.8
        summary['gate_le_1_fp_per_clean_case'] = summary['max_fp_per_clean_case'] <= 1
        (out / 'report.json').write_text(json.dumps({'summary': summary, 'cases': cases}, indent=2, default=str))
        self.stdout.write(json.dumps(summary, indent=2))
        self.stdout.write(f'Report: {out / "report.json"}')

    def score(self, kind, case_id, rows, truth, seconds, ocr):
        caught = []
        scored = []
        for row in rows:
            match = next((t for t in truth if _hit(row, t)), None)
            if match and match not in caught:
                caught.append(match)
            scored.append({'category': row['category'], 'band': row['band'], 'detected': row['detected_text'],
                           'suggested': row['suggested_text'], 'start_ms': row['start_time_ms'], 'tp': match is not None})
        self.stdout.write(f"{case_id:26} {[(r['category'][5:], r['band'][0], r['detected'] or r['suggested'], 'TP' if r['tp'] else 'FP') for r in scored]} missed={[t for t in truth if t not in caught]}")
        return {'kind': kind, 'case': case_id, 'truth': truth, 'caught': caught, 'rows': scored, 's': round(seconds, 2), 'ocr': ocr}
