# Blaze Flow Implementation Log

This is a living, chronological record of completed engineering work and consequential decisions. Add an entry in the same pull request as any material architecture, infrastructure, schema, or product change.

Each entry should state what changed, why, verification performed, known limitations, and the recommended next step. Product aspirations belong in `docs/implementations/domain_and_features.md`, not here.

## 2026-09-01 — Three milestones: attachments, annotations, and worker operations

### Delivered

1. **Secure review attachments**
   - Added author-scoped multipart attachment upload to existing Review Comment Content and File records.
   - Added byte-signature verification for PNG, JPEG, GIF, WebP, PDF, WAV, and MP3, a separate size limit, SHA-256 checksums, opaque storage keys, and storage compensation on database failure.
   - Added project-authorized private download, author/manager soft deletion, attachment metadata in comment responses, and upload/download/delete audit events.
2. **Visual annotations**
   - Added `annotation.read`, `annotation.create`, and `annotation.manage` permissions with migration `0010` backfill.
   - Added create/list/edit/delete/history APIs using the existing Annotation, Element, and Revision schema.
   - Added POINT, RECTANGLE, ELLIPSE, ARROW, PATH, and TEXT validation with normalized `0..1` coordinates, shape bounds, path limits, deterministic element order, optional comment linkage, and millisecond targeting.
   - Enforced author-only editing with full pre-edit snapshots and manager-controlled soft deletion.
3. **Worker supervision and delivery monitoring**
   - Added a continuous `run_outbox_worker` command with bounded batch/interval settings and stale-connection cleanup.
   - Added a restartable Compose worker service using the same application image and environment.
   - Added a workspace-manager delivery-health endpoint with outbox and email-delivery status counts.

### Decisions

- Attachment object keys and storage URLs remain private; attachment downloads always pass through application authorization.
- Attachment deletion is logical. Database/storage metadata remains available for audit and later retention cleanup.
- Annotation edits replace the full ordered element collection and preserve the prior complete state as one immutable revision.
- Geometry validation is tool-specific and normalized so markup remains resolution-independent.
- Worker supervision belongs to the deployment process, while event claiming/retry/idempotency stays in the domain service.

### Known limitations

- Attachment malware scanning, quarantine, thumbnail/waveform generation, physical retention cleanup, and cloud multipart upload are not implemented.
- PDF/audio verification is signature-level and does not deeply decode content.
- Annotation style/payload schemas are intentionally open beyond required TEXT payload and normalized geometry rules; frontend tool versioning is not implemented.
- Delivery health is a count snapshot, not metrics export, alerting, or a dead-letter inspection dashboard.
- The development Compose worker is supervised by Docker restart policy; production should use its platform's process manager and observability stack.

### Verification

- Seventy tests pass with migrations `0001` through `0010` applied.
- New tests cover signature/checksum attachment behavior, private download, soft deletion, spoof rejection, normalized geometry, author-only annotation edits, immutable annotation revisions, manager deletion, delivery-health authorization, and worker command loading.
- Django checks, migration drift checks, Postman JSON validation, Compose validation, Python compilation, and whitespace checks pass.

### Next recommended milestone

Add malware scanning/quarantine and asynchronous attachment previews, then implement guest review access for comments, attachments, and annotations.

## 2026-09-01 — Email notification delivery, preferences, and dead letters

### Delivered

- Added per-user `email_mentions_enabled` preferences with authenticated read/update APIs.
- Added per-notification email delivery records with unique notification/channel identity, attempt counts, status, error details, and sent timestamps.
- Registered an idempotent `notification.created` email consumer using Django's configured email backend.
- Added environment-driven SMTP/backend, sender, application-link, and outbox retry settings with a safe console backend default.
- Added exponential retry scheduling with a configurable maximum delay and terminal `DEAD_LETTER` status.
- Added stale worker recovery plus an explicit `requeue_dead_letters` operator command.
- Sanitized actor display names before using them in email subjects and retained in-app notifications when email delivery is disabled.
- Added migration `0009`, preference requests to Postman, and delivery/backoff/dead-letter tests.

### Decisions

- Email delivery runs only from the outbox processor, never in the web request that creates a comment.
- Preferences affect future processing. Disabling mention email produces a durable `SKIPPED` delivery while leaving the in-app inbox unchanged.
- A `SENT` or `SKIPPED` delivery is idempotent and will not be attempted again.
- SMTP is inherently at-least-once around process crashes; database delivery identity prevents normal retries after a confirmed send, but a crash between SMTP acceptance and the final database update can still duplicate an email.
- Dead-letter events require deliberate operator requeue after the underlying problem is corrected.

