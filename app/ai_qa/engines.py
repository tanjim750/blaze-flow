"""OCR engines behind one small interface, so the provider can be swapped per workspace.

Every engine returns text *lines* with a confidence in 0-1 and a polygon normalised to the
image it was given (0-1, displayed orientation). Word boxes are derived later.
"""
import json
from dataclasses import dataclass, field
from functools import lru_cache

from django.conf import settings
from django.utils.module_loading import import_string


@dataclass
class OcrLine:
    text: str
    confidence: float
    polygon: list = field(default_factory=list)  # [[x, y], ...] normalised 0-1


class OcrEngine:
    name = 'base'
    version = ''

    def read(self, image_path, *, width, height, source_path=None, time_ms=None, file_metadata=None):  # pragma: no cover - interface
        raise NotImplementedError

    def frame_reader(self):
        return FrameReader(self)


class FakeOcrEngine(OcrEngine):
    def frame_reader(self):
        return FrameReader(self)

    """Deterministic engine for tests and CI: no model download, no native deps.

    It reads a `blazeflow-ocr` PNG text chunk (JSON list of {text, confidence, box}) when one
    is present, so fixtures can say exactly what "the OCR" saw; otherwise it sees nothing.
    """

    name = 'fake'
    version = '1'

    def read(self, image_path, *, width, height, source_path=None, time_ms=None, file_metadata=None):
        # Video frames carry no PNG chunk: tests script the timeline on File.metadata instead.
        if time_ms is not None:
            lines = []
            for item in (file_metadata or {}).get('fake_ocr_timeline', []):
                if item['start_ms'] <= time_ms <= item['end_ms']:
                    x, y, w, h = item['box']
                    dx = item.get('dx_per_s', 0) * (time_ms - item['start_ms']) / 1000
                    lines.append(OcrLine(text=item['text'], confidence=float(item.get('confidence', 0.95)),
                                         polygon=[[x + dx, y], [x + dx + w, y], [x + dx + w, y + h], [x + dx, y + h]]))
            return lines
        from PIL import Image

        # The processed copy is re-encoded and loses PNG text chunks, so read the upload.
        with Image.open(source_path or image_path) as image:
            raw = (getattr(image, 'text', None) or image.info or {}).get('blazeflow-ocr')
        if not raw:
            return []
        lines = []
        for item in json.loads(raw):
            x, y, w, h = item['box']
            lines.append(OcrLine(
                text=str(item['text']), confidence=float(item.get('confidence', 0.95)),
                polygon=[[x, y], [x + w, y], [x + w, y + h], [x, y + h]],
            ))
        return lines


class PaddleOcrEngine(OcrEngine):
    """Self-hosted PaddleOCR 3.x (PP-OCRv6 by default) on CPU. Install with requirements-ai.txt."""

    name = 'paddleocr'

    def __init__(self):
        try:
            import paddleocr  # noqa: F401
        except ImportError as exc:  # pragma: no cover - depends on the optional extra
            raise RuntimeError('PaddleOCR is not installed; pip install -r requirements-ai.txt') from exc
        self.version = getattr(paddleocr, '__version__', '')

    @staticmethod
    @lru_cache(maxsize=1)
    def _model():
        from paddleocr import PaddleOCR

        return PaddleOCR(
            lang='en',
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=True,
            # Paddle 3.3's oneDNN path fails on PP-OCRv6 (ConvertPirAttribute2RuntimeAttribute).
            enable_mkldnn=False,
            cpu_threads=settings.AI_QA_CPU_THREADS,
        )

    def frame_reader(self):
        return PaddleFrameReader(self)

    @staticmethod
    @lru_cache(maxsize=1)
    def _detector():  # pragma: no cover - needs the model
        # Video frames: the light detector is ~5× faster than the medium one at 960 px and the
        # medium recogniser still reads the crops, so accuracy rests on recognition.
        from paddleocr import TextDetection
        return TextDetection(model_name=settings.AI_QA_VIDEO_DET_MODEL, enable_mkldnn=False,
                             limit_side_len=960, limit_type='max', cpu_threads=settings.AI_QA_CPU_THREADS)

    @staticmethod
    @lru_cache(maxsize=1)
    def _recogniser():  # pragma: no cover - needs the model
        from paddleocr import TextRecognition
        return TextRecognition(model_name='PP-OCRv6_medium_rec', enable_mkldnn=False, cpu_threads=settings.AI_QA_CPU_THREADS)

    def read(self, image_path, *, width, height, source_path=None, time_ms=None, file_metadata=None):  # pragma: no cover - needs the model
        lines = []
        for page in self._model().predict(str(image_path)):
            data = page.json.get('res', page.json) if hasattr(page, 'json') else page
            texts = data.get('rec_texts') or []
            scores = data.get('rec_scores') or []
            polys = data.get('rec_polys') or data.get('dt_polys') or []
            for text, score, poly in zip(texts, scores, polys):
                points = [[float(px) / width, float(py) / height] for px, py in list(poly)]
                if text.strip():
                    lines.append(OcrLine(text=text, confidence=float(score), polygon=points))
        return lines


