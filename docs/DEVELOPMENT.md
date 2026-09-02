# Blaze Flow Developer Guide

This is the starting point for anyone developing or reviewing Blaze Flow. Keep this guide current whenever setup, architecture, or team conventions change. Record material implementation work in `docs/implementation-log.md`.

## Current state

Blaze Flow is a Django REST Framework backend in its foundation phase. The repository contains a broad domain model, but most product APIs and business services are not implemented yet. Product intent lives in `docs/implementations/domain_and_features.md`; it must not be mistaken for delivered functionality.

The currently supported behavior is:

- PostgreSQL-backed Django startup and migrations
- registration and session login/logout using one custom email-based user identity
- Django password hashing, authentication, permissions, and admin integration
- atomic workspace creation with an owner role, permission bundle, and primary-owner membership
- hashed-token workspace invitations, membership role/status management, and client-team permission inheritance
- client-team administration (profile CRUD, archival, member add/remove/reactivation, workspace-access grants, and EMAIL/LINK invites)
- workspace- and project-scoped tasks (CRUD, assignees, and signature-verified attachments over the existing review/media scanning pipeline)
- project files and folders (nested folders with cascading soft delete, root/sibling name uniqueness, and signature-verified file uploads over the same scanning pipeline)
- workspace detail/update, an optional business profile, and reversible PENDING_DELETION lifecycle scheduling with a configurable grace period
- FREE/PRO user subscriptions with a centralized Plan Config service (`app/services/plan_config.py`), self-service PRO upgrade/cancel/resume with no external payment provider, an operator command to process scheduled cancellations, and enforced workspace/project/storage plan limits
- Google Sign-In (`POST /api/auth/google/`) that verifies a client-supplied Google ID token, auto-links a verified Google email to a matching existing account or creates a new one (unusable password, pre-verified email, FREE subscription), and reuses the same linked identity on return visits
- DOCX/XLSX/PPTX/RTF are now accepted alongside the existing image/PDF/audio/video attachment types, verified by their internal ZIP part rather than the shared outer ZIP signature
- additive workspace/project permission evaluation with `ALL` and `SELECTED` project scope
- authorized project listing, creation, detail, update, and archival
- protected system roles, custom role administration, and explicit project-access grants
- default-storage media uploads with project-wide version allocation, initial workflow history, asynchronous H.264 review proxies, and permission-controlled proxy playback
- database constraints for principal, author, ownership, workflow, and subscription invariants
- a public `GET /api/health/` endpoint
- automated foundation checks and tests

## Repository map

| Path | Purpose |
| --- | --- |
| `blazeflow/settings.py` | Environment-driven Django configuration |
| `blazeflow/urls.py` | Root URL routing |
| `app/models.py` | Executable domain schema |
| `app/managers.py` | Custom user creation rules |
| `app/admin.py` | Django admin integration |
| `app/events/` | Minimal synchronous domain-event mechanism |
| `app/migrations/` | Authoritative database history |
| `app/tests.py` | Current foundation tests; split by domain as the suite grows |
| `docs/implementations/` | Product/domain intent |
| `docs/implementation-log.md` | Chronological delivery and decision record |
| `Postman_Collection.json` | Executable manual API requests with automatic variable capture |
| `POSTMAN_TESTING_GUIDE.md` | Session, CSRF, owner/member, grant, and media testing workflow |
| `database-schema.sql` | Historical design reference, not an executable schema source |

## Local setup with Docker

Requirements: Docker Desktop with Compose v2.

1. Copy `.env.example` to `.env`.
2. Replace every `change-me` value. Local values must never be reused in production.
3. Run `docker compose up --build`.
4. Open `http://localhost:8000/api/health/` and expect `{"message":"ok"}`.

Useful commands:

```bash
docker compose run --rm web python manage.py check
docker compose run --rm web python manage.py makemigrations --check --dry-run
docker compose run --rm web python manage.py test
docker compose run --rm web python manage.py createsuperuser
```

