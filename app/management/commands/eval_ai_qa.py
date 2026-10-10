import json
import tempfile
import time
from pathlib import Path

from django.core.management.base import BaseCommand

from app.ai_qa.engines import get_engine
from app.ai_qa.eval_set import CASES, GLOSSARY, render
from app.ai_qa.spelling import check_line, normalize


class Command(BaseCommand):
    help = 'Score AI Visual QA on the synthetic poster set against the v1 ship gate.'

    def add_arguments(self, parser):
        parser.add_argument('--engine', default='paddleocr')
        parser.add_argument('--out', default='', help='Write the JSON report (and posters) to this folder.')

    def handle(self, *args, **options):
        engine = get_engine(options['engine'])
        out = Path(options['out']) if options['out'] else Path(tempfile.mkdtemp(prefix='aiqa-eval-'))
        out.mkdir(parents=True, exist_ok=True)
        rows, started = [], time.monotonic()
        for case in CASES:
            case_id, lines, typos = case
            path = render(case, out / f'{case_id}.png')
            from PIL import Image
            with Image.open(path) as image:
                width, height = image.size
            t0 = time.monotonic()
            ocr = engine.read(path, width=width, height=height, source_path=path)
            findings = [c for line in ocr for c in check_line(line, glossary=GLOSSARY)]
            truth = {normalize(t) for t in typos}
            scored = []
            for f in findings:
                hit = normalize(f.detected_text) in truth
                scored.append({'text': f.detected_text, 'suggestion': f.suggested_text, 'category': f.category,
                               'band': f.band, 'ocr': f.ocr_confidence, 'correct': hit})
            found = {normalize(s['text']) for s in scored if s['correct']}
            rows.append({
                'case': case_id, 'clean': not typos, 'typos': typos, 'ocr_lines': [l.text for l in ocr],
                'findings': scored, 'missed': sorted(truth - found), 'ms': int((time.monotonic() - t0) * 1000),
            })
            self.stdout.write(f"{case_id:22} {'clean' if not typos else 'typo '} found={[(s['text'], s['band'], 'TP' if s['correct'] else 'FP') for s in scored]} missed={sorted(truth - found)}")

        def all_findings(band=None):
            return [s for r in rows for s in r['findings'] if band is None or s['band'] == band]
        high = all_findings('high')
        high_precision = sum(s['correct'] for s in high) / len(high) if high else None
        flagged = [s for s in all_findings() if s['band'] in ('high', 'medium')]
        precision_hm = sum(s['correct'] for s in flagged) / len(flagged) if flagged else None
        clean = [r for r in rows if r['clean']]
        fp_clean = [len(r['findings']) for r in clean]
        fp_clean_hm = [sum(s['band'] in ('high', 'medium') for s in r['findings']) for r in clean]
        total_typos = sum(len(r['typos']) for r in rows)
        recall = sum(len(r['typos']) - len(r['missed']) for r in rows) / total_typos
        recall_high = sum(1 for s in high if s['correct']) / total_typos
        summary = {
            'engine': engine.name, 'engine_version': str(engine.version), 'cases': len(rows),
            'clean_cases': len(clean), 'seeded_typos': total_typos,
            'high_precision': high_precision, 'high_count': len(high),
            'precision_high_medium': precision_hm,
            'recall_any_band': round(recall, 3), 'recall_high': round(recall_high, 3),
            'max_fp_per_clean_poster_all_bands': max(fp_clean), 'mean_fp_per_clean_poster_all_bands': round(sum(fp_clean) / len(clean), 2),
            'max_fp_per_clean_poster_high_medium': max(fp_clean_hm),
            'mean_ms_per_poster': int(sum(r['ms'] for r in rows) / len(rows)),
            'total_seconds': round(time.monotonic() - started, 1),
        }
        summary['gate_high_precision_ge_0_8'] = high_precision is not None and high_precision >= 0.8
        summary['gate_le_1_fp_per_clean_poster'] = summary['max_fp_per_clean_poster_all_bands'] <= 1
        (out / 'report.json').write_text(json.dumps({'summary': summary, 'cases': rows}, indent=2))
        self.stdout.write(json.dumps(summary, indent=2))
        self.stdout.write(f'Report: {out / "report.json"}')