### Known limitations

- Email is plain text; branded HTML templates and localization are not implemented.
- There is no hosted background-worker process in Compose yet; deployments must schedule or supervise `process_outbox`.
- There is no administrative dead-letter dashboard or alert integration.
- Notification preferences currently cover mention email only.

### Verification

- Sixty-four tests pass with migrations `0001` through `0009` applied.
- Tests cover successful and idempotent email delivery, opt-out skipping, exponential scheduling, attempt exhaustion, dead-letter requeue, plus the earlier notification security and transaction cases.
- Django checks, migration drift checks, command discovery, Postman JSON validation, Compose validation, Python compilation, and whitespace checks pass.

### Next recommended milestone

See the later three-milestone entry for attachments, annotations, worker supervision, and delivery health.

## 2026-09-01 — Structured mentions and durable notification outbox

### Delivered

- Added structured `mentioned_user_ids` to comment creation, editing, and revision requests.
- Added durable Comment Mention rows with per-comment/per-user uniqueness.
- Restricted mention targets to active users who currently have `review.comment.read` access to the Project; self-mentions are ignored and duplicate IDs are deduplicated.
- Added recipient-owned in-app notifications with unread filtering, idempotent single-read, and read-all endpoints.
- Added a transactional outbox with deduplication keys, delivery status, attempts, error capture, locking, retry, and stale-claim recovery.
- Added `process_outbox` to publish durable events through the existing domain-event dispatcher.
- Made comment, mention, notification, and outbox creation one transaction.
- Preserved notifications when mentions are removed and prevented repeat delivery when the same user is re-mentioned on the same comment.
- Added migration `0008`, Postman mention/inbox requests, and end-to-end notification tests.

### Decisions

- Mentions are explicit user UUIDs, not names parsed from free text. This avoids ambiguous identity and keeps rendering separate from notification delivery.
- The in-app Notification is the immediate user-facing record. The Outbox Event is the durable integration hook for email, push, WebSocket, or other handlers.
- Outbox delivery is at-least-once. Consumers must process the notification ID idempotently.
- Removed mentions remove the active relationship but do not retract historical notifications.

### Known limitations

- Push, WebSocket, and mobile handlers are not registered; the later email-delivery entry supersedes the email limitation.
- The later email-delivery entry supersedes the retry-backoff and dead-letter limitation.
- Notification lists are not paginated and there are no per-user delivery preferences.
- Reply-author, assignment, workflow, and resolution notifications are not implemented yet.

### Verification

- Sixty-one tests pass with migrations `0001` through `0008` applied.
- Tests cover mention eligibility, self/duplicate handling, edit synchronization, notification deduplication, inbox isolation, idempotent reads, outbox failure/retry, stale-claim recovery, and transaction rollback.
- Django checks, migration drift checks, Postman JSON validation, Compose validation, Python compilation, and whitespace checks pass.

### Next recommended milestone

See the later email-delivery, preferences, and dead-letter milestone above.

## 2026-09-01 — Timestamped review comments and revision requests

### Delivered

- Added `review.comment.read`, `review.comment.create`, and `review.comment.manage` permissions to the application registry and system roles, with migration `0007` for existing workspaces.
- Added authorized creation and listing of general, point-in-time, and time-range text comments.
- Added arbitrary-depth replies scoped to the same Media Version; replies inherit timing from their parent thread.
- Added author-only text editing with an immutable full-content snapshot written before every meaningful edit.
- Added comment revision-history reads.
- Added manager-controlled thread resolution/reopening and recursive soft deletion of descendant replies.
- Added an atomic revision-request operation that creates feedback and moves the Media Version to the workspace's active Revision stage.
- Added durable audit records for comment creation, editing, resolution, reopening, deletion, and revision requests.
- Expanded the Postman collection and testing guide for the complete review-comment lifecycle.

### Decisions

- This milestone exposes text comment content only. The existing multi-content schema remains the extension point for later audio, image, and file attachments.
- `review.comment.create` also authorizes editing, but the service independently enforces original-user authorship.
- `review.comment.manage` controls resolution, reopening, and deletion; authorship alone does not grant moderation.
- Revision requests compose the existing comment and workflow domains in one database transaction instead of adding a duplicate revision-request table.
- Requesting another revision while already in the Revision stage creates the additional feedback without manufacturing a no-op workflow history entry.

### Known limitations