For a fast host-side unit-test pass when PostgreSQL is unavailable, install `requirements.txt` in a virtual environment and run:

```bash
DJANGO_DEBUG=true DJANGO_SETTINGS_MODULE=blazeflow.test_settings python manage.py test
```

This uses an in-memory SQLite database and a fast test-only password hasher. It does not replace the PostgreSQL CI run, particularly for constraints and transaction behavior.

To rebuild the local database from scratch, remove the Compose volume only when losing local data is acceptable:

```bash
docker compose down --volumes
docker compose up --build
```

## External-drive warning

This repository has previously been hosted on a filesystem that creates macOS AppleDouble (`._*`) files. These files can corrupt Git pack reads and make Docker BuildKit fail while reading extended attributes. The durable fix is to keep the active checkout on an APFS volume. If an external drive must be used, verify regularly with:

```bash
git status --short
git fsck --full
```

The ignore files prevent metadata from being committed, but ignore rules cannot protect files created inside `.git`.

## Configuration

| Variable | Required | Meaning |
| --- | --- | --- |
| `DJANGO_SECRET_KEY` | Yes outside debug mode | Unique secret per environment |
| `DJANGO_DEBUG` | No; defaults false | Enables Django development diagnostics |
| `DJANGO_ALLOWED_HOSTS` | Yes in deployments | Comma-separated hostnames |
| `POSTGRES_DB` | Yes | PostgreSQL database |
| `POSTGRES_USER` | Yes | PostgreSQL user |
| `POSTGRES_PASSWORD` | Yes | PostgreSQL password |
| `POSTGRES_HOST` | No | Defaults to `localhost`; Compose sets `db` |
| `POSTGRES_PORT` | No | Defaults to `5432` |
| `MAX_MEDIA_UPLOAD_BYTES` | No | Defaults to 1 GiB |
| `PASSWORD_RESET_URL` | No | Frontend reset page used in reset emails |
| `PASSWORD_RESET_TTL_MINUTES` | No | Reset-token lifetime; defaults to 30 minutes |
| `EMAIL_VERIFICATION_URL` | No | Frontend verification page used in verification emails |
| `EMAIL_VERIFICATION_TTL_MINUTES` | No | Verification-token lifetime; defaults to 1,440 minutes |
| `REVIEW_PAGE_SIZE` | No | Default comment/annotation page size; defaults to 50 |
| `REVIEW_MAX_PAGE_SIZE` | No | Maximum requested review page size; defaults to 200 |

Never commit `.env`. Deployment secrets belong in the target platform's secret manager.

## Authentication architecture

`app.User` is the one authoritative registered-user identity and is configured through `AUTH_USER_MODEL`. Email is the login identifier. Passwords are stored in Django's built-in encoded password field and must only be set through `set_password()`, `create_user()`, or `create_superuser()`.

User lifecycle status controls authentication: only `ACTIVE` users are considered active by Django's default authentication backend. `SUSPENDED` and `DELETED` users cannot authenticate.

Registration, login, password-reset, and email-verification endpoints are independently throttled by client address. Rates are environment-configurable. `THROTTLE_TRUSTED_PROXY_COUNT` defaults to zero so forwarded headers are not trusted; set it to the exact proxy depth only when each listed proxy normalizes the forwarding chain. Password-reset and verification requests always return the same `202` response to prevent account enumeration.

Registration sends a verification email. Verification tokens are stored only as SHA-256 hashes, expire, are single-use, and a resend invalidates earlier active tokens. Verification is currently an account signal exposed through `email_verified_at`; it does not block login while product onboarding policies are still being defined. Reset tokens follow the same hashed, expiring, single-use lifecycle. Authenticated password changes require the current password and preserve the caller's current session.

Expired identity tokens can be previewed and deleted in bounded batches:

```bash
python manage.py purge_auth_tokens --dry-run --limit 1000
python manage.py purge_auth_tokens --limit 1000
```

