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

## Video (PR2)
**Sampling.** Two ffmpeg decode passes; every timestamp comes from `showinfo`'s `pts_time`, never from an assumed frame rate, so it matches the review player's clock (variable frame rate included). ffmpeg auto-rotates, so boxes are in display orientation.
1. Baseline: a frame every 0.5 s (`gte(t-prev_selected_t,0.5)`) plus scene changes (`gt(scene,0.3)`), scaled to at most 960 px wide (1280 px read the same eval set at ~1.8× the CPU time with no recall gain).
2. Densify: between neighbouring baseline samples whose recognised text differs (a title arriving, moving, fading, changing), re-sample every 0.125 s. That pins start/end times and catches text that was only half-visible at a baseline sample. Best effort: if this pass fails the baseline result still stands.
- Caps: 15 min (`AI_QA_MAX_VIDEO_SECONDS`, checked at Run time from the stored duration and again by ffprobe in the worker, with a clear message), 2,400 frames (`AI_QA_MAX_FRAMES`).

**Near-duplicate skip.** A frame where ≤ 0.2 % of a 160×90 greyscale copy changed by more than 24 levels reuses the previous frame's OCR. A whole-frame perceptual hash (dHash) was tried first and rejected: on a static shot a subtitle appearing barely changes it, and the eval missed both subtitle typos. Local pixel change catches them while compression noise stays below the threshold.

**Tracking.** Spelling candidates from every frame are merged into tracks: same category, same word (fuzzy ratio ≥ 85 to absorb OCR noise), within 1.2 s of the track's last sighting, and in the same place (IoU > 0.3, or centre drift < 0.15 × width / 0.1 × height for moving titles). One track becomes one finding with `start_time_ms`/`end_time_ms` and a `track` of `{t, x, y, width, height}` points so the highlight can follow a moving word.
- **Majority rule:** if a word was read wrongly in fewer than half the frames its line was on screen (and at least 3), it is downgraded to *OCR unsure* (low): a real typo is wrong in every frame; an OCR slip is not.
- A single-sighting HIGH finding is shown as MEDIUM: one frame is weaker evidence than a sustained one.
- Dedupe key for re-runs is the poster key plus a 2 s time bucket, so decisions and comments carry over between runs.

**Review page.** Clicking a finding seeks the player to its start. The highlight uses the same display-window rule as a held drawing (`lib/annotation-window`), held at least 1.5 s so a brief sighting can still be seen, and follows the track. AI findings show as purple bars on the timeline above note markers (only while the AI QA tab is open, to keep the timeline quiet otherwise); clicking one seeks and selects it. "Add comment" creates a team-only comment with the finding's time range and a rectangle annotation over the same window.

**Header button, cancel, notifications.** "Run AI Visual QA" sits in the review header tools (icon only under 1240 px), opening the AI QA tab and its run dialog. A queued or running check can be cancelled (`POST …/ai-reviews/{id}/cancel/`); the worker checks between frames and drops partial findings. On finish or failure the person who started it gets an in-app `AI_QA_COMPLETED` notification (switchable in Settings like other kinds) linking to `/review?media=…&panel=ai`.

**Eval.** `python manage.py eval_ai_qa_video --out /tmp/aiqa-veval` renders 10 synthetic clips (slide, fade, zoom titles, burned-in subtitles, a 1 s flash; 4 clean, 6 with 7 seeded typos) and reports precision, recall, false positives per clean clip, start-time error and processing seconds per minute of video. A finding counts when the word matches and its range overlaps the truth ± 0.6 s.

**Cost.** CPU-bound: Paddle reads each non-duplicate frame (~2.5 s at 960 px on 8 CPU cores). Static shots are cheap (dedupe); constant motion (a sliding title) defeats dedupe. See the PR for measured seconds per minute of video. A 15-minute video with constant motion can take over an hour on one worker; that is why the cap and the one-run-per-workspace limit exist.

## Not yet (next PRs)
Approved-copy compare, a cloud engine (Google Video Intelligence has native text tracking), an LLM verifier, a glossary management UI, GPU/parallel frame OCR, and partial results while a long video is still running.