class FrameReader:
    """Reads a sequence of video frames. The default just reads each frame whole."""

    def __init__(self, engine):
        self.engine = engine
        self.stats = {'detections': 0, 'regions': 0, 'regions_recognised': 0, 'regions_reused': 0}

    def read(self, image_path, *, width, height, time_ms, file_metadata=None):
        self.stats['detections'] += 1
        return self.engine.read(image_path, width=width, height=height, time_ms=time_ms, file_metadata=file_metadata)


class PaddleFrameReader(FrameReader):  # pragma: no cover - needs the models
    """Detection on every frame, recognition only for text regions not seen before.

    Detection (a light model) finds the text boxes; each box is cropped and compared with
    the crops recognised in recent frames. A crop that looks the same (same size within
    10 %, ≤ 3 % of a 96×24 greyscale copy changed) reuses that recognition, even if it moved,
    so a static or sliding title is read once, not every frame. New crops are recognised
    together in one batch. A frame with no detected text costs only the detection.
    """

    CACHE = 64

    def __init__(self, engine):
        super().__init__(engine)
        self.cache = []  # [(w, h, fingerprint, text, score)], newest last

    def _lookup(self, w, h, print_):
        from .video import changed_fraction
        for cw, ch, cprint, text, score in reversed(self.cache):
            if abs(cw - w) <= 0.1 * max(cw, w) and abs(ch - h) <= 0.1 * max(ch, h) and changed_fraction(cprint, print_) <= 0.03:
                return text, score
        return None

    def read(self, image_path, *, width, height, time_ms, file_metadata=None):
        import numpy as np
        from PIL import Image

        self.stats['detections'] += 1
        with Image.open(image_path) as image:
            rgb = image.convert('RGB')
        array = np.asarray(rgb)[:, :, ::-1]
        boxes = []
        for page in PaddleOcrEngine._detector().predict(array):
            data = page.json.get('res', page.json)
            for poly in data.get('dt_polys') or []:
                xs = [float(p[0]) for p in poly]
                ys = [float(p[1]) for p in poly]
                x0, y0 = max(0, int(min(xs)) - 2), max(0, int(min(ys)) - 2)
                x1, y1 = min(width, int(max(xs)) + 3), min(height, int(max(ys)) + 3)
                if x1 - x0 >= 4 and y1 - y0 >= 4:
                    boxes.append((x0, y0, x1, y1))
        self.stats['regions'] += len(boxes)
        results, todo = [None] * len(boxes), []
        for index, (x0, y0, x1, y1) in enumerate(boxes):
            crop = rgb.crop((x0, y0, x1, y1))
            print_ = crop.convert('L').resize((96, 24), Image.BILINEAR)
            hit = self._lookup(x1 - x0, y1 - y0, print_)
            if hit:
                results[index] = hit
                self.stats['regions_reused'] += 1
            else:
                todo.append((index, crop, print_))
        if todo:
            crops = [np.asarray(crop)[:, :, ::-1] for _, crop, _ in todo]
            outputs = [page.json.get('res', page.json) for page in PaddleOcrEngine._recogniser().predict(crops, batch_size=8)]
            for (index, crop, print_), out in zip(todo, outputs):
                text, score = out.get('rec_text') or '', float(out.get('rec_score') or 0)
                results[index] = (text, score)
                x0, y0, x1, y1 = boxes[index]
                self.cache.append((x1 - x0, y1 - y0, print_, text, score))
            self.stats['regions_recognised'] += len(todo)
            self.cache = self.cache[-self.CACHE:]
        lines = []
        for (x0, y0, x1, y1), (text, score) in zip(boxes, results):
            if text.strip():
                polygon = [[x0 / width, y0 / height], [x1 / width, y0 / height], [x1 / width, y1 / height], [x0 / width, y1 / height]]
                lines.append(OcrLine(text=text, confidence=score, polygon=polygon))
        return lines


ENGINES = {
    'fake': 'app.ai_qa.engines.FakeOcrEngine',
    'paddleocr': 'app.ai_qa.engines.PaddleOcrEngine',
}


def get_engine(name=None):
    name = name or settings.AI_QA_ENGINE
    if name not in ENGINES:
        raise RuntimeError(f'Unknown AI QA engine {name!r}.')
    return import_string(ENGINES[name])()
