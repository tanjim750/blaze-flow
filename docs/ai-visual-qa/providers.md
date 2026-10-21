# AI Visual QA providers

AI Visual QA reads text through a provider ("engine") behind one interface. Today that is the
local PaddleOCR engine. A hosted model (for example a Google one) can replace it without
changing the API or the UI.

## The interface

`app/ai_qa/engines.py`:

```python
class OcrEngine:
    name = 'base'       # stored on each AIReview as `engine`
    version = ''        # stored as `engine_version`
    label = 'AI provider'  # shown after "Checked V1 ·" in the review panel

    def read(self, image_path, *, width, height, source_path=None, time_ms=None, file_metadata=None) -> list[OcrLine]:
        ...
```

`read` returns text **lines** (`OcrLine(text, confidence 0–1, polygon normalised 0–1 in the
displayed orientation)`). Everything after that is provider-independent: word boxes, spelling,
glossary, approved-copy comparison, bands, dedupe, video tracking and the findings API.
`frame_reader()` is optional; the default reads frames one at a time through `read`.

## Adding a provider

1. Write a class, e.g. `app/ai_qa/providers/google.py: GoogleVisionEngine(OcrEngine)`, that
   calls the model and maps its response to `OcrLine`s. Keep credentials in settings or env,
   never in the class.
2. Register it, either in `ENGINES` / `ENGINE_LABELS` in `engines.py`, or with no code
   change through env:
   `AI_QA_EXTRA_ENGINES='{"google":"app.ai_qa.providers.google.GoogleVisionEngine"}'`
   `AI_QA_EXTRA_ENGINE_LABELS='{"google":"with Google Cloud"}'`
3. Switch with `AI_QA_ENGINE=google` and restart the AI worker. New runs use it. Old runs keep
   their `engine` and label.
4. Check it with the eval sets (`app/ai_qa/eval_set.py`, `eval_video_set.py`) before you switch.

The API exposes `engine` (the id) and `engine_label` (display text). The frontend only
shows `engine_label`, so it needs no change for a new provider.