OAuth providers should link through `OAuthIdentity`. An OAuth-only account must use `set_unusable_password()` until the owner configures a password. Do not introduce a second user or password table.

## Current API

All request and response bodies use JSON. Authentication uses Django's session cookie. A successful login returns a `csrf_token` and sets the corresponding CSRF cookie. Browser clients must retain both cookies and send the token in the `X-CSRFToken` header on authenticated unsafe requests.

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/health/` | Public | Application health response |
| `POST` | `/api/auth/register/` | Public | Register an email/password user |
| `POST` | `/api/auth/login/` | Public | Start a session |
| `POST` | `/api/auth/password-reset/request/` | Public | Send enumeration-safe reset instructions |
| `POST` | `/api/auth/password-reset/confirm/` | Public | Consume a reset token and replace the password |
| `POST` | `/api/auth/email-verification/request/` | Public | Send enumeration-safe verification instructions |
| `POST` | `/api/auth/email-verification/confirm/` | Public | Consume a verification token |
| `POST` | `/api/auth/password/change/` | Authenticated | Replace password after current-password verification |
| `POST` | `/api/auth/logout/` | Authenticated | End the current session |
| `GET` | `/api/auth/me/` | Authenticated | Return the current user |
| `POST` | `/api/workspaces/` | Authenticated | Create a workspace and owner authorization graph |
| `GET/POST` | `/api/workspaces/{workspace_id}/roles/` | Reader/role manager | List or create roles |
| `GET` | `/api/workspaces/{workspace_id}/workflow-stages/` | Workspace reader | List active workflow stages and statuses |
| `PATCH/DELETE` | `/api/workspaces/{workspace_id}/roles/{role_id}/` | Role manager | Update or archive a custom role |
| `GET` | `/api/workspaces/{workspace_id}/members/` | Workspace reader | List workspace principals |
| `PATCH` | `/api/workspaces/{workspace_id}/members/{membership_id}/` | Member manager | Change a non-owner role, scope, or status |
| `POST` | `/api/workspaces/{workspace_id}/invitations/` | Member manager | Create a single-use invitation token |
| `POST` | `/api/workspace-invitations/accept/` | Authenticated | Accept an invitation matching the user's email |
| `GET/POST` | `/api/workspaces/{workspace_id}/projects/` | Authorized member | List accessible projects or create a project |
| `GET/PATCH/DELETE` | `/api/workspaces/{workspace_id}/projects/{project_id}/` | Authorized member | Read, update, or archive a project |
| `GET/POST` | `/api/workspaces/{workspace_id}/projects/{project_id}/guest-invites/` | Comment manager | List guest lifecycle state or create an invite |
| `DELETE` | `/api/workspaces/{workspace_id}/projects/{project_id}/guest-invites/{invite_id}/` | Comment manager | Revoke an invite and all active derived access |
| `DELETE` | `/api/workspaces/{workspace_id}/projects/{project_id}/guest-access/{access_id}/` | Comment manager | Revoke one exchanged guest access session |
| `POST` | `/api/guest/reviews/{project_id}/access-key/rotate/` | Active guest key | Replace the current guest access key |
| `DELETE` | `/api/guest/reviews/{project_id}/attachments/{content_id}/` | Owning guest with delete scope | Soft-delete an attachment and its previews |
| `GET/POST` | `/api/workspaces/{workspace_id}/projects/{project_id}/access/` | Member manager | List or create explicit project grants |
| `DELETE` | `/api/workspaces/{workspace_id}/projects/{project_id}/access/{grant_id}/` | Member manager | Revoke an explicit grant |
| `GET/POST` | `/api/workspaces/{workspace_id}/projects/{project_id}/media-versions/` | Authorized member | List media or upload a video/image version |
| `GET` | `/api/workspaces/{workspace_id}/projects/{project_id}/media-versions/{media_version_id}/` | Authorized member | Read media metadata and its current stage |
| `GET` | `/api/workspaces/{workspace_id}/projects/{project_id}/media-versions/{media_version_id}/download/` | Media downloader | Download an enabled private media object |
| `GET/POST` | `/api/workspaces/{workspace_id}/projects/{project_id}/media-versions/{media_version_id}/workflow/` | Media reader/transitioner | Read history or transition to another stage |
| `GET/POST` | `/api/workspaces/{workspace_id}/projects/{project_id}/media-versions/{media_version_id}/comments/` | Comment reader/creator | List active comments or create a comment/reply |
| `PATCH/DELETE` | `/api/workspaces/{workspace_id}/projects/{project_id}/media-versions/{media_version_id}/comments/{comment_id}/` | Author/comment manager | Edit own text or soft-delete a thread |
| `POST` | `/api/workspaces/{workspace_id}/projects/{project_id}/media-versions/{media_version_id}/comments/{comment_id}/resolution/` | Comment manager | Resolve or reopen a top-level thread |
| `GET` | `/api/workspaces/{workspace_id}/projects/{project_id}/media-versions/{media_version_id}/comments/{comment_id}/revisions/` | Comment reader | Read immutable edit snapshots |
| `POST/DELETE` | `/api/workspaces/{workspace_id}/projects/{project_id}/media-versions/{media_version_id}/comments/{comment_id}/reactions/` | Reaction creator | Add or remove the caller's reaction |
| `POST` | `/api/workspaces/{workspace_id}/projects/{project_id}/media-versions/{media_version_id}/revision-requests/` | Comment creator/media transitioner | Create feedback and request a workflow revision |
| `POST` | `/api/workspaces/{workspace_id}/projects/{project_id}/media-versions/{media_version_id}/comments/{comment_id}/attachments/` | Comment author | Upload a verified private attachment |
| `GET/DELETE` | `/api/workspaces/{workspace_id}/projects/{project_id}/media-versions/{media_version_id}/comments/{comment_id}/attachments/{content_id}/` | Comment reader/author-manager | Download or soft-delete an attachment |
| `GET/POST` | `/api/workspaces/{workspace_id}/projects/{project_id}/media-versions/{media_version_id}/annotations/` | Annotation reader/creator | List or create visual markup |
| `PATCH/DELETE` | `/api/workspaces/{workspace_id}/projects/{project_id}/media-versions/{media_version_id}/annotations/{annotation_id}/` | Author/annotation manager | Replace own markup or soft-delete it |
| `GET` | `/api/workspaces/{workspace_id}/projects/{project_id}/media-versions/{media_version_id}/annotations/{annotation_id}/revisions/` | Annotation reader | Read immutable annotation snapshots |
| `GET` | `/api/workspaces/{workspace_id}/delivery-health/` | Workspace manager | Read delivery/outbox status counts |
| `GET/PATCH` | `/api/workspaces/{workspace_id}/retention-policy/` | Workspace manager | Read or update review-file cleanup policy |
| `GET` | `/api/notifications/` | Authenticated recipient | List own notifications; `?unread=true` filters unread |
| `GET/PATCH` | `/api/notification-preferences/` | Authenticated user | Read or update mention-email preference |
| `POST` | `/api/notifications/{notification_id}/read/` | Notification recipient | Idempotently mark one notification read |
| `POST` | `/api/notifications/read-all/` | Authenticated recipient | Mark all own unread notifications read |

Registration fields are `email`, `password`, `first_name`, `last_name`, and optional `timezone`. Workspace creation fields are `name`, optional `slug`, and a required IANA `timezone` such as `Europe/London`.

Comment and annotation list endpoints accept `limit` and `offset`. JSON remains a list for compatibility. Pagination state is returned in `X-Pagination-Limit`, `X-Pagination-Offset`, `X-Pagination-Total`, and, when another page exists, `X-Pagination-Next-Offset`.

Workspace creation is one database transaction. It provisions an `Owner` role, the initial permission keys, and an active direct-user membership with `ALL` project access and `is_primary_owner=True`. If any step fails, the entire workspace creation is rolled back.

It also provisions a limited `Member` role. Permissions are additive across a user's active direct membership and active Client Team memberships. A role answers what the principal may do; `project_access_mode` and `ResourceAccess` answer where project permissions apply.

Workspace invitation tokens are returned only by the creation response and stored only as SHA-256 hashes. Email delivery is not implemented yet. The caller must deliver the raw token through an approved secure channel. Acceptance is single-use, expires, must match the authenticated user's normalized email, and creates or reactivates a direct membership transactionally.

`DELETE` on a project is intentionally a lifecycle operation: it changes the project to `ARCHIVED` and does not physically delete data.

The permission registry in `app/permissions.py` is authoritative. Role APIs reject unknown keys. `Owner` and `Member` are protected system roles; custom roles may be updated or archived, but an active membership must be reassigned before its role can be archived. Role deletion is lifecycle archival rather than physical deletion.

Explicit project grants are valid only for active memberships using `SELECTED` scope. An `ALL` membership does not need grant rows. Grant creation validates workspace consistency, and revocation immediately removes that access unless another additive membership still authorizes the user.

## Media storage and versioning

Media uploads use Django's configured `default_storage`. Local development writes beneath `MEDIA_ROOT`; production must configure durable private storage before accepting real client assets. The `StorageBackend` database row records logical provenance but does not configure storage credentials.

Uploads accept supported PNG, JPEG, GIF, WebP, MP4, QuickTime, and WebM signatures up to `MAX_MEDIA_UPLOAD_BYTES`. The service verifies the byte signature against the declared MIME type and stores a SHA-256 checksum. Objects use opaque workspace/project paths, while API responses expose safe file metadata rather than internal object keys.

Object storage cannot join a PostgreSQL transaction, so the service writes the object first and performs a compensating delete if database work fails. The database transaction locks the Project row, advances `next_media_version_number`, creates the File and Media Version, and creates exactly one open initial stage-history entry.

New and existing workspaces receive Queued, In Progress, In Review, Revision, Approval, and Approved stages. The earliest active stage is the upload default unless another active stage in the same workspace is selected.

The workflow-stage list endpoint exposes valid transition IDs. A transition locks the Media Version and its open entry, closes that entry, and creates one new open history entry in a single database transaction. Re-entering the same stage/status is rejected. Uploads, downloads, and transitions write workspace audit records.

Downloads are never exposed as direct storage URLs. The application checks `media.download`, project scope, and `allow_download` before opening the object through `default_storage`. Production deployments must use private durable storage; signature verification and checksums do not replace malware scanning.

## Review comments and revision requests

Top-level text comments may omit timing, target a single `start_time_ms`, or target an inclusive range with `start_time_ms` and `end_time_ms`. Times are non-negative milliseconds, an end requires a start, and the end cannot precede the start. Replies use `parent_comment_id`, must belong to the same Media Version, and cannot declare separate timing.

`review.comment.read` controls active comment and revision-history reads. `review.comment.create` controls creation and author-only editing. `review.comment.manage` controls top-level resolution/reopening and recursive soft deletion. Deleted rows, contents, and revisions remain stored, while normal lists omit the deleted subtree.

Before an edit changes text, the service captures the previous timing, resolution state, and complete ordered content collection in `ReviewCommentRevision.snapshot`. The edit, revision, and audit event share one transaction.

A revision request requires both `review.comment.create` and `media.transition`. It atomically creates a top-level feedback comment and transitions the Media Version to the active `revision` stage. If the workflow operation fails, the comment and its audit record roll back. If the media is already in Revision, the feedback is created without a duplicate stage-history entry.

`review.reaction.create` allows registered collaborators to add or remove their own reaction. Guest links use the same `review.reaction.create` scope. Supported reactions are 👍, ❤️, 😂, 😮, 😢, and 🎉. Adding the same emoji twice is idempotent, deletion affects only the caller's matching reaction, and comment responses expose grouped counts and reactor names. Reaction changes are audited.

## Mentions, notifications, and the outbox

Comment creation, editing, and revision requests accept structured mention IDs:

```json
{
  "text": "Please review this update.",
  "mentioned_user_ids": ["00000000-0000-0000-0000-000000000000"]
}
```

The service deduplicates IDs, ignores the author, and requires every remaining user to be active and authorized for `review.comment.read` on the Project. An invalid or unauthorized target fails the whole operation. Edit snapshots include the previous mention set.

Each new Comment Mention creates one recipient-owned Notification and one `notification.created` Outbox Event in the same transaction. Unique constraints prevent duplicate active mentions and duplicate per-comment delivery. Removing a mention retains the historical notification; re-adding it does not send the same notification again.

The processor claims pending/failed events with row locking, records attempts and errors, retries failures, and reclaims stale `PROCESSING` events after five minutes by default:

```bash
python manage.py process_outbox --limit 100 --reclaim-after-seconds 300
```

Delivery is at-least-once, so subscribers must be idempotent. The command publishes through the in-process domain-event dispatcher, where the mention-email subscriber is registered. Production requires continuous or scheduled command execution; push/WebSocket delivery still needs additional subscribers.

The registered mention-email subscriber uses Django's email backend. Local development defaults to the console backend. Production should set `EMAIL_BACKEND`, `EMAIL_HOST`, `EMAIL_PORT`, credentials, TLS/SSL, `DEFAULT_FROM_EMAIL`, and `APP_BASE_URL`. TLS and SSL cannot both be enabled.

Failed outbox processing schedules exponential retry using `OUTBOX_RETRY_BASE_SECONDS`, capped by `OUTBOX_RETRY_MAX_SECONDS`. After `OUTBOX_MAX_ATTEMPTS`, the event becomes `DEAD_LETTER` and is excluded from automatic processing. Once the underlying delivery problem is fixed, operators can requeue a specific event or a bounded batch:

```bash
python manage.py requeue_dead_letters --event-id <uuid>
python manage.py requeue_dead_letters --limit 100
```

Email preferences do not hide in-app notifications. A disabled mention-email preference creates a `SKIPPED` delivery record so processing remains observable and idempotent.

## Review attachments

Only a comment's registered author can add attachments. Active collaborators with `review.comment.read` and project access can download them; the author or a user with `review.comment.manage` can soft-delete them. Uploads support verified PNG, JPEG, GIF, WebP, PDF, WAV, and MP3 signatures up to `MAX_REVIEW_ATTACHMENT_BYTES`.

Attachment objects use opaque private keys and store SHA-256 checksums. New objects remain `PENDING` and cannot be downloaded until the outbox worker processes `file.security-scan.requested`. Clean files become `READY`; infected or scan-failed files become `FAILED`. A clean scan queues an idempotent preview event that creates a private SVG review-card File Variant.

Preview processing decodes valid images into bounded JPEG thumbnails and valid WAV files into SVG waveforms. Pixel and output bounds are controlled by `PREVIEW_MAX_PIXELS`, `PREVIEW_MAX_WIDTH`, and `PREVIEW_MAX_HEIGHT`. PDF, MP3, corrupt, or unsupported decoder inputs receive the safe metadata review card instead.

`FILE_SECURITY_SCANNER` selects a scanner class with a `name` attribute and `scan(stream)` method returning at least `{"clean": true|false}`. The default `EicarAwareScanner` is only a development/test integration backend. `app.services.file_processing.ClamAVTcpScanner` implements ClamAV's bounded INSTREAM protocol using `CLAMAV_HOST`, `CLAMAV_PORT`, `CLAMAV_TIMEOUT_SECONDS`, and `CLAMAV_MAX_STREAM_BYTES`. Django system checks reject an invalid scanner class. Storage writes are compensated if database creation fails.

Soft deletion marks an attachment, its File, and generated variants. `REVIEW_FILE_RETENTION_DAYS` defaults to 30 and is used when a workspace has no explicit policy. Workspace managers can enable or disable cleanup and select a 1–3,650 day window through the retention-policy API. Changes are audited.

Operators should preview and then schedule policy-aware physical cleanup:

```bash
python manage.py purge_review_files --dry-run
python manage.py purge_review_files --limit 100
python manage.py purge_review_files --workspace-id <workspace-uuid> --dry-run
```

The cleanup service resolves the workspace policy for each attachment, skips disabled workspaces, and only targets soft-deleted review attachments older than every applicable workspace window. `--workspace-id` scopes a run. `--older-than-days` remains an explicit operator override and bypasses workspace enable/window settings, so it should be used only for deliberate recovery or compliance actions. Cleanup deletes the private original and all variants but preserves database and audit rows with `metadata.physical_deleted_at`. Storage failures produce a non-zero command exit and remain retryable.

## Guest reviews

Workspace collaborators with `review.comment.manage` can create a project guest invite. The raw invite token is returned once. Exchange it at `POST /api/guest-access/exchange/`; the resulting access key is also returned once and must be sent as `X-Guest-Access-Key` to `/api/guest/reviews/...` endpoints.

Supported scoped permissions are `media.read`, `media.download`, `review.comment.read`, `review.comment.create`, `review.comment.edit`, `review.comment.delete`, `review.reaction.create`, `review.attachment.create`, `review.attachment.delete`, `annotation.read`, `annotation.create`, `annotation.edit`, and `annotation.delete`. Guests can mutate only records authored by their exact guest session and can remove only their own reactions. Each edit stores the previous snapshot with guest attribution. Comment deletion is leaf-only and is rejected while the comment has any active reply. Guests with the attachment capability can upload only to their own comments; uploads enter the same quarantine, scan, and preview pipeline as member uploads.

Invite permissions are copied onto the access grant at exchange so later invite edits cannot silently broaden an active guest session. Both secret types are stored only as SHA-256 hashes. Managers can list invites and exchanged sessions, revoke one access session, or revoke an invite and all active access derived from it. Revocation is immediate and audited.

An active guest can rotate its key at `POST /api/guest/reviews/{project_id}/access-key/rotate/`. The current key is supplied in `X-Guest-Access-Key`; the old hash is replaced transactionally and the new raw key is returned once.

## Private production storage

`STORAGE_DRIVER=local` remains the development default. Set `STORAGE_DRIVER=s3` with `AWS_STORAGE_BUCKET_NAME` to activate django-storages' private S3 backend. Region, endpoint, credentials, addressing style, and signed-query expiry are environment-driven, allowing AWS S3 or compatible providers. IAM/container credentials work when explicit keys are omitted. Database Storage Backend metadata records only bucket/region/endpoint—not secrets.

Original uploads count against the workspace owner's plan limit (`PLAN_FREE_MAX_STORAGE_BYTES` and `PLAN_PRO_MAX_STORAGE_BYTES`). Upload services make a fast preflight check and then repeat the check while locking the workspace row in the file-creation transaction, so concurrent uploads cannot jointly exceed the cap. Logically deleted project files, review attachments, and task attachments stop counting; generated `FileVariant` previews and proxies do not count.

## Visual annotations

Annotations can optionally link to an active comment on the same Media Version and can target a general frame, a point in milliseconds, or a time range. Supported element contracts are:

- `POINT` and `TEXT`: normalized `x`, `y`; TEXT also requires `payload.text`.
- `RECTANGLE` and `ELLIPSE`: normalized `x`, `y`, `width`, `height`, fully inside the canvas.
- `ARROW`: normalized `start` and `end` points.
- `PATH`: 2–500 normalized points.

`annotation.create` permits creation and author-only replacement edits. `annotation.manage` permits soft deletion. Every edit replaces the ordered element set transactionally and stores the previous targeting/link/elements in Annotation Revision.

## Outbox worker and delivery health

Compose now starts a restartable `worker` service running:

```bash
python manage.py run_outbox_worker --batch-size 100 --interval-seconds 5
```

The command closes stale database connections between polls and uses the existing row-locking, retries, dead letters, and stale-claim recovery. `--once` is available for cron/serverless execution. The workspace delivery-health endpoint is manager-only and returns grouped email-delivery and outbox status counts.

`GET /api/workspaces/{workspace_id}/operations/health/` adds attachment scan and alert state. Monitoring systems can also run:

```bash
python manage.py check_operational_alerts --workspace-id <uuid> --fail-on-critical
```

Critical state currently means an infected attachment or dead-letter event. Failed/stale scans produce warnings. `OPERATIONS_STALE_MINUTES` controls the pending-scan threshold.

Prometheus-compatible metrics are exposed at the manager-protected `GET /api/workspaces/{workspace_id}/operations/metrics/` endpoint. It reports bounded status labels for scans, deliveries, outbox events, alerts, and the current health state.

## Decoded review previews

Images and WAV files are decoded in process. PDF first pages use Poppler's `pdftoppm`; MP3 waveforms use `ffmpeg` to produce bounded mono PCM before SVG generation. Video uploads use `ffmpeg` to generate H.264/AAC MP4 proxies controlled by the `VIDEO_PROXY_*` settings and served from the media-version preview endpoint. The Docker image installs both tools. Decoder command names, timeout, input/output limits, and maximum decoded audio duration are configured through the `PREVIEW_*`, `VIDEO_PROXY_*`, `PDF_PREVIEW_COMMAND`, and `FFMPEG_COMMAND` variables in `.env.example`. A decoder failure safely produces the generic review card instead of failing file processing.

## Schema and migrations

Django models and migrations are the database source of truth. `database-schema.sql` is retained only as historical design context.

For every schema change:

1. Update the model.
2. Generate a named migration.
3. Review the generated SQL and migration operations.
4. Run `makemigrations --check --dry-run`.
5. Run the complete test suite against PostgreSQL.
6. Update domain documentation and the implementation log when behavior changes.

Do not edit an already-deployed migration. The initial migration may only be replaced while no shared or production database depends on it.

## Design boundaries

- A workspace is the tenant boundary. Every service that handles tenant data must verify workspace consistency and authorization.
- Cross-table tenant checks are implemented with model `clean()` methods where SQL check constraints cannot follow foreign keys. Domain services must call `full_clean()` before saving these objects; bulk operations require equivalent explicit validation.
- Views should coordinate HTTP concerns; business transactions belong in domain service modules as they are introduced.
- Multi-row state transitions must use `transaction.atomic()` and database constraints where possible.
- Domain events are currently synchronous and process-local. They are not a durable queue and must not be used for work that cannot be lost.
- Use Django's password, permission, validation, and migration APIs instead of duplicating them.

## Testing and completion criteria

A change is complete when:

- behavior has positive and negative tests;
- tenant and permission boundaries are tested where relevant;
- `python manage.py check` passes;
- `python manage.py makemigrations --check --dry-run` reports no changes;
- `python manage.py test` passes against PostgreSQL;
- documentation reflects material architecture or setup changes.

CI runs these checks on every push and pull request.

## Suggested implementation order

1. Add email delivery, CSRF-aware frontend integration, authentication throttling, and password-reset APIs.
2. Configure private cloud storage and a production malware scanner backend.
3. Add decoded thumbnails/waveforms and retention-policy administration.
4. Add guest token rotation and export metrics to the production observability platform.

Avoid implementing all documented domains at once. Complete and test one end-to-end workflow before expanding the surface area.
