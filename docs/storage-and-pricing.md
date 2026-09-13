# Storage Architecture and Pricing Model

This document records the storage design decisions and the cost/pricing analysis behind them. It is a reference for *why* the storage layer is built the way it is and what a subscription price should be based on — not a feature spec (see `docs/implementations/domain_and_features.md`) and not a change log (see `docs/implementation-log.md`).

---

## 1. How storage works in this codebase today

Storage is driven by a single environment variable, `STORAGE_DRIVER`, read in `blazeflow/settings.py:182-220`:

- **`local`** (default) — files write to the filesystem under `MEDIA_ROOT` via Django's default storage. Fine for development; not viable for a multi-instance production deployment.
- **`s3`** — files go through `django-storages`' generic `S3Storage` backend. Because the endpoint (`AWS_S3_ENDPOINT_URL`), region, and addressing style are all environment-configurable, this same code path works against real AWS S3 *or* any S3-compatible provider (Cloudflare R2, MinIO, Backblaze B2) without code changes — only environment variables differ.

All application code reads and writes through Django's `default_storage` handle rather than talking to a backend directly, so the driver choice is invisible to callers:

- `app/services/media.py:107` — media version uploads
- `app/services/project_files.py:109` — project file uploads
- `app/services/retention.py:162-163` — deletion during retention sweeps
- `app/services/file_processing.py` — preview/proxy variant generation and reads

Every stored object is linked to a `StorageBackend` database row (`provider` = `django-default` or `s3-compatible`), and every upload path wraps the storage write in a try/except that deletes the just-written object if the following database transaction fails — no orphaned files on partial failure.

### Why Cloudflare R2 over AWS S3

Both are S3-API-compatible object storage; the difference that matters for this product is **egress pricing**:

| | AWS S3 | Cloudflare R2 |
|---|---|---|
| Storage | ~$0.023/GB/mo | ~$0.015/GB/mo |
| Egress (bandwidth out) | Charged — often the dominant cost | **Free** |
| Request pricing | Charged per request (Class A/B) | Charged per request, generally cheaper; large free monthly allowance |
| Regions | Explicit region selection | Automatically distributed |

For a media review product — where reviewers repeatedly stream/download large video and image files — egress is the cost that scales with *usage*, not just storage. S3's per-GB-out charge means the bill grows every time a file is viewed; R2's free egress decouples cost from view count. `STORAGE_DRIVER=s3` in this codebase already supports pointing at R2 by setting `AWS_S3_ENDPOINT_URL` to the R2 endpoint, `AWS_S3_REGION_NAME=auto`, and R2 API credentials — no code change required.

### Video proxies: the other half of controlling egress

Point-in-time storage cost is one factor; the recurring, usage-scaled cost is *repeatedly serving large original files*. This is the core lesson from how Frame.io (Adobe) controls its own cost: reviewers never stream the original upload — they stream a small, low-bitrate H.264 **proxy** generated once at upload time. The original stays in storage, untouched, until an explicit download/export.

This codebase now implements that pattern:

- `app/services/file_processing.py`'s `_video_proxy()` transcodes uploaded video to a capped-resolution (960×540 default), CRF-28 H.264/AAC MP4 using ffmpeg, generated asynchronously through the existing preview/outbox pipeline (the same pipeline that already produced image thumbnails, PDF first-page renders, and audio waveforms).
- `GET /workspaces/<id>/projects/<id>/media-versions/<id>/preview/` (`media_version_preview` in `app/views.py`) serves the generated proxy, gated on `MEDIA_READ` rather than `MEDIA_DOWNLOAD` — a reviewer can watch the proxy without download permission and without the original ever leaving storage.
- Config is environment-driven: `VIDEO_PROXY_MAX_WIDTH`/`_MAX_HEIGHT`, `VIDEO_PROXY_CRF`, `VIDEO_PROXY_AUDIO_BITRATE`, plus separate input/output byte caps and timeout (`blazeflow/settings.py`, video proxy block).

Combined, R2 (or S3 pointed at R2) plus proxy-first playback means the bill scales with *storage volume*, not with *how many times something is watched* — which is the only way a flat-rate storage plan stays profitable at scale.

---

## 2. Cost-modeling principle: price the cap, cost the average

The recurring mistake in naive pricing is assuming every subscriber fills their storage allotment. In practice, a storage cap is a *ceiling*, not a *fill level* — most subscribers use a fraction of what they're allotted (this is true of Google One, Dropbox, iCloud+, and Frame.io alike). A pricing model has to be built around **expected average utilization**, not worst-case utilization, while staying solvent if utilization runs higher than expected.

