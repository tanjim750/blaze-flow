# AI Visual QA: decisions and how v1 (PR 1) works

Status: PR 1, which is image and poster proofreading behind a feature flag. The plan is in `plan.md`. The audit and the research with sources are in `research-and-codebase-audit.md`.

## Decisions (approved)
| # | Decision | Why |
|---|---|---|
| D1 | **Self-hosted PaddleOCR 3.x (PP-OCRv6 medium, CPU) by default**, behind an `OcrEngine` adapter (`app/ai_qa/engines.py`) | Apache-2.0, $0 per run, media never leaves our servers, returns polygons and confidence, actively maintained. Google Cloud Vision becomes an opt-in adapter per workspace later. |
| D2 | **Fake engine in tests and CI** (`AI_QA_ENGINE=fake`) that reads a `blazeflow-ocr` PNG text chunk | CI stays light. Paddle lives in `requirements-ai.txt` only. |
| D3 | **Existing outbox, no Celery/Redis.** Topic `ai_visual_qa.run`, and a dedicated `manage.py run_ai_qa_worker` (batch 1, reclaim after 30 min) | The repo has no Celery. The outbox already gives durable, retried, dead-lettered delivery. The general `run_outbox_worker` skips `ai_visual_qa.*` (`AI_QA_DEDICATED_WORKER=true`), so a slow OCR run never delays e-mail. |
| D4 | **Polling** (2 s for the first 30 s, then 5 s, paused while the tab is hidden) | No Channels in the app |
| D5 | **Limits:** one active check per workspace, 50 runs per workspace per 24 h, 50 MB / 80 MP decode cap, OCR input downscaled to ≤ 8.3 MP | Approved v1 limits. All of them are env settings. The 15 min video cap arrives with video (PR 2). |
| D6 | **AI comments are team-only by default, never auto-posted**, authored by the person who confirms, with `ReviewComment.source='ai_visual_qa'`. The UI shows "AI-suggested · added by X" | Keeps the existing exactly-one-author CHECK and the visibility rules (guests and client teams never see team notes). |
| D7 | **The highlight reuses existing annotation shapes.** The comment gets a `RECTANGLE` `AnnotationElement` (amber, `payload.ai_finding_id`) | The existing overlay renders it, and nothing new is needed for guests or the comments list |
| D8 | **Spelling cascade, no LLM in v1:** glossary → skip URL/e-mail/@handle/#tag/number+unit/`&`/≤4-letter acronyms → Hunspell en_GB ∪ en_US ∪ SymSpell list → OCR-confusable (0/O, 1/l/I, rn/m…) = `OCR_UNCERTAIN` → low OCR confidence = `OCR_UNCERTAIN` → SymSpell suggestion = `POSSIBLE_SPELLING_ERROR` | Deterministic, free and explainable. OCR confidence and decision confidence are stored separately. The UI shows confidence as bands and words, not percentages. |
| D9 | **Glossary:** `GlossaryTerm` at workspace scope (project = null) or project scope. Effective set = workspace ∪ project. "Not an error" adds the word to the project glossary | Client scope comes later, through the project's client |
| D10 | **Re-runs:** `dedupe_key` = sha256(category + normalised word + coarse 1/20 grid cell). Dismissed / not-an-error / commented decisions carry over to the new run, and a commented finding's comment moves to the new finding | Re-running never duplicates comments (tested) |
| D11 | **Permissions:** run, view and act need a **workspace teammate** (`can_see_team_notes`) plus `review.comment.read` / `.create` on the project. Everyone else gets **404**. The feature is off → 404 everywhere and the tab is hidden | Findings are internal material, like team notes |

## Data model (migration `0042_ai_visual_qa`, additive only)
`AIReview`: the run. Status, stage, progress, engine and version, pipeline_version, options plus `options_hash`, error code and message, usage. A partial unique index allows one active run per (version, options, pipeline).
`AIFrameObservation`: raw OCR lines.
`AIFinding`: interpreted results, with a unique (review, dedupe_key).
`GlossaryTerm`.
`ReviewComment.source` (default `human`).

## API (`/api/workspaces/{ws}/projects/{p}/media-versions/{mv}/…`)
| Method | Path | Notes |
|---|---|---|
| GET | `ai-reviews/` | `{supported, can_run, engine, latest}` |
| POST | `ai-reviews/` `{language}` | 202 new, 200 joined existing. 409 `ai_qa_busy`, 429 `ai_qa_quota`, 400 `ai_qa_unsupported_media` |
| GET | `ai-reviews/{id}/` | state plus summary by category, band and status |
| POST | `ai-reviews/{id}/retry/` | failed or partial runs only |
| GET | `ai-reviews/{id}/findings/?category=&band=&status=` | paginated (`limit`/`offset`) |
| PATCH | `ai-findings/{id}/` `{status, edited_suggestion, add_to_glossary}` | |
| POST | `ai-findings/{id}/comment/` `{visibility='team'}` | 201 created / 200 existing (idempotent) |
| GET/POST | `/api/workspaces/{ws}/ai-glossary/[?project=]` | |
| DELETE | `/api/workspaces/{ws}/ai-glossary/{id}/` | disables the term |

## Running it
```
pip install -r requirements-ai.txt                 # Paddle (≈1 GB with models, CPU)
sudo apt-get install hunspell-en-gb hunspell-en-us # dictionaries (SymSpell works without)
AI_VISUAL_QA_ENABLED=true AI_QA_ENGINE=paddleocr python manage.py run_ai_qa_worker
python manage.py eval_ai_qa --out /tmp/aiqa-eval   # synthetic poster benchmark
```
Paddle 3.3 needs `enable_mkldnn=False` with PP-OCRv6 (a oneDNN bug), which is already set. The first run downloads the models to `~/.paddlex`. CPU time is about 3-9 s per 1080×1350 poster.

## Evaluation (v1 ship gate)
The synthetic set is 30 posters (15 clean, 15 with 16 seeded typos). Fonts: sans, script, display, serif, mono, outlined, low contrast and rotated. The clean posters include brand terms, URLs, handles, acronyms and en-GB spellings. The latest numbers are in the PR description.

The gate is **HIGH-band precision ≥ 0.8** and **≤ 1 false positive per clean poster (all bands)**.

Caveat: the set is synthetic and small, and the skip rules were tuned while looking at it, so treat the numbers as a smoke test, not a calibration. Customer-approved real posters must be added before any auto-comment threshold is considered.

## Not in v1 (next PRs)
Video (sampling, tracking, time ranges), approved-copy compare, a cloud engine, an LLM verifier, a glossary management UI (API only for now; "Not an error" adds terms), notifications on completion, and cancelling a run.
