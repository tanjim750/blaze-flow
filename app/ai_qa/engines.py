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

    def read(self, image_path, *, width, height, source_path=None):  # pragma: no cover - interface
        raise NotImplementedError


class FakeOcrEngine(OcrEngine):
    """Deterministic engine for tests and CI: no model download, no native deps.

    It reads a `blazeflow-ocr` PNG text chunk (JSON list of {text, confidence, box}) when one
    is present, so fixtures can say exactly what "the OCR" saw; otherwise it sees nothing.
    """

    name = 'fake'
    version = '1'

    def read(self, image_path, *, width, height, source_path=None):
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
        )

    def read(self, image_path, *, width, height, source_path=None):  # pragma: no cover - needs the model
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


ENGINES = {
    'fake': 'app.ai_qa.engines.FakeOcrEngine',
    'paddleocr': 'app.ai_qa.engines.PaddleOcrEngine',
}


def get_engine(name=None):
    name = name or settings.AI_QA_ENGINE
    if name not in ENGINES:
        raise RuntimeError(f'Unknown AI QA engine {name!r}.')
    return import_string(ENGINES[name])()
