# AI Visual QA: plan (Blaze Flow)

See `research-and-codebase-audit.md` for the audit, the source matrix and citations. Wireframes are in `wireframes.md`.

## Recommendation
- **Default engine: self-hosted PaddleOCR 3.x (PP-OCRv5/v6, ONNX/CPU) running per frame, behind an `OcrEngine` adapter.** It's Apache-2.0, has $0 marginal cost, keeps customer media in-house (privacy story, no DPA needed), returns polygons and confidence, is good on scene/rotated text, and is actively released.
- **Fallback / "High accuracy" option: Google Cloud Vision TEXT_DETECTION** for images and sampled frames ($1.50/1k), behind the same adapter, off by default and enabled per workspace. Google Video Intelligence ($0.15/min, native text tracks) goes in v2 as a "managed video" engine for long videos.
- **Spelling cascade:** glossary/allow-list → regex skip (URLs, @handles, #tags, numbers, ALLCAPS ≤ 4 chars) → SymSpell + Hunspell en_GB/en_US → OCR-confusion check (I/l/1, O/0, rn/m: confusables give `OCR_UNCERTAIN`, not spelling) → **optional LLM verifier (v2)** only on uncertain crops.
- **Jobs: the existing outbox worker**, not Celery (there is no Celery/Redis in the repo). It already does idempotent, retried, dead-lettered processing. Run it as a separate `ai_qa` worker process so a long OCR job never blocks notifications.
- **Polling**, not WebSockets.

## Architecture
```
POST run ──► AIReview(QUEUED) + OutboxEvent(topic=ai_visual_qa.run, dedup=review_id)   [one transaction]
worker:  validate (scan clean, mime, size/duration caps) ─► fetch via _copy_private_object (bounded)
  image: EXIF-orient → variants (orig, 2x upscale if <1000px, contrast) → OCR
  video: ffprobe (time_base, rotation, VFR) → sample (fps=2 ∪ scene>0.3, exact PTS) → dHash dedupe
         → OCR → densify ±1 s @10 fps around text → track/merge
  → AIFrameObservation rows (raw) → normalise → glossary → spell / copy-diff → AIFinding rows (dedupe_key)
  → status SUCCEEDED/PARTIAL, stage counters, Notification(ai_qa_completed)
```
Stages are persisted as `stage` + `progress{frames_total, frames_done}`, which gives real progress, not a fake %. Each stage is checkpointed so a retry resumes. Caps (settings): `AI_QA_MAX_VIDEO_SECONDS=900` (v1), `AI_QA_MAX_FRAMES=2000`, `AI_QA_MAX_PIXELS=8.3M` (OCR downscale with coordinates kept normalised to the displayed orientation), per-workspace concurrency 1, daily run quota, 20 min timeout, 3 attempts.

## Data model (additive migrations 0037-0040)
- `AIReview`: id, workspace FK, media_version FK, file checksum, requested_by FK, review_type, mode(PROOFREAD|COMPARE|BOTH), language, coverage(standard|thorough), status(QUEUED|PROCESSING|SUCCEEDED|PARTIAL|FAILED|CANCELLED), stage, progress JSON, engine, engine_version, pipeline_version, options JSON, approved_copy FK null, error_code, error_message, cost_estimate_usd, usage JSON, timestamps. **Unique partial index** on (media_version, mode, options_hash, pipeline_version) where status is active, so a double-click returns the same run.
- `AIFrameObservation`: review FK, time_ms null, frame_index, frame_hash, text, confidence, polygon JSON (0-1), engine, track_id. Retention: purge after 30 days (hook into `services/retention.py`).
- `AIFinding`: workspace, review, media_version, category(POSSIBLE_SPELLING_ERROR|COPY_MISMATCH|POSSIBLY_MISSING_TEXT|UNEXPECTED_TEXT|OCR_UNCERTAIN), severity, detected_text, suggested_text, context_text, explanation, ocr_confidence, decision_confidence, band(high|medium|low), region JSON, start_time_ms, end_time_ms, observation_ids JSON, status(PENDING|ACCEPTED|DISMISSED|NOT_AN_ERROR|COMMENT_CREATED), edited_suggestion, reviewed_by, reviewed_at, comment FK unique null, dedupe_key (unique per media_version: hash of category + normalised text + coarse region + time bucket), so reruns update instead of duplicating.
- `GlossaryTerm`: workspace FK, project FK null (v1: workspace + project. Client scope comes in v2 through the project's client), term, normalized, kind(brand|product|name|acronym|stylisation), enabled. Effective set = workspace ∪ project. A project `disabled` entry overrides.
- `ApprovedCopy`: workspace, project, media_version null, text, source(paste|file), created_by. It's immutable, so an edit creates a new row.
- `ReviewComment`: add `source` (`human` default | `ai_visual_qa`) and `ai_finding` OneToOne null. **Keeps the exactly-one-author CHECK.** The author is the user who confirmed it, and the UI shows "AI-suggested · added by Shamim".

## API (existing nesting `workspaces/{ws}/projects/{p}/media-versions/{mv}/`)
- `POST ai-reviews/` {mode, language, coverage, approved_copy_text?} → 202 + review (idempotent)
- `GET ai-reviews/` (latest per version), `GET ai-reviews/{id}/`, `POST ai-reviews/{id}/retry/`, `POST ai-reviews/{id}/cancel/`
- `GET ai-reviews/{id}/findings/?category=&status=&band=` (paginated)
- `PATCH ai-findings/{id}/` {status, edited_suggestion}
- `POST ai-findings/{id}/comment/` {visibility=TEAM default} creates or returns the linked comment + rect AnnotationElement inside one `select_for_update` transaction
- `POST ai-findings/batch-comment/` {ids[], visibility} with preview in the UI
- `GET/POST/DELETE workspaces/{ws}/glossary/` (+ `?project=`) and "Add to glossary" on a finding (sets NOT_AN_ERROR + creates the term)
- Permission `ai_qa.run` / `ai_qa.view` are exposed on the existing permissions endpoint. Guest and client-team users get 404. Stable error codes: `ai_qa_unsupported_media`, `ai_qa_too_long`, `ai_qa_quota`, `ai_qa_scan_pending`.

## UX (review page)
- Header button **Run AI Visual QA** opens a dialog: version "v3 · poster.png", checkboxes Proofread / Compare with approved copy (textarea), language, Standard/Thorough, the note "Runs in the background. Results are suggestions; a person confirms them." Thorough shows an estimated time.
- **"AI QA" tab** beside Comments/Task: stage stepper (Queued → Reading frames 120/480 → Checking spelling → Done), safe to leave the page, and a bell notification on completion.
- **Findings panel:** summary chips by category × band. Filters All / Spelling / Copy / Uncertain / Accepted / Dismissed / Commented. Each card shows `PREMUIM → PREMIUM`, a reason, a time range chip `00:12.4-00:15.0`, and a band label (High / Medium / Low, "OCR unsure" with OCR confidence and spelling confidence shown separately as words, not fake-precise %). Actions: Add comment · Edit · Accept · Dismiss · Not an error (+ add to glossary).
- **On-frame highlight:** selecting a card seeks the player (to `start_time_ms` + 100 ms) and draws a dashed amber box in an overlay layer reusing the annotation canvas coordinates. Images get the same box. j/k move between findings, Enter adds a comment.
- AI comments in the thread carry an "AI" sparkle badge, default to TEAM (team note), and link back to the finding.
- **Batch:** "Add 4 high-confidence as comments", which shows a preview list before confirming.
- Mobile: the panel becomes a bottom sheet over the player, with cards as a swipeable list.
- No auto-comments in v1. A workspace setting for auto-comment above a threshold comes later, only after the eval.

## Privacy / cost controls
Self-host by default, so nothing leaves the box. A cloud engine requires a workspace toggle + explanatory copy. Per-workspace daily run cap and concurrency 1. Duration/frame caps. Observations purge after 30 days. Never log OCR text or signed URLs. OCR text is treated as untrusted (escaped in UI; a future LLM verifier gets it as quoted data with a JSON-schema output, validated server-side). Cost is estimated and stored per run (for cloud engines).

## Testing / eval
- Unit: sampler PTS mapping (VFR fixture), dHash dedupe, IoU/text tracker merge, spell cascade (glossary, URLs, confusables), copy-diff classification, dedupe_key stability, idempotent comment creation, permissions (cross-workspace 404, guest 404), migrations.
- Engine tests use a `FakeOcrEngine`, so CI needs no Paddle. One optional `@tag('ocr')` smoke test runs real Paddle.
- **Eval set** `app/fixtures/ai_qa_eval/`: about 30 synthetic posters (Pillow-rendered across fonts: sans, script, outlined, low-contrast, rotated, all-caps brands, URLs, small legal) and 8 short ffmpeg-generated videos (drawtext moving/fading/scaling, 0.5 s flashes, burned subs), each with a JSON ground truth of typos and copy. The `eval_ai_qa` command reports word CER, spelling-finding precision/recall, false positives per asset/minute, timestamp error, duplicate rate, and runtime. Bands get calibrated on it. **v1 ship gate:** precision ≥ 0.8 for the High band on the clean set, and at most 1 false positive per clean poster.
- Frontend: vitest for the panel states (queued, processing, partial, failed, empty), Playwright for run → seek → add comment.

## Phases
**PR 1 (v1a), "Image QA end to end":** models + migrations, outbox topic + `run_ai_qa_worker`, Paddle adapter + Fake, image pipeline, spell cascade + workspace/project glossary, findings API, create-comment (idempotent, TEAM default, rect annotation), review tab + overlay + polling, eval command with posters. Behind feature flag `AI_VISUAL_QA_ENABLED`.
**PR 2 (v1b), "Video":** ffprobe/sampler/dedupe/densify, tracker, time-range findings, seek + overlay over time, 15 min cap, video eval clips.
**PR 3 (v1c), "Approved copy":** ApprovedCopy, alignment diff, category split, batch comment with preview.
**v2:** Google Vision / Video Intelligence engines (workspace toggle), LLM verifier on uncertain crops, LanguageTool grammar, client-scope glossary, rerun on a new version showing "fixed since v2", cost dashboard.
**v3:** auto-comment setting after calibration, multilingual, Celery migration if the outbox throughput hurts, R2 storage, WebSocket progress, brand-rule checks (forbidden terms).

## Risks
Large Paddle dependency (isolate it in the worker image) · CPU time on long video (caps + managed fallback) · false positives on stylised brand text (glossary, bands, human confirmation) · VFR timestamp drift (use PTS, never assume fps) · AI comments leaking to clients (TEAM default, existing visibility tests extended) · duplicate comments on retry (unique FK + dedupe_key).