- Guest-session commenting, reactions, pagination, and comment attachments are not implemented; the later notification entry supersedes the mention/notification limitation.
- Active comments are returned as a flat creation-ordered list with `parent_comment_id`; clients assemble the visible thread tree.
- Deleted comments and their retained revisions do not yet have a moderator-facing recovery/history endpoint.
- Comment lists currently use straightforward per-comment content/revision lookups and will need prefetching or denormalized counts before high-volume use.

### Verification

- Fifty-four tests pass with migrations `0001` through `0007` applied.
- Review tests cover timestamp ranges, reply inheritance, cross-media parents, author-only editing, immutable snapshots, management permission, resolve/reopen, recursive soft deletion, outsider denial, revision-stage behavior, and transactional rollback.
- Django checks, migration drift checks, Postman JSON validation, Compose validation, and whitespace checks pass.

### Next recommended milestone

See the later structured-mentions and durable-notification-outbox milestone above.

## 2026-09-01 — Verified media, private downloads, and workflow transitions

### Delivered

- Added byte-signature detection for PNG, JPEG, GIF, WebP, MP4, QuickTime, and WebM uploads and rejected declared MIME types that do not match their contents.
- Persisted a SHA-256 checksum for every accepted media file.
- Added `media.download` and `media.transition` permissions to new system roles and migration `0006` to backfill existing system roles.
- Added authorized private downloads gated by both project permission and the Media Version `allow_download` flag.
- Added a read-only workspace workflow-stage endpoint so clients can discover valid transition targets.
- Added transactional workflow transitions that lock the Media Version, close its current entry, create one new open entry, and reject no-op transitions.
- Added ordered stage-history responses and durable audit records for upload, download, and transition actions.
- Expanded the Postman collection and manual guide to cover stage discovery, download, transition, and history.

### Decisions

- API responses expose safe file metadata, never storage object keys or public URLs.
- Content verification uses an explicit supported-signature allowlist; a client-provided MIME header is not trusted by itself.
- Downloads remain application-authorized and storage-agnostic through Django `default_storage`.
- Audit creation participates in the same database transaction as uploads and workflow transitions.

### Known limitations

- Signature inspection is not malware scanning or deep media decoding; production storage still requires antivirus scanning and quarantine handling.
- Local `FileSystemStorage` is suitable only for development. Production needs private durable object storage and deployment-specific delivery controls.
- Download audit creation occurs before the streaming response completes, so it records authorization/start rather than confirmed full transfer.
- Workflow-stage administration is not yet implemented; the later review-comments entry supersedes the comment limitation.

### Verification

- Forty-six tests pass with migrations `0001` through `0006` applied.
- Tests cover MIME spoofing, checksums, upload/download/transition audits, download policy, ordered stage discovery, transition history, and duplicate-transition rejection.
- Django checks, migration drift checks, collection JSON validation, Compose validation, and whitespace checks pass.

### Next recommended milestone

See the later timestamped review-comments and revision-request milestone above.

## 2026-09-01 — Postman collection aligned with executable API

- Fixed public Register/Login so an existing stale session cookie does not trigger SessionAuthentication CSRF rejection before `AllowAny` is evaluated.
- Rebuilt the Postman collection from the current Django routes and serializer contracts.
- Removed unsupported role/member/invitation/access methods and corrected role, grant, project, and media payloads.
- Added collection variables and response scripts for CSRF, workspace, role, membership, invitation, project, grant, and media identifiers.
- Added correct session switching instructions for the owner and invited-member flow.
- Replaced the pre-created administrator claim with the actual registration workflow.
- Documented cleanup ordering so archival or revocation requests do not invalidate later manual tests.

## 2026-09-01 — Transactional media upload and workflow initialization

### Delivered

- Added `media.create` and `media.read` permission keys to system roles and the permission registry.
- Provisioned six default workflow stages for new workspaces and backfilled existing workspaces.
- Added configurable media roots and upload-size limits.
- Implemented authorized multipart image/video upload, list, and detail endpoints.
- Added opaque default-storage object paths and centralized File persistence.
- Implemented project-row locking and monotonically increasing project-wide version allocation.
- Created the File, Media Version, counter update, and initial open stage entry in one database transaction.
- Added compensating object deletion when database work fails after storage succeeds.
- Added migration `0005` for existing system-role permissions and workspace stages.

### Decisions

- Django `default_storage` is the runtime abstraction; StorageBackend rows provide provenance rather than credentials.
- Storage keys remain internal and are not returned by media serializers.
- Every review upload creates a new immutable Media Version.
- Version allocation uses the locked Project counter rather than `MAX(version_number) + 1`.
- Storage failures use explicit compensation because object stores cannot participate in PostgreSQL transactions.

