# AI Visual QA: research and codebase audit (Blaze Flow; the brief calls it "AgencyOS")

Read-only audit of `tanjim750/blaze-flow`, base `origin/feat/update-models-and-migrations` @ 67c3943 (main clone HEAD 8c1c68f; uncommitted package.json pins left alone). Baseline from the last run: 539 backend tests pass, CI green. I didn't re-run it for this audit.

## 1. Existing architecture (what we reuse)
| Concern | What exists | Implication |
|---|---|---|
| Backend | Django 4.2.27, DRF 3.15.2, psycopg 3, Pillow, django-storages[s3], boto3 (`requirements.txt`) | No new framework needed |
| Background jobs | **No Celery or Redis.** There is a transactional **outbox**: `OutboxEvent` (topic, dedup key unique, attempts, available_at, locked_at, dead-letter) + `services/outbox.py` + `run_outbox_worker` / `process_outbox` / `requeue_dead_letters` commands | The brief says Celery+Redis, but its §3.5 says not to redesign working code. **v1 runs on the outbox worker**, with a new topic `ai_visual_qa.run` and a separate worker queue/process. Celery is an optional later migration. |
| Media | `MediaAsset` (thin) → `MediaVersion` (immutable, `original_file`→`File`, version_number, project) → `File` (storage_backend, object_key, mime, size, checksum) + `FileVariant` (proxy/poster/thumb) | `MediaVersion` is the version FK the brief asks for. The run is keyed to `media_version_id` + file checksum. |
| Processing | `services/file_processing.py`: ffmpeg/ffprobe via `subprocess` (video proxy, poster, `_probe_duration_ms`, waveform, pdf page), security scan (`FileSecurityScan`, pluggable scanner backend), `_copy_private_object` with max_bytes | Reuse the probe/copy helpers. Frame extraction is the same subprocess pattern. CI already installs ffmpeg (PR #21). Only run QA when the scan is clean. |
| Storage | `STORAGE_DRIVER=local|s3` (S3-compatible endpoint, short `AWS_QUERYSTRING_EXPIRE`) | Works with local/S3/MinIO now. R2 later is just a config change (S3-compatible). |
| Comments | `ReviewComment` (media_version, start/end_time_ms, visibility CLIENT/TEAM, resolved, soft-delete, **CHECK exactly one of author_user/author_guest_session**), Content, Revision, Mention, Reaction | The AI attribution needs a migration: add `author_kind` / nullable `ai_finding` FK and relax the CHECK (user XOR guest XOR ai), **or** author as the requesting user with `source='ai_visual_qa'`. Recommended: the requesting user stays author + `source` + `ai_finding_id` (keeps the CHECK and existing serializers, shows "AI-suggested · added by X"). |
| Annotations | `Annotation` (start/end_time_ms, review_comment FK) + `AnnotationElement` (element_type, geometry JSON, style) | AI highlight boxes become an `AnnotationElement(element_type='rect', geometry normalized)` attached to the created comment, so the existing player overlay renders them. |
| Visibility | Team notes (`visibility=TEAM`) are never returned to guests/client-team (test_comment_visibility) | AI comments default to **TEAM**. The user picks "client-visible" explicitly. |
| Permissions | `GET workspaces/{id}/permissions/` + `permissions.py`, `resource_access` | Add capability `ai_qa.run` (members with review-edit; never guests or client-team in v1) |
| Notifications | `Notification`/`NotificationKind`, delivery via outbox, bell polls | Add kind `ai_qa_completed` (in-app only) |
| Guest review | `guest_views.py`, `/guest-review` | Findings never exposed to guests |
| Frontend | Next 16 / React 19 / Tailwind 4. Review page `src/app/(app)/review/{page,workspace,player,comments,task-panel,compare}.tsx`, `lib/review-*.ts`, design tokens (`tokens.css`, PR "one tokens file") | Add a tab "AI QA" beside Comments/Task, an overlay layer in `player.tsx`, and polling like `use-notifications.ts` |
| API style | `/api/workspaces/{ws}/projects/{p}/media-versions/{mv}/...` | Use the same nesting, not the brief's illustrative `/v1/assets/...` |
| Realtime | No Channels | Polling (2-5 s with backoff, stops when terminal) |

## 2. Gaps / additions
New models (`AIReview`, `AIFrameObservation`, `AIFinding`, `GlossaryTerm`, `ApprovedCopy`), a `ReviewComment.source` + `ai_finding` link, new outbox topic and worker, OCR engine adapters, spell layer, and the frontend tab and overlay. Every migration is additive.

## 3. Research summary (decision matrix)
Prices are list prices, read 2026-10-10. Accuracy notes come from docs and community reports, **not our benchmark yet**. M1 runs a labelled synthetic benchmark before we lock anything in.

| Option | Boxes / time | Tracks across frames | Stylised / moving text | Cost | Self-host | Licence / privacy | Notes |
|---|---|---|---|---|---|---|---|
| **PaddleOCR 3.x (PP-OCRv5/v6)** | Polygons per image/frame | No (per-frame; we track) | Strong on scene text and rotated text. v6 claims gains on displays and art text | CPU only, roughly 0.2-1 s per 1080p frame (medium tier). $0 API | Yes, CPU/ONNX/OpenVINO, ~100-300 MB models | Apache-2.0; data never leaves us | Active: v3.7.0 (Jun 2026) shipped PP-OCRv6 covering 50 languages. https://github.com/PaddlePaddle/PaddleOCR , https://github.com/PaddlePaddle/PaddleOCR/releases , https://arxiv.org/html/2507.05595 |
| Google Cloud Vision TEXT_DETECTION | Word polygons + confidence per image | No | Very good on scene text | $1.50 / 1k images after 1k free | No | Google ToS; regional endpoints | https://cloud.google.com/vision/pricing , quotas 1,800 rpm https://cloud.google.com/vision/quotas |
| Google Video Intelligence TEXT_DETECTION | **Segments with time offsets + per-frame rotated boxes** | **Yes** | Good, but the sampling is opaque | $0.15/min after 1k free min: 1 min $0.15, 5 min $0.75, 15 min $2.25, 60 min $9 | No | Async LRO, input from GCS or inline bytes | https://cloud.google.com/products/video-intelligence/pricing , https://cloud.google.com/video-intelligence/docs/text-detection |
| AWS Rekognition DetectText / StartTextDetection | Video: timestamps + boxes, word/line, filters | Per-detection with timestamps | OK, English/Latin focused, max 100 words per frame | about $0.001/image, video about $0.10/min (check region) | No | S3 input | https://docs.aws.amazon.com/rekognition/latest/dg/text-detection.html , https://aws.amazon.com/rekognition/pricing/ |
| Azure AI Vision Read (v4 / Doc Intelligence read) | Polygons, word confidence | No | Strong for print, good for scene text | about $1.50 / 1k transactions | Containers available (connected) | Microsoft DPA | https://learn.microsoft.com/azure/ai-services/computer-vision/overview-ocr |
| docTR | Boxes | No | Document-oriented, weaker on scene/art text | $0 | Yes (PyTorch) | Apache-2.0 | https://github.com/mindee/doctr |
| EasyOCR | Boxes | No | Decent, slower, maintenance is slow | $0 | Yes (PyTorch, GPU preferred) | Apache-2.0 | https://github.com/JaidedAI/EasyOCR |
| Tesseract 5 | Boxes | No | Poor on scene, stylised or moving text unless heavily preprocessed | $0 | Yes, tiny | Apache-2.0 | https://github.com/tesseract-ocr/tesseract |
| Multimodal LLM (GPT-4o-class / Gemini / Claude) | Weak or unreliable localisation | No | Best at reading decorative text in context. It can hallucinate "corrections" | about $0.002-0.01 per image crop | No | Provider API terms. Use zero-retention/no-training tiers | **Use it only as a verifier on crops of uncertain candidates**, with a strict JSON schema. Never as the only source. |

**Spelling:** SymSpell (MIT, fast edit-distance, https://github.com/wolfgarbe/SymSpell, `symspellpy`) plus Hunspell dictionaries en_GB/en_US (LGPL/MPL dictionaries, `spylls` or `pyhunspell`). LanguageTool (LGPL, self-host Java server, https://dev.languagetool.org/http-server) is a v2 addition for grammar. Glossary terms are added to the allow-list before the spell check runs.

**Frame sampling:** ffmpeg `select='gt(scene,0.3)'` plus a baseline of `fps=2` (https://ffmpeg.org/ffmpeg-filters.html#select_002c-aselect), using `showinfo`/`-frame_pts` to get exact PTS (handles VFR). PySceneDetect (BSD-3, https://www.scenedetect.com) is optional. Dedupe uses a perceptual hash (`imagehash` dHash, distance under 5) so near-identical frames skip OCR. "Densify" means re-sampling at 8-12 fps for ±1 s around any frame that contains text, which catches animated titles.

**Tracking and merge:** link detections in consecutive samples when IoU > 0.3 (or centre drift under 10% of frame width for moving text) and the normalised text similarity is above 0.8 (rapidfuzz, MIT). The interval runs from first-seen to last-seen. Within a track, a character-level majority vote is a cheap ensemble that fixes per-frame OCR noise.

**Approved-copy diff:** normalise (NFKC, casefold, collapse whitespace and line breaks, strip soft punctuation), tokenise, then align with `difflib.SequenceMatcher` / Needleman-Wunsch at word level over the concatenated per-scene OCR text. Classify each opcode: replace with edit distance ≤ 2 is `POSSIBLE_SPELLING_ERROR` (or `OCR_UNCERTAIN` if OCR confidence is low), a larger replace is `COPY_MISMATCH`, delete is `POSSIBLY_MISSING_TEXT`, insert is `UNEXPECTED_TEXT`.

## 4. Competitors
- **Filestage Review Agents** (beta): grammar/spelling, forbidden terms, required logos, QR. Supports docs, images and PDF, **no video**. Leaves comments "like a reviewer". https://help.filestage.io/en/articles/9465074-how-to-get-started-with-review-agents , https://filestage.io/review-agents/
- **Ziflow ReviewAI**: checklist prompts give pass/fail with suggested comments and markup on static proofs. **Video is in private preview** and runs only on the optimised video. Enterprise add-on. Framed as "supports reviewers, not replaces". https://help.ziflow.com/hc/en-us/articles/41711066855956-About-ReviewAI , https://help.ziflow.com/hc/en-us/articles/52118702418708-August-2026-release-notes-26-16
- **Frame.io** (Adobe): AI search and transcription. I found no public on-frame spelling QA (not verified in depth). https://frame.io
- **Vidchecker / Telestream (Vidocheck)**: broadcast technical QC (loudness, levels, gamut), not copy proofing. https://www.telestream.net/vidchecker/
- **Takeaway:** video text proofreading with time-coded, on-frame findings is a real gap. Competitors frame AI as suggestions a human confirms, and we should do the same.

## 5. Constraints, risks, assumptions
- No auth work, no Cloudflare/deploy (R2 later via the S3 driver), payments demo only, every change via a PR the user approves.
- PaddlePaddle wheels are large (~500 MB+). Run them in an **isolated worker image/venv**, kept out of the web process deps (dependency risk). An ONNX Runtime path is lighter.
- CPU OCR on long videos is slow (60 min at about 1 fps effective, ~3,600 frames, ~30-60 min CPU). That's why we cap duration in v1 and offer a managed fallback.
- False positives on brand terms, all-caps text and stylisations are the main UX risk, so we start with glossary + confidence bands + human confirmation.
- Assumes English (en-GB default, en-US selectable) in v1.
