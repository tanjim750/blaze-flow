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
- additive workspace/project permission evaluation with `ALL` and `SELECTED` project scope
- authorized project listing, creation, detail, update, and archival
- protected system roles, custom role administration, and explicit project-access grants
- default-storage media uploads with project-wide version allocation and initial workflow history
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

Never commit `.env`. Deployment secrets belong in the target platform's secret manager.

## Authentication architecture

`app.User` is the one authoritative registered-user identity and is configured through `AUTH_USER_MODEL`. Email is the login identifier. Passwords are stored in Django's built-in encoded password field and must only be set through `set_password()`, `create_user()`, or `create_superuser()`.

User lifecycle status controls authentication: only `ACTIVE` users are considered active by Django's default authentication backend. `SUSPENDED` and `DELETED` users cannot authenticate.

OAuth providers should link through `OAuthIdentity`. An OAuth-only account must use `set_unusable_password()` until the owner configures a password. Do not introduce a second user or password table.

## Current API

All request and response bodies use JSON. Authentication uses Django's session cookie. A successful login returns a `csrf_token` and sets the corresponding CSRF cookie. Browser clients must retain both cookies and send the token in the `X-CSRFToken` header on authenticated unsafe requests.

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/health/` | Public | Application health response |
| `POST` | `/api/auth/register/` | Public | Register an email/password user |
| `POST` | `/api/auth/login/` | Public | Start a session |
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
| `POST` | `/api/workspaces/{workspace_id}/projects/{project_id}/media-versions/{media_version_id}/revision-requests/` | Comment creator/media transitioner | Create feedback and request a workflow revision |
| `POST` | `/api/workspaces/{workspace_id}/projects/{project_id}/media-versions/{media_version_id}/comments/{comment_id}/attachments/` | Comment author | Upload a verified private attachment |
| `GET/DELETE` | `/api/workspaces/{workspace_id}/projects/{project_id}/media-versions/{media_version_id}/comments/{comment_id}/attachments/{content_id}/` | Comment reader/author-manager | Download or soft-delete an attachment |
| `GET/POST` | `/api/workspaces/{workspace_id}/projects/{project_id}/media-versions/{media_version_id}/annotations/` | Annotation reader/creator | List or create visual markup |
| `PATCH/DELETE` | `/api/workspaces/{workspace_id}/projects/{project_id}/media-versions/{media_version_id}/annotations/{annotation_id}/` | Author/annotation manager | Replace own markup or soft-delete it |
| `GET` | `/api/workspaces/{workspace_id}/projects/{project_id}/media-versions/{media_version_id}/annotations/{annotation_id}/revisions/` | Annotation reader | Read immutable annotation snapshots |
| `GET` | `/api/workspaces/{workspace_id}/delivery-health/` | Workspace manager | Read delivery/outbox status counts |
| `GET` | `/api/notifications/` | Authenticated recipient | List own notifications; `?unread=true` filters unread |
| `GET/PATCH` | `/api/notification-preferences/` | Authenticated user | Read or update mention-email preference |
| `POST` | `/api/notifications/{notification_id}/read/` | Notification recipient | Idempotently mark one notification read |
| `POST` | `/api/notifications/read-all/` | Authenticated recipient | Mark all own unread notifications read |

Registration fields are `email`, `password`, `first_name`, `last_name`, and optional `timezone`. Workspace creation fields are `name`, optional `slug`, and a required IANA `timezone` such as `Europe/London`.

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

`FILE_SECURITY_SCANNER` selects a scanner class with a `name` attribute and `scan(stream)` method returning at least `{"clean": true|false}`. The default `EicarAwareScanner` is only a development/test integration backend. Configure a maintained malware product or service before production. Storage writes are compensated if database creation fails.

Soft deletion marks an attachment, its File, and generated variants. `REVIEW_FILE_RETENTION_DAYS` defaults to 30. Operators should preview and then schedule physical cleanup:

```bash
python manage.py purge_review_files --dry-run
python manage.py purge_review_files --limit 100
```

The cleanup service only targets soft-deleted review attachments older than the retention window. It deletes the private original and all variants but preserves database and audit rows with `metadata.physical_deleted_at`. Storage failures produce a non-zero command exit and remain retryable.

## Guest reviews

Workspace collaborators with `review.comment.manage` can create a project guest invite. The raw invite token is returned once. Exchange it at `POST /api/guest-access/exchange/`; the resulting access key is also returned once and must be sent as `X-Guest-Access-Key` to `/api/guest/reviews/...` endpoints.

Supported scoped permissions are `media.read`, `media.download`, `review.comment.read`, `review.comment.create`, `review.attachment.create`, `annotation.read`, and `annotation.create`. Guests with the attachment capability can upload only to their own comments; uploads enter the same quarantine, scan, and preview pipeline as member uploads.

Invite permissions are copied onto the access grant at exchange so later invite edits cannot silently broaden an active guest session. Both secret types are stored only as SHA-256 hashes. Managers can list invites and exchanged sessions, revoke one access session, or revoke an invite and all active access derived from it. Revocation is immediate and audited.

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