### Known limitations

- This entry records the upload milestone at the time it shipped; later entries supersede its MIME/checksum/download limitations.
- Malware scanning, transcoding, thumbnails, cloud credentials, and progress reporting are not implemented.
- PostgreSQL row-lock concurrency does not yet have a dedicated parallel integration test.
- Workflow transitions and review comments are not implemented.

### Verification

- Forty tests pass with migrations `0001` through `0005` applied.
- Tests cover version sequencing, initial history, invalid files, selected-project authorization, cross-user denial, transaction rollback, counter rollback, and compensating storage deletion.
- Django checks, migration drift checks, Compose validation, and whitespace checks pass.

### Next recommended milestone

See the later verified-media and workflow-transition milestone above.

## 2026-08-31 — Custom roles and explicit project-access administration

### Delivered

- Added protected-system metadata to workspace roles and a data migration that marks existing `Owner` and `Member` roles as system-managed.
- Added a case-insensitive workspace role-name constraint.
- Centralized the accepted application permission vocabulary in `app/permissions.py`.
- Added custom role creation, permission replacement, descriptive updates, and lifecycle archival APIs.
- Prevented modification or archival of system roles.
- Prevented archival of a custom role while active memberships still reference it.
- Added explicit project grant listing, creation, and revocation for `SELECTED` memberships.
- Enforced active-membership, selected-scope, duplicate-grant, and same-workspace rules in the resource-access service.
- Added migration `0004` for system-role metadata, legacy-role backfill, and case-insensitive uniqueness.

### Decisions

- Permission keys must come from the application registry; arbitrary database strings are not accepted by public APIs.
- System roles are provisioned and protected by the application. Organizations customize authorization by creating separate roles.
- Role deletion archives the role. It never destroys historical role identity.
- Explicit project grants are managed by workspace member managers and apply only to `SELECTED` memberships.

### Known limitations

- Permission keys are still a compact MVP vocabulary and will grow as media, files, comments, and tasks become executable domains.
- Role and access changes do not emit durable audit events yet.
- Grant APIs are not paginated and there is no bulk grant operation.

### Verification

- Thirty-five tests pass against a clean fully migrated database.
- Tests cover system-role protection, custom role lifecycle, case-insensitive names, unauthorized permission escalation, grant duplication, selected-scope requirements, access activation, and immediate revocation.
- Django checks, migration drift checks, Compose validation, and patch whitespace checks pass.

### Next recommended milestone

Implement the storage adapter and transactional media upload flow, including safe project-level version allocation and the required initial workflow-stage entry.

## 2026-08-31 — Permission engine, member invitations, and project API

### Delivered

- Added a central permission-key registry and effective-access evaluator for active direct memberships and inherited Client Team memberships.
- Implemented additive workspace permission checks plus `ALL` and explicit `SELECTED` project scope evaluation.
- Provisioned a limited system `Member` role alongside the existing `Owner` role for every new workspace.
- Added workspace role and membership listing plus protected role, project-scope, and lifecycle updates.
- Protected the primary-owner membership from modification through the general membership endpoint.
- Added single-use, expiring workspace invitations. Raw tokens are returned once; only SHA-256 hashes are stored.
- Made invitation acceptance email-bound and transactional, with support for reactivating removed direct memberships.
- Added authorized workspace listing and project list/create/detail/update/archive endpoints.
- Made project creation grant the creating `SELECTED` membership explicit access in the same transaction.
- Added cross-workspace and mismatched-route protections to project access.
- Added migration `0003` for workspace invitations and acceptance consistency.

### Decisions

- Permission grants are additive; Blaze Flow still has no explicit deny mechanism.
- Client Team members inherit the active team's workspace membership rather than receiving duplicate direct grants.
- Invitation delivery is outside the current backend slice. The raw token must never be logged or stored after delivery.
- Project deletion is soft lifecycle archival through `ProjectStatus.ARCHIVED`.
- A user's permission key and project scope must both authorize a project action.

### Known limitations

- There is no email provider integration, invitation resend UI, or invitation revocation API.
- Fine-grained media/file permission keys are not implemented.
- Project responses are not paginated and there is no activity/audit event emitted yet.
- Concurrent authorization changes are protected by database state but do not yet use a permission cache or audit trail.

### Verification