Cost inputs used throughout this document (retail rates, no negotiated enterprise discount — those only apply at hyperscale and shouldn't be assumed for a new product):

- Storage: R2 @ **$0.015/GB/month**
- Egress: **$0** (R2)
- Transcode compute: modeled at **~$3–5/month per active account** doing meaningful video review volume, since ffmpeg CPU time doesn't scale with GB stored, only with how much *new* video is uploaded per month

---

## 3. Pricing model: 2TB for $20/month

### Margin sensitivity by utilization

The plan's profitability depends entirely on what fraction of the 2TB cap subscribers actually use on average. Modeled against R2 retail pricing plus proxy compute:

| Utilization | Storage used | Storage COGS (@ $0.015/GB) | + Transcode compute (~$4) | **Total COGS** | Price | **Gross margin** |
|---|---|---|---|---|---|---|
| 10% | 200 GB | $3.00 | $4.00 | $7.00 | $20 | **65%** |
| 25% | 500 GB | $7.50 | $4.00 | $11.50 | $20 | **42.5%** |
| 50% | 1,000 GB | $15.00 | $4.00 | $19.00 | $20 | **5%** |
| 75% | 1,500 GB | $22.50 | $4.00 | $26.50 | $20 | **−32.5% (loss)** |
| 100% | 2,000 GB | $30.00 | $4.00 | $34.00 | $20 | **−70% (loss)** |

**Breakeven point: ~1,065 GB, or ~53% of the 2TB cap.** Below that, the plan is profitable; above it, each subscriber costs more than they pay.

### What this means in practice

- **$20/2TB only works as a blended-average bet.** It requires the median subscriber to sit meaningfully under half the cap — realistic for most review workflows (a handful of active projects at a time, with older ones archived or deleted), but it means a small number of subscribers who genuinely fill the cap are being cross-subsidized by the majority who don't.
- **This is a thinner margin than a higher-priced tier.** An earlier model in this conversation (2TB at $45/mo) held ~70%+ margin even at higher utilization, because the price itself carries more headroom. $20/2TB is a much more aggressive, consumer-friendly price point — closer to Google One/Dropbox territory than Frame.io's studio pricing — and should be treated accordingly: viable, but with less room for error.
- **This plan is only viable on R2 (or equivalent free-egress storage) with proxy-first playback already in place.** Re-run the same table against AWS S3 retail pricing (storage alone at 25% utilization is already $11.50, before any egress) and the plan is underwater almost immediately once reviewers start actually watching uploaded video. The engineering decisions in Section 1 aren't incidental to this price — they're what makes it possible at all.
- **Consider a soft-utilization safeguard** once real usage data exists: a fair-use notice, throttled upload speed, or a small per-GB overage charge past ~1TB actual usage, so an individual heavy user can't single-handedly turn the plan unprofitable. This is deliberately not built yet (see Section 4) — it's a decision to make once there's real usage data to model against, not before.

### Suggested tier context

A single $20/2TB paid tier still needs a free entry point to be a full pricing model:

| | Free | Pro |
|---|---|---|
| Price | $0 | **$20/mo** |
| Storage cap | 5 GB | **2 TB** |
| Workspaces owned | 1 | 20 *(existing `PLAN_LIMITS` default)* |
| Projects/workspace | 3 | 200 *(existing `PLAN_LIMITS` default)* |
| Video review | proxy playback (once storage enforcement ships) | proxy playback |

The Free tier's cost is negligible (a couple GB × $0.015 ≈ pennies) and functions purely as an acquisition funnel, same as every competitor in this space.

---

## 4. Implementation status

What's built as of this document:

- ✅ Swappable local/S3-compatible storage driver (Section 1)
- ✅ Video proxy generation + a preview endpoint that serves it without requiring download rights
- ✅ **Storage cap per plan, enforced.** `PLAN_LIMITS` now has `max_storage_bytes` (FREE: 5GB, PRO: 2TB — the numbers modeled above), and `enforce_workspace_storage_limit()` (`app/services/subscriptions.py`) blocks an upload that would push a workspace over its plan's cap. Wired into all four upload paths (media versions, project files, review attachments, task attachments). `File` now carries a `workspace` FK (migration `0020_add_file_workspace`) so usage can be summed per workspace.
- ⚠️ **Usage is a live `Sum(size_bytes)` query, not a running counter.** The authoritative check locks the workspace row in the same transaction that creates the `File`, preventing concurrent uploads from jointly exceeding the cap. This is correct, but not the O(1) "denormalized counter" originally sketched — revisit if per-upload query cost matters at scale. `FileVariant` rows (previews/proxies) are not counted, only original uploads.
- ❌ **No overage billing or fair-use throttling.** Enforcement is a hard block at the cap — nothing yet does the "charge extra past the cap" or "archive old projects" mitigation discussed for the breakeven-utilization risk in Section 3.
- ❌ **No billing integration.** `UserSubscription.provider`/`provider_subscription_id` (`app/models.py`) are schema-ready for Stripe or another provider but unpopulated — there is currently no way to actually charge $20/mo for this plan.

## 5. Recommended next steps

In dependency order:

1. ~~Storage cap + usage tracking~~ — done (see Section 4).
2. **Fair-use / overage safeguard** — once real usage data exists, decide whether to throttle, warn, or charge overage past the ~53% breakeven utilization modeled above.
3. **Stripe (or equivalent) billing integration** — wire the existing `UserSubscription.provider` fields to real checkout and webhook handling so the $20/mo plan can actually be sold.