- Twenty-eight tests pass against a clean database with all migrations applied.
- Tests cover direct and inherited permissions, hashed and email-bound invitations, token reuse, primary-owner protection, project action permissions, selected scope, creator grants, and cross-tenant denial.
- System checks and migration drift checks pass.

### Next recommended milestone

Add custom role and project-access administration, then implement the storage adapter and transactional media upload/version allocation flow.

## 2026-08-31 — Authentication and workspace vertical slice

### Delivered

- Added public registration and session-login endpoints plus authenticated logout and current-user endpoints.
- Added password-policy validation, case-insensitive email handling and database uniqueness, duplicate-account protection, and safe response serializers that never expose password hashes.
- Added authenticated workspace creation with IANA timezone and slug validation.
- Implemented workspace creation as one transaction that provisions the workspace, system `Owner` role, initial owner permissions, and active primary-owner membership.
- Added database check constraints for membership principal shape, owner eligibility, and exactly-one comment/annotation authorship.
- Added conditional unique constraints for one active workspace owner, one open media stage entry, and one current user subscription.
- Added tenant-consistency validation for membership roles/client teams, resource access, workflow entries, tasks, task members, attachments, project folders, and project files.
- Added migration `0002` without rewriting the completed authentication foundation migration.
- Expanded the suite to cover API authentication, password safety, CSRF enforcement, duplicate and suspended accounts, anonymous access, workspace owner provisioning, transactional rollback, duplicate ownership, authorship, workflow, subscription, and cross-workspace failures.

### Decisions

- Session authentication is the current browser-facing authentication mechanism. Token/JWT authentication will only be introduced for a concrete non-browser client requirement.
- Workspace creation owns all initial authorization provisioning; callers cannot create a workspace without its primary owner.
- Cross-row invariants are database constraints whenever PostgreSQL can express them. Cross-table tenant consistency remains explicit model/service validation because SQL check constraints cannot reference related tables.
- Owner permissions use application-defined keys and are provisioned as role-permission records.

### Known limitations

- Login and registration throttling, email verification, password reset, and OAuth callbacks are not implemented.
- The workspace endpoint currently creates workspaces only; listing and detail APIs are pending.
- There is no workspace permission-evaluation service yet, so project and membership APIs must not be exposed until it exists.
- A frontend must implement Django session-cookie and CSRF handling correctly.

### Verification

- Django system checks pass.
- Migration drift checks report no changes.
- Twenty tests pass against a clean migrated test database.
- PostgreSQL execution remains configured in CI.

### Next recommended milestone

Implement permission evaluation and workspace membership administration, then expose workspace-scoped project CRUD with cross-tenant denial tests.

## 2026-08-31 — Backend foundation and unified authentication

### Delivered

- Removed generated Python bytecode and macOS AppleDouble files from the checkout and Git object store.
- Added ignore rules for Python build artifacts, local environments, coverage output, and AppleDouble metadata.
- Moved Django secret, debug, host, and PostgreSQL configuration to environment variables.
- Made non-debug startup fail clearly when `DJANGO_SECRET_KEY` is missing.
- Converted `app.User` into the project's Django custom user model using a UUID primary key and email login.
- Added a migration-safe custom user manager with password hashing and superuser validation.
- Connected user lifecycle states to Django authentication so suspended and deleted users cannot log in.
- Added Django admin creation and editing support for the custom user.
- Removed the separate `PasswordCredential` model. Django's encoded password field is now authoritative.
- Regenerated the pre-production initial migration around the custom user model.
- Added tests for password hashing, email authentication, suspended-user rejection, superuser flags, and the health endpoint.
- Added PostgreSQL-backed CI checks for system configuration, migration drift, migrations, and tests.
- Declared Django models and migrations as the executable schema source of truth. The hand-written SQL file is historical reference only.

### Decisions

- Registered identities must not be split between Django's built-in user and a separate domain user.
- Password handling will use Django's maintained, versioned hashing framework.
- OAuth identities remain separate provider records, but always resolve to `app.User`.
- The initial migration can be regenerated because the project is still pre-production and no shared data migration contract has been established.

### Known limitations

- Registration, login/logout, password reset, and OAuth HTTP APIs are not implemented.
- Most documented cross-row and cross-tenant invariants still need database constraints or service validation.
- The in-process event dispatcher is not durable.
- Docker BuildKit may fail when the checkout is kept on the current external-drive filesystem because macOS recreates unreadable AppleDouble metadata.

### Next recommended milestone

Add database constraints for principal/authorship/ownership invariants, followed by a tested registration and workspace-creation transaction.
