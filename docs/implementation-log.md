# Blaze Flow Implementation Log

This is a living, chronological record of completed engineering work and consequential decisions. Add an entry in the same pull request as any material architecture, infrastructure, schema, or product change.

Each entry should state what changed, why, verification performed, known limitations, and the recommended next step. Product aspirations belong in `docs/implementations/domain_and_features.md`, not here.

## 2026-09-10 — Files keyboard accessibility and mobile polish

### Delivered

- Added N/U shortcuts for folder creation and upload, plus select-all-visible across the active
  filtered result set.
- Upgraded every Files modal with dialog semantics, accessible naming, Escape dismissal, contained
  Tab navigation, initial focus, and focus restoration to the triggering control.
- Added consistent focus-visible styling and made hidden selection controls appear for keyboard
  focus as well as pointer hover.
- Reworked narrow-screen controls into responsive filter grids, wrapping bulk actions, condensed
  metadata, and a fixed bottom create/upload dock.

### Verification

- Frontend TypeScript, ESLint, and Vitest passed (4 files / 10 tests), including keyboard dialog
  and select-all interaction coverage. The live development frontend and backend health endpoint
  returned successfully; a production rebuild was intentionally skipped while the dev server was active.

### Known limitations and next step

- The remaining major Files milestone is replacing local mock persistence with workspace-level
  backend asset endpoints that support nullable Client, Project, and Folder relationships.

## 2026-09-10 — Bulk assignment, resilient uploads, and richer previews

### Delivered

- Added bulk Client, Project, and destination-folder assignment to the selection toolbar. Moving a
  selected parent and child preserves their hierarchy, and contained selected files are not
  accidentally flattened into the destination.
- Added upload preparation progress, cancellation, retained retry state, and disabled controls
  while work is active.
- Upgraded creative previews with authenticated image thumbnails, inline browser video frames,
  expanded audio waveform plates, and extension badges for documents and source files.
- Added focused data-layer coverage for hierarchy-preserving bulk assignment.

### Verification

- Frontend TypeScript, ESLint, Vitest, production build, and diff hygiene passed.

### Known limitations and next step

- Progress currently represents client-side preparation because mock assets are stored locally.
  Connect it to transport-level progress and server retry identifiers when workspace asset upload
  endpoints are available.

## 2026-09-10 — Files search, bulk actions, upload staging, and details

### Delivered

- Added an explicit recursive-search mode that finds matching assets across nested folders while
  retaining current-location search as the default.
- Added accessible file/folder selection and a sticky bulk-action bar. Bulk folder deletion removes
  every descendant folder and contained file through a single reusable data-layer operation.
- Upgraded uploads with drag-and-drop staging, visible file names/types/sizes, an item count, and a
  disabled submit action until valid files are ready.
- Added a details action and modal for file format, size, ownership, timestamps, and Client/Project
  relationship metadata, with an equivalent created-by view for folders.

### Verification

- `npx tsc --noEmit`, `npm run lint`, and `npm test` passed (4 files / 8 tests). The production
  build and diff hygiene passed after the changes.

### Known limitations and next step

- This milestone was superseded by the bulk-assignment milestone above.

## 2026-09-10 — Files organization controls and relationship safety

### Delivered

- Added Client, Project, and creative file-type filters plus newest, alphabetical, and file-size
  sorting to the shared Files library.
- Added responsive card and compact-list presentations with accessible pressed-state controls.
- Made folder reassignment cascade Client/Project ownership through every nested folder and file,
  and removed descendant folders from move targets so users cannot create circular hierarchies.
- Added component coverage for folder creation, shared Project visibility, and density switching,
  plus unit coverage for recursive assignment behavior.

### Verification

- `npx tsc --noEmit`, `npm run lint`, and `npm test` passed (4 files / 6 tests). The production
  build and diff hygiene passed after the changes.

### Known limitations and next step

- Filtering is scoped to the open folder rather than searching recursively across every nested
  location. Add an explicit workspace-wide search mode when the backend asset API can provide
  indexed results and pagination.

## 2026-09-09 — Shared creative Files library

### Delivered

- Rebuilt `/files` as a media-focused asset library with standalone files, visual folder previews,
  nested browsing, breadcrumbs, search, empty/loading states, multi-file upload, and folder creation.
- Added explicit nullable Client → Project → Folder relationships to frontend file/folder entities,
  realistic persisted mock assets, creative type detection, previews, and contextual rename, move,
  assignment, download, and delete actions.
- Added a Files tab to each project using the same asset-library component and entity store, so the
  project screen filters shared objects instead of duplicating them.
- Added focused tests for creative file classification and shared project projections.

### Verification

- Frontend TypeScript, ESLint, Vitest, production build, and diff hygiene were run successfully.

### Known limitations and next step

- The backend currently requires every project-file row to belong to a project. Unassigned assets
  and frontend mutations therefore persist in localStorage for now; Blob URLs survive only the
  current browser session, small image previews are persisted, and folder download produces a
  manifest. Add workspace-level asset endpoints with nullable client/project/folder ownership, then
  swap the store adapter without changing the component contract.

## 2026-09-09 — Browser smoke coverage, canvas movement, and render controls

### Delivered

- Added Playwright configuration plus separate authenticated review and client-administration smoke
  suites. They require explicit isolated-account credentials, so a developer cannot accidentally
  mutate a personal or production workspace; Vitest explicitly excludes the browser specs.
- Annotation authors can now drag points, text, bounded shapes, arrows, and paths directly on the
  canvas. Movement is clamped to normalized media bounds and persists through the revision-producing
  annotation update endpoint.
- Added permission-backed media render control: queued/failed work can be cancelled, and cancelled
  or failed work can be reset to pending. Running jobs return 409 because the current in-process
  worker cannot be safely interrupted, and ready previews cannot be reprocessed accidentally.
- Render Queue now exposes the valid Retry/Cancel actions and reports cancelled durable events.

### Verification

- `npx tsc --noEmit`, `npm run lint`, `npm test` (2 files / 2 tests), Playwright discovery (2 specs),
  and `npm run build` passed. The local Playwright invocation skipped both specs as designed because
  isolated `E2E_*` credentials were not supplied.
- Docker ran 20 focused media/project-file tests successfully, including the new render cancel/retry
  contract. Python compilation, Compose validation, and `git diff --check` also passed.

### Known limitations and next step

- Direct dragging moves all geometry, while resizing remains an incremental control for rectangles
  and ellipses; arrows/path endpoints and text sizing need dedicated handles. Run the Playwright
  suite against a seeded CI workspace next.

## 2026-09-09 — Render visibility, Help, review editing, and client access

### Delivered

- Built `/render-queue` from real media-version data and added `preview_status` to the media API,
  reflecting the latest proxy variant as pending, processing, ready, or failed.
- Built `/help` with shortcuts and a concise organize → review → approve → deliver guide. All shell
  navigation targets now resolve.
- Added text annotations and bounded-shape geometry resizing alongside the existing drawing/color
  controls, and added permission-backed deletion for review-comment attachments.
- Expanded Clients with existing-account member add/remove and expiring email or reusable-link
  invitations, including one-time token copy and revocation.

### Verification

- `npx tsc --noEmit`, `npm run lint`, `npm test` (2 files / 2 tests), and `npm run build` passed.
  The production route manifest includes `/render-queue` and `/help` (21 routes including framework
  routes).
- Python compilation, Docker Compose configuration validation, and `git diff --check` passed.
- Django execution remains unavailable in the host Python environment because Django is not
  installed outside the application container.

### Known limitations and next step

- Render Queue is observability-only because no retry/cancel endpoint exists. Annotation geometry
  resizing is a controlled increment rather than direct canvas handles. Add browser end-to-end tests
  next, then worker-control endpoints and full annotation manipulation.

## 2026-09-09 — Clients, file lifecycle, richer annotations, and notification controls

### Delivered

- Built `/clients` with real client-team data, assigned-project summaries, contact links, and
  permission-backed create, edit, and archive actions.
- Completed project-file actions with delete and a new authenticated download stream. Downloads
  require project read permission, a `READY` security state, and an existing storage object.
- Expanded review annotations to points, rectangles, ellipses, arrows, and freehand paths. Authors
  can cycle annotation colors (persisting an annotation revision), and authorized managers can
  delete annotations.
- Notification items now mark themselves read and route review mentions to the referenced project
  and media version. Settings now exposes the API's email-mention preference.

### Verification

- `npx tsc --noEmit`, `npm run lint`, and `npm test` passed (2 files / 2 tests).
- Python compilation, Docker Compose configuration validation, and `git diff --check` passed.
- The host Python environment does not include Django, so the added project-file download test was
  not executable outside the project container during this pass.

### Known limitations and next step

- Annotation color editing is implemented, but direct geometry handles and text annotations remain.
  Clients does not yet manage client-team members/invites. Build Render Queue and Help next, then
  deepen those two surfaces.

## 2026-09-09 — Review annotations, scoped access, and live shell status

### Delivered

- Added point placement to the signed-in review player. Coordinates are normalized to the media
  stage, tied to the active timecode, persisted through the annotation API, and rendered on reload.
- Added review-comment attachment upload for the signed-in comment author, processing-state labels,
  and authenticated downloads once scanning reports the file `READY`.
- Added selected-project access administration to Team & Roles: managers can choose a member and
  project, create the existing resource-access grant, and revoke individual grants.
- Replaced the shell's decorative notification dot and hardcoded render node with a real notification
  popover, mark-all-read action, and workspace operations-health status. Non-manager health requests
  show the API's restricted state rather than implying the worker is healthy.
- Cleared React 19 effect-lint regressions in the guest-review/share surfaces encountered by the
  full verification pass.

### Verification

- `npm test`: 2 files / 2 tests passed.
- `npx tsc --noEmit`, `npm run lint`, and `npm run build` passed; the production build generated all
  15 application routes.

### Known limitations and next step

- Annotation creation is point-only; shapes, editing, and deletion remain. Attachments can be
  downloaded but not deleted in the signed-in UI. Notifications support mark-all-read, not per-item
  navigation or preferences. Build `/clients` next, then deepen those interactions.

## 2026-09-09 — Frontend account-access flows

### Delivered

- Added the four missing pre-session routes, all against endpoints that already existed: `/sign-up` (register, then an automatic sign-in, sending the browser's IANA timezone), `/forgot-password` (enumeration-safe reset request), `/reset-password`, and `/verify-email`. The last two are the targets of `PASSWORD_RESET_URL` and `EMAIL_VERIFICATION_URL`, which Django has always pointed at `/reset-password` and `/verify-email` — those emailed links previously 404'd.
- Added sign-out: a topbar account menu showing the real signed-in user's name, email, and initials, submitting to a new `signOutAction`. The action calls `POST /auth/logout/` and then deletes `sessionid`/`csrftoken` from the browser jar, because a server-side fetch's `Set-Cookie` never reaches the browser. The shell previously hardcoded the initials "AR" and linked the avatar to `/sign-in`.
- Moved the five pre-session pages into an `(auth)` route group with one shared split-screen layout and stylesheet, replacing the markup that had been inline in `sign-in/page.tsx`. The group adds no path segment, so every URL is unchanged. Reformatted the sign-in page, which had been written as a single 1,600-character line, and wired its previously inert "Forgot password?" and "Create an account" links.
- Added `src/lib/errors.ts`: one `describeErrorBody` used by both the server API client and the new browser auth client. `lib/api` previously read only `body.detail` and fell back to a 300-character slice of the raw body, so DRF field errors reached users as raw JSON. Now `{"password": ["This password is too short."]}` reads "Password: This password is too short.", and `non_field_errors`, HTML error pages, empty bodies, and throttle responses are all handled.
- Added `src/lib/auth-client.ts` (browser-side public auth endpoints) and `src/lib/user.ts` (name/initials helpers, moved out of `lib/session` so a client component can import them without pulling `next/headers` into the browser bundle — the same constraint that already forced `lib/timecode` to be its own module).
- Added `logout`, `changePassword`, and `requestEmailVerification` to `lib/api`.

### Decisions and boundaries

- Email verification requires a click rather than confirming on page load. Tokens are single-use, and mail clients and link scanners routinely prefetch URLs, so an automatic confirm would let a prefetch burn the token before the recipient opened the page.
- Reset and resend confirmations repeat the API's hedge ("if an active account exists") instead of asserting an email was sent, preserving the enumeration safety the 202 responses are designed for.
- Registration is two calls because Django's register endpoint does not open a session. When registration succeeds and the follow-up sign-in fails, the page says the account was created and asks the user to sign in, rather than implying nothing happened.
- The public auth endpoints are called from the browser; `logout` and `password/change` are session-authenticated and CSRF-enforced, so they run server-side where `authHeaders()` already supplies `X-CSRFToken`.
- Google sign-in was left out. The button stays inert because wiring it needs a client id and the GIS handshake, and shipping an OAuth path that cannot be exercised here would be worse than a documented gap.

### Verification

Docker's daemon was unavailable on this host, so verification ran against a real Django dev server on file-backed SQLite (scratchpad settings overlay, console email backend) with the Next dev server in front of it. Every result below is from that pair, driven over HTTP through the Next `/api/*` rewrite:

- Registration: 201 for a valid payload; 400 with both password-validator messages for a weak one.
- Login: 200 with `csrf_token` plus `sessionid`/`csrftoken` cookies; 400 `non_field_errors` for a wrong password.
- Sign-out, invoked as the real server action (matching `Next-Action` id): both cookies cleared with a past expiry, `x-action-redirect: /sign-in;push`, and `/auth/me/` 403 afterwards. Logout without the CSRF header is correctly refused ("CSRF Failed: CSRF token missing"), with it returns 204.
- Password reset: the emailed link rendered the form, confirm returned 204, the new password authenticated, the old one was rejected, and reusing the token returned the expected "invalid or expired".
- Email verification: the emailed link rendered the confirm panel, confirm returned 204, `email_verified_at` was set, and reuse was rejected.
- Missing-token states for both token pages render their explanatory panel rather than a broken form.
- All eight routes return 200 (three shell pages signed in, showing the real user; the auth pages signed out), and an unauthenticated `/` still 307s to `/sign-in`.
- `describeErrorBody` was exercised directly over nine real DRF response shapes.
- `npm run build` clean (all eight routes registered), `npx tsc --noEmit` clean, `npm run lint` clean. No 5xx and no traceback in either server log.

### Known limitations

- Still no frontend test suite; the checks above are manual plus the two static ones.
- **A new account lands on demo content.** Sign-up now works, but the account owns no workspace, so `workspaces[0]` is undefined and every loader falls back to demo content behind a notice. There is no create-workspace flow yet, and this is now the most visible gap in the product.
- No authenticated account management: no password change, profile edit, or verification resend from inside the app, and `/settings` in the new account menu 404s.
- Google sign-in remains inert (see Decisions).
- The account menu closes on outside click and Escape but is not a full focus-trapped menu widget, and it does not restore focus to the avatar on close.
- Sign-out was verified by invoking the server action over HTTP, not by clicking in a browser; no browser automation is available on this host.

### Next recommended milestone

A create-workspace flow behind the verified-email gate, so registration ends in a real, empty workspace instead of demo content. Then an authenticated `/settings` area for password change, profile, and verification resend.

## 2026-09-09 — Next.js frontend and its documentation

### Delivered

- Added the `frontend/` Next.js 16 / React 19 browser client for the existing Django API, covering four routes: a workspace dashboard (`/`), the client/campaign/asset browser with a workflow status board (`/projects`), the proxy-video review workspace with timecoded comments (`/review`), and session login (`/sign-in`).
- Data loads in server components through per-page view models in `src/lib/*-view.ts`, built on one typed, non-throwing API client (`src/lib/api.ts`) that returns an `ApiResult<T>` union so every caller handles failure explicitly. Writes go through server actions with `revalidatePath`; only login runs in the browser, because it must receive `Set-Cookie`.
- Server-side fetches go straight to the Django origin with the browser's cookie jar and `X-CSRFToken` forwarded; browser-side requests use relative `/api/*` paths rewritten in `next.config.ts` to keep the session cookie same-origin.
- Added `docs/frontend.md`: stack, commands, configuration, repository map, the three-layer architecture, both request paths and their trailing-slash workarounds, authentication, the demo-fallback convention, per-page derivation notes, the backend gaps the UI works around, styling conventions, known limitations, and next steps. Replaced the `create-next-app` boilerplate in `frontend/README.md` with a project-specific entry point, and linked both from `docs/DEVELOPMENT.md` and the root README.

### Decisions and boundaries

- Every view loader has a demo path: when the API is unreachable, has no workspace, or errors, the page renders placeholder content from the Stitch references behind a visible warning banner rather than an error screen. This keeps the UI reviewable with no backend running, at the cost that visible content is not proof the API works — documented explicitly, and confined to the `demoView`/`DEMO_VIEW` functions.
- A real signed-in account with no data returns a genuine empty state and no notice. Only an API failure produces a notice.
- `loadSession()` separates 401/403 (redirect to `/sign-in`) from status 0 (Django unreachable — keep rendering, show a notice), because redirecting on an unreachable API asserts something we cannot know.
- Fields the API does not expose — per-cut comment counts, durations, poster frames, resolutions — are left null and omitted from the card rather than fabricated.
- `skipTrailingSlashRedirect` plus a slash-restoring rewrite destination are both required: Django's `APPEND_SLASH` and Next's default 308 otherwise form an infinite redirect on every browser-side API call.
- Client → campaign grouping is read from `ClientTeam.metadata.project_ids` because the schema has no `Project.client_team` relation. Campaign creation is therefore two writes, and a project unclaimed by the second write appears under "Unassigned" rather than being lost.
- The dashboard derives its panels from three workspace-wide lists plus a media fan-out bounded to six projects, since there is no dashboard or summary endpoint.

### Verification

- `npx tsc --noEmit` clean and `npm run lint` clean.
- No frontend test suite exists yet; those two checks are the only automated coverage. Behaviour was verified by hand against a running API.

### Known limitations

- No frontend tests.
- Eight navigation targets (`/tasks`, `/files`, `/clients`, `/team`, `/render-queue`, `/deliverables`, `/settings`, `/help`) 404; the sidebar and topbar are scaffolding ahead of those routes.
- Inert controls: asset upload, client review link, filter dropdowns, review approval, Google sign-in, forgot password, and account creation all render without behaviour.
- No sign-out, registration, password reset, or email verification in the UI, though the API supports all four.
- No workspace switcher — every loader takes `workspaces[0]`, so an account with several workspaces only sees the first.
- Annotations, reactions, attachments, guest access, notification management, and workflow transitions exist in the API and not in the UI.
- The dashboard task checkbox is session-local; the task API exposes no completion endpoint for it to call.
- The Stitch design references under `stitch_blaze_flow_creative_operating_system/` are intentionally not committed; `docs/frontend.md` records where they live.

### Next recommended milestone

Sign-out, registration, and password reset in the UI, so an account can be managed without Postman. Then a real `Project.client_team` foreign key, which removes the `metadata.project_ids` workaround and its two-write campaign creation.

## 2026-09-03 — Per-workspace storage caps

### Delivered

- `File` now has a required `workspace` FK (migration `0020_add_file_workspace`, added nullable, backfilled from `MediaVersion`/`ProjectFile`/`ReviewCommentContent`/`TaskAttachment`/`ClientTeam.logo_file`, then made non-nullable + indexed in the same migration). All four `File.objects.create(...)` call sites (`media.py`, `project_files.py`, `review_assets.py`, `tasks.py`) now set it.
- `PLAN_LIMITS` gained `max_storage_bytes` per plan (FREE: 5GB, PRO: 2TB — matching `docs/storage-and-pricing.md`'s modeled tiers), read the same way as the existing `max_workspaces_owned`/`max_projects_per_workspace` limits.
- New `enforce_workspace_storage_limit()` / `workspace_storage_bytes_used()` in `app/services/subscriptions.py`, following the exact pattern of the existing `enforce_workspace_creation_limit`/`enforce_project_creation_limit`: sums `File.size_bytes` for the workspace (`FileVariant`s — previews/proxies — are intentionally excluded from the count, see Known limitations) and raises `SubscriptionError` if the new upload would exceed the plan's cap.
- Wired into all four upload paths (media versions, project files, review comment attachments, task attachments). Each performs a fast check before checksum/storage work and an authoritative second check under a workspace row lock in the file-creation transaction, preventing concurrent uploads from jointly exceeding the cap; a rejected second check compensates the just-written storage object.
- Project-file/folder and task/attachment deletion now soft-delete their underlying `File` and variants consistently with review-attachment deletion, so removed user content immediately releases logical quota while physical retention remains a separate concern.
- Preview generation now uses one shared variant-type set for both its optimistic and row-locked idempotency checks; `VIDEO_PROXY` can no longer be missed by the second check during concurrent worker execution.
- Views for all four upload endpoints now also catch `SubscriptionError` alongside their existing upload-specific exception, returning the same `400 {"detail": ...}` shape as the pre-existing workspace/project limit errors.

### Decisions and boundaries

- Enforcement is a live `Sum(size_bytes)` query per upload, not a denormalized running counter. Chosen for this milestone because it's correct-by-construction with no increment/decrement bookkeeping to get wrong across four call sites plus retention deletes; revisit if per-upload query cost becomes a real concern at scale.
- `FileVariant` rows (preview thumbnails, PDF first-page renders, waveform SVGs, video proxies) are **not** counted toward the cap. They're generated by the system, not directly uploaded, and are typically far smaller than the originals they're derived from.
- No overage billing, no soft-warning, no archival tier — this is deliberately the minimal "cap + tracking" scope discussed against the Frame.io-style breakeven-utilization risk in `docs/storage-and-pricing.md`; overage handling is an explicit next step, not attempted here.

### Verification

- Full suite: 216/216 passing under real PostgreSQL (`docker compose run --rm web python manage.py test`; was 209 before this milestone). Coverage includes rejection and post-upgrade success, all four quota-controlled upload APIs, a real two-thread serialization test, and project/task deletion releasing their underlying `File` records.
- `makemigrations --check --dry-run` clean, `manage.py check` clean.
- Also cleaned up ~185 stray macOS `._*` AppleDouble metadata files that had accumulated across the repo (this project lives on an external volume) and were actively breaking `docker compose up`'s build context read (`operation not permitted` on an xattr read of `._.env.example`). Unrelated to this feature but was blocking verification.

### Known limitations

- `FileVariant` storage isn't counted (see above) — a workspace with many/large video proxies could be modestly under-counted relative to true bytes stored.
- No overage billing or fair-use throttling past the cap yet.
- No billing/Stripe wiring still — `UserSubscription.provider`/`provider_subscription_id` remain unpopulated, so there's no way to actually collect payment for the PRO plan this now gates.

### Next recommended milestone

Per `docs/storage-and-pricing.md`: an overage/fair-use safeguard once real usage data exists, or Stripe billing integration so the PRO plan can actually be sold.

## 2026-09-02 — Video review proxies

### Delivered

- Uploaded video media versions now get a low-bitrate H.264 proxy (`VIDEO_PROXY` `FileVariant`) generated asynchronously via ffmpeg, reusing the existing preview/outbox pipeline (`app/services/file_processing.py`: `_video_proxy`, wired into `_preview_content`/`generate_preview`). Config is environment-driven: `VIDEO_PROXY_MAX_WIDTH`/`_MAX_HEIGHT` (960x540 default), `VIDEO_PROXY_CRF` (28), `VIDEO_PROXY_AUDIO_BITRATE` (128k), plus separate input/output byte caps and a longer transcode timeout than the still-image/audio decoders use.
- Added `GET .../media-versions/<id>/preview/` (`media_version_preview` view, `api-media-version-preview` route), gated on `MEDIA_READ` rather than `MEDIA_DOWNLOAD`/`allow_download` — reviewers can stream the proxy without needing download rights or the original ever leaving storage. This closes a pre-existing gap: there was previously no endpoint at all serving a preview/variant of a media version's primary file (only comment attachments had one).
- `upload_media_version` now enqueues the existing `PREVIEW_TOPIC` outbox event when the uploaded file is `video/*`, so proxy generation kicks off on upload without changing the file's status or scan behavior for other media types.

### Decisions and boundaries

- Deliberately did **not** route media-version uploads through the attachment security-scan pipeline (`FileSecurityScan`/`SCAN_TOPIC`) to trigger this — that changes `File.status` to `PENDING` at creation and turned out to add an extra `OutboxEvent` row that several unrelated tests (`test_notifications.py`, `test_review_assets.py`) assert is the *only* pending event. Scoping the new enqueue to `video/*` uploads only avoids that ripple entirely, since every other test's media fixture is a PNG.
- No new binary dependency: ffmpeg was already installed in the Docker image and already used for MP3 waveform decoding.
- Did not add ffprobe-based post-encode metadata (exact output width/height/duration) to keep this from introducing a second external-binary dependency; `FileVariant.metadata` records only the target config (`max_width`, `max_height`, `crf`).

### Verification

- Full suite: 209/209 passing under real PostgreSQL via `docker compose run --rm web python manage.py test` (was 207; added 2 real-ffmpeg tests in `app/test_media.py` that generate a synthetic clip with `ffmpeg -f lavfi` and assert a real transcoded `VIDEO_PROXY` variant and a working preview response).
- `makemigrations --check --dry-run` clean (no schema change — `FileVariant.metadata` is already a JSONField), `manage.py check` clean.

### Known limitations

- No storage-quota enforcement or plan-based caps yet; `PLAN_LIMITS` still only gates workspace/project counts, not bytes stored.
- No billing/Stripe wiring; `UserSubscription.provider`/`provider_subscription_id` remain unpopulated.
- No frontend exists yet to consume the new preview endpoint.

### Next recommended milestone

Storage-cap enforcement per plan (add `max_storage_bytes` to `PLAN_LIMITS`, track usage, block uploads past the cap), or Stripe billing wiring — both discussed as follow-ups to this milestone but out of scope here.

## 2026-09-02 — PostgreSQL verification restored

### Delivered

- Every prior milestone entry in this log recorded the same caveat: PostgreSQL execution was unavailable locally because of a Docker Desktop content-store `input/output error`, so verification ran only against SQLite. Docker Desktop was simply not running in this environment; once started, `docker compose up -d` brought up `db`, `web`, and `worker` cleanly with no storage error, using the same previously built images and the same `postgres:16-alpine` pull that had failed before.
- Ran the full suite the documented way (`docker compose run --rm web python manage.py test`): all 207 tests pass against real PostgreSQL in 27s.
- Also reran `makemigrations --check --dry-run` (no drift) and `manage.py check` (no issues) against PostgreSQL, and revalidated `Postman_Collection.json` as parseable JSON.
- The `worker` container's outbox processor connected to `db` over the compose network and ran its poll loop without error once the stack was up; an earlier DNS failure in its logs was leftover output from before `db` existed in this run and cleared on its own restart.

### Decisions and boundaries

- No code or schema changed in this milestone. This closes a standing environment gap, not a product gap.
- The root cause was environmental (daemon not running), not a reproducible storage/layer-unpacking defect — no fix was needed in the Dockerfile, Compose file, or CI configuration. If the original I/O error recurs, it was most likely tied to available space on the host disk backing Docker Desktop's VM image, which should be the first thing to check.

### Verification

- The complete PostgreSQL suite passes (207 tests), Django system checks pass, migration drift is clean, and the Postman collection parses.

### Next recommended milestone

With the backend MVP and PostgreSQL verification both closed, remaining work is a deliberate product-direction choice: a frontend against the existing API, or backend work on one of the undelivered README domains (Calendar, Billing, Reports, AI Assistant).

## 2026-09-02 — Google OAuth sign-in

### Delivered

- Added `POST /api/auth/google/`, verifying a client-supplied Google-issued ID token against Google's public keys via the `google-auth` library (new dependency, pinned, along with `requests` as its HTTP transport) and starting a normal Django session on success, identical in shape to the existing `Login` response (`UserSerializer` data plus `csrf_token`).
- Token verification lives in its own function (`verify_google_id_token`) so tests replace it with a double instead of calling Google's network endpoint, the same "swap the integration point" pattern already used for `FILE_SECURITY_SCANNER`.
- A returning Google user (same token `sub`) reuses their existing linked `OAuthIdentity` and refreshes its cached name/picture from the latest claims. A first-time verified Google email either links to a matching existing registered account (per the documented auto-link rule) or creates a new account — pre-verified email, `set_unusable_password()`-equivalent (`create_user(password=None)`, which Django resolves to an unusable password automatically), and a provisioned `FREE` subscription, mirroring `Register` exactly.
- An unverified Google email is refused rather than silently linked or used to create an account, and a suspended/non-active account cannot sign in through either the existing-identity or email-matching path.
- `GOOGLE_OAUTH_CLIENT_ID` is optional; leaving it unset returns a clear `400` instead of a crash or a confusing network error, consistent with how this project treats other optional external integrations (storage, malware scanning).
- Added Postman documentation (Postman itself cannot generate a Google ID token) and a manual testing-guide section; added test coverage for first-time sign-in, returning-user identity reuse, existing-account auto-linking, refusing an unverified email, suspended-account rejection through both lookup paths, invalid-token handling, and the not-configured response.

### Decisions and boundaries

- Only Google is implemented; the `OAuthProvider` enum and `OAuthIdentity` schema already generalize to more providers, but no other provider integration was added speculatively.
- This backend only verifies an ID token handed to it; it does not implement the browser-side "Sign in with Google" redirect/button flow that produces that token. A frontend (or a manual tool like Google's OAuth Playground) is responsible for that half.
- Linking is one-directional and identity-based: matching is by Google's stable `sub` claim first, then by verified email for first-time linking. An unverified Google email never links or creates an account, closing the spoofing risk of trusting a client-asserted email.

### Verification

- The complete SQLite suite passes (207 tests), Django system checks pass, migration drift is clean (no schema change — `OAuthIdentity`/`OAuthProvider` already existed), the Postman collection parses, and project Python sources compile.
- PostgreSQL execution remains unavailable in the local host environment because of the previously recorded Docker storage issue. Google token verification itself was exercised only through a mocked `verify_google_id_token`; no live Google OAuth client was available to test the real network path end-to-end.

### Next recommended milestone

This closes every item on the standing follow-up list for the documented backend MVP (`docs/implementations/domain_and_features.md`). Remaining gaps are intentionally out of that scope: a frontend, and the README's broader product vision (Calendar, Billing, Reports, AI Assistant) have no backend work started.

## 2026-09-02 — Office document attachment support (DOCX/XLSX/PPTX/RTF)

### Delivered

- Extended the single shared `detect_attachment_type` used by review comment, task, and project-file attachments to recognize DOCX/XLSX/PPTX and RTF, closing the follow-up noted in the last several milestone entries. All three upload paths picked up the change from one place; none of their call sites needed new detection logic, only an extra `upload` argument.
- OOXML detection does not trust the outer ZIP signature alone (`PK\x03\x04` is shared by every `.docx`/`.xlsx`/`.pptx`/plain `.zip`). It opens the upload as a zip archive and checks for the internal part that only exists in the corresponding Office package (`word/document.xml`, `xl/workbook.xml`, `ppt/presentation.xml`), so a renamed generic ZIP or a `.xlsx` byte-for-byte file re-declared as `.docx` is still rejected.
- RTF is detected from its `{\rtf1` text header, matching the existing shallow-header-check style used for the other already-supported formats.
- Added unit coverage for the new detector (valid DOCX/XLSX/PPTX, a corrupt zip, a generic zip without any Office marker, RTF, and the "signature alone is not enough without the upload stream" case) plus an end-to-end API test uploading a real in-memory DOCX through the Task Attachment endpoint and one confirming a mislabeled plain ZIP is still rejected.

### Decisions and boundaries

- Legacy binary Office formats (`.doc`, `.xls`, `.ppt` — the pre-2007 OLE compound-file format) remain unsupported. Distinguishing them from their compound-file header alone would need an OLE directory parser (a new third-party dependency, e.g. `olefile`); given how rare these legacy formats are next to modern OOXML, that trade-off wasn't taken in this pass.
- Formats with no reliable magic bytes (`.csv`, `.txt`, and similar plain-text formats) remain unsupported by design, not oversight — accepting them would mean trusting the file extension or declared MIME type alone, which conflicts with the signature-verification guarantee this codebase has maintained for every other attachment type.
- The fix lives in one place (`app/services/review_assets.py`'s `detect_attachment_type`) rather than being duplicated across the three call sites, so future format additions only need to change one function.

### Verification

- The complete SQLite suite passes (198 tests), Django system checks pass, migration drift is clean (no schema or model change), the Postman collection parses, and project Python sources compile.
- PostgreSQL execution remains unavailable in the local host environment because of the previously recorded Docker storage issue.

### Next recommended milestone

Google OAuth for Identity & Authentication — the last item on the standing follow-up list for the documented backend MVP.

## 2026-09-02 — User Subscription and plan-limit enforcement

### Delivered

- Added `app/services/plan_config.py` exposing `get_plan_limit(plan, key)` as the single accessor for environment-configured plan resource limits (`PLAN_LIMITS` in settings, covering `max_workspaces_owned` and `max_projects_per_workspace` for `FREE`/`PRO`), per the domain documentation's explicit call for a Plan Config abstraction that isolates business logic from where limits are physically stored.
- Registration now provisions a `FREE`/`ACTIVE` `UserSubscription` row automatically. Accounts that existed before this change have no row; every read falls back to an equivalent unsaved FREE default rather than creating one, so `GET` stays side-effect-free.
- Added self-service `GET /api/subscriptions/me/`, `POST /api/subscriptions/upgrade/` (simulated PRO upgrade — no external payment provider), `POST /api/subscriptions/cancel/` (schedules `cancel_at_period_end`, does not downgrade immediately), and `POST /api/subscriptions/resume/` (undoes a pending cancellation).
- Added a `process_expired_subscriptions` operator command (dry-run capable) that downgrades PRO subscriptions to FREE once a scheduled cancellation's `current_period_end` has passed — there is no payment-provider webhook driving this, matching the same "explicit operator action" pattern already used for retention cleanup and dead-letter requeue.
- Wired real enforcement into the two endpoints the domain calls out explicitly: workspace creation now rejects once the creating user already owns `max_workspaces_owned` active workspaces for their plan, and project creation now rejects once the workspace already holds `max_projects_per_workspace` non-archived projects for its primary owner's plan.
- Added Postman requests and a manual testing-guide section; added test coverage for provisioning, the upgrade/cancel/resume state machine, the expiry-processing command (including dry-run), and both enforcement points end-to-end through the API.

### Decisions and boundaries

- No payment provider is integrated. "Upgrade" and "cancel" are self-service state changes on the `UserSubscription` row itself; the existing `provider`/`provider_subscription_id` fields remain available for a future real integration without a schema change.
- Only `max_workspaces_owned` and `max_projects_per_workspace` are enforced in this milestone. Member-count and storage limits mentioned in the domain documentation are not yet capped; enforcement was scoped to the two limits with a clear, already-existing creation endpoint to attach to, rather than adding new enforcement surfaces speculatively.
- A workspace's effective plan is resolved from its primary owner's subscription via the existing `is_primary_owner` membership flag, never from `Workspace.created_by_user` — ownership can outlive the original creator per the domain model, and the plan must follow ownership.
- Cancellation is deliberately not immediate. The subscription stays on its current plan until `process_expired_subscriptions` runs after the period ends, mirroring how a real billing provider's webhook-driven downgrade would behave and keeping the same "durable state change happens out of the request/response cycle" discipline used for email delivery and retention cleanup elsewhere in this codebase.

### Verification

- The complete SQLite suite passes (189 tests), Django system checks pass, migration drift is clean (no schema change was needed — `UserSubscription` already existed in full), the Postman collection parses, and project Python sources compile.
- PostgreSQL execution remains unavailable in the local host environment because of the previously recorded Docker storage issue.

### Next recommended milestone

Google OAuth for Identity & Authentication, then broaden the review/task/project-file attachment signature allowlist to general office-document formats.

## 2026-09-02 — Workspace detail, business profile, and deletion lifecycle

### Delivered

- Added `GET/PATCH /workspaces/{id}/` for reading a single workspace and updating `name`/`timezone` (the slug remains fixed after creation), gated on the existing `workspace.read`/`workspace.manage` permissions.
- Added `GET/PATCH /workspaces/{id}/profile/` over the existing `WorkspaceProfile` schema. Reading never creates a row (a blank in-memory default is serialized instead); the first write creates it, later writes update the same row.
- Added reversible workspace deletion scheduling: `DELETE /workspaces/{id}/` moves an `ACTIVE` workspace to `PENDING_DELETION` with `deletion_scheduled_at` set `WORKSPACE_DELETION_GRACE_DAYS` (default 30, environment-configurable) in the future; `POST /workspaces/{id}/restore/` cancels it back to `ACTIVE`. Both reject the no-op case (already pending, or not pending).
- Added Postman requests and a manual testing-guide section; added test coverage for read/update authorization, invalid-timezone/empty-update rejection, the GET-has-no-side-effect guarantee on the profile endpoint, and the schedule/restore/double-schedule/premature-restore state machine.

### Decisions and boundaries

- Only scheduling and restoring `PENDING_DELETION` are implemented. There is no operator command that physically purges a workspace once its grace period elapses — every table in this schema uses `on_delete=DO_NOTHING`, so real cascading deletion would need dedicated work across every domain (Projects, Media, Tasks, Client Teams, and so on), not just this endpoint. Building that purge path is explicitly deferred.
- `SUSPENDED` is not exposed as a self-service transition from any API in this milestone; the codebase has no platform-admin role concept beyond Django's own `is_staff`/`is_superuser`; suspension stays an internal/administrative state for now.
- Workspace update intentionally excludes `status` and `slug`; lifecycle transitions only happen through the dedicated schedule/restore endpoints, and slug stability was chosen over renaming to avoid breaking bookmarked routing.

### Verification

- The complete SQLite suite passes (171 tests), Django system checks pass, migration drift is clean (no schema change was needed — both `Workspace.deletion_scheduled_at` and `WorkspaceProfile` already existed), the Postman collection parses, and project Python sources compile.
- PostgreSQL execution remains unavailable in the local host environment because of the previously recorded Docker storage issue.

### Next recommended milestone

User Subscription and a Plan Config service, then Google OAuth for Identity & Authentication, then broaden the review/task/project-file attachment signature allowlist to general office-document formats.

## 2026-09-02 — Project Files and Folders

### Delivered

- Added `project_file.read`, `project_file.create`, `project_file.update`, and `project_file.delete` permissions to the registry and system roles, with migration `0019` backfilling existing workspaces (`read`/`create`/`update` to Owner and Member, `delete` to Owner only — the same split used for Project and Task permissions).
- Closed a schema gap the domain documentation had explicitly flagged: added the missing partial unique constraint (migration `0018`) so two root-level folders (`parent_folder IS NULL`) in the same project can no longer collide on name, matching the sibling-uniqueness constraint that already existed for non-root folders.
- Added nested Project Folder CRUD (create/list/rename) plus cascading soft delete: deleting a folder soft-deletes every descendant folder and every Project File inside that subtree in one transaction, while leaving the underlying `File` records untouched.
- Added Project File list/upload/delete, reusing the same signature-verification, checksum, and `File`/`FileSecurityScan`/outbox scanning pipeline as Task Attachments and review attachments.
- Added a dedicated `MAX_PROJECT_FILE_BYTES` environment setting (default 25 MB).
- Added Postman requests/variables and a manual testing-guide section; added test coverage for root/sibling name-collision rejection, cascading delete, folder rename, upload/spoof handling, and project-access authorization boundaries.

### Decisions and boundaries

- A folder's `parent_folder` and a file's `folder` are fixed at creation. Neither can be changed afterward through the API; reorganizing means deleting and re-adding, keeping the mutation surface minimal (mirrors the same call made for `Task.project_id` in the previous milestone).
- Every folder/file endpoint is project-scoped only; there is no workspace-level variant, unlike Tasks, because `ProjectFolder`/`ProjectFile` both require a non-nullable `project` foreign key in the schema.
- Deleting a folder cascades logically (soft delete) to its descendants and their files but never deletes the underlying centralized `File` rows, matching the domain documentation's explicit "File Reuse" rule and the same choice already made for Task Attachment removal.
- File uploads reuse the Task Attachment signature allowlist (PNG, JPEG, GIF, WebP, PDF, WAV, MP3, plus MP4/QuickTime/WebM) rather than inventing a broader one; general office-document formats remain a known follow-up shared with Task Attachments.

### Verification

- The complete SQLite suite passes (159 tests), Django system checks pass, migration drift is clean, the Postman collection parses, and project Python sources compile.
- PostgreSQL execution remains unavailable in the local host environment because of the previously recorded Docker storage issue.

### Next recommended milestone

Broaden the review/task/project-file attachment signature allowlist to general office-document formats, then User Subscription and plan-based resource limits (the last MVP domain with zero API surface), followed by Google OAuth for Identity & Authentication.

## 2026-09-02 — Tasks, assignees, and task attachments

### Delivered

- Added `task.read`, `task.create`, `task.update`, and `task.delete` permissions to the registry and system roles, with migration `0017` backfilling existing workspaces (`read`/`create`/`update` to Owner and Member, `delete` to Owner only — mirroring the existing Project permission split).
- Added workspace- and project-scoped Task CRUD (create/list/detail/update/soft-delete) over the existing `Task` schema. A task with no `project_id` is authorized against the caller's workspace role only; a task with a `project_id` additionally requires project access to that specific project, reusing the existing `has_project_permission`/`accessible_projects` evaluators unchanged.
- Made status transitions to/from `COMPLETED` automatically stamp and clear `completed_at`.
- Added Task Assignee management (assign/unassign an existing `WorkspaceMembership`) with duplicate-assignment prevention.
- Added Task Attachments: signature-verified multipart upload reusing the review-attachment detection/checksum logic plus video signatures, routed through the same `File`/`FileSecurityScan`/outbox scanning pipeline as review and media uploads; listing; and removal (deletes only the join row, per the documented "File Reuse" rule that attachment relationships don't imply file ownership).
- Added `MAX_TASK_ATTACHMENT_BYTES` environment setting (default 25 MB, independent of `MAX_REVIEW_ATTACHMENT_BYTES`).
- Added Postman requests/variables and a manual testing-guide section; added test coverage for workspace-vs-project authorization boundaries, assignment, attachment upload/spoofing, and completion-timestamp behavior.

### Decisions and boundaries

- Task attachment uploads accept the same byte-signature allowlist as review attachments (PNG, JPEG, GIF, WebP, PDF, WAV, MP3) plus the video signatures already recognized for media uploads (MP4, QuickTime, WebM). Broader office-document formats are not yet supported; that requires new signature detectors as a follow-up, not new task-domain logic.
- A task's `project_id` cannot be changed through the update endpoint; moving a task to a different project would change its authorization scope, so the field is create-only.
- Task Attachments never accept a client-supplied `file_id`. Every existing file-attachment flow in this codebase (review comments, media) creates the `File` from a direct upload in the same request rather than referencing an arbitrary pre-existing `File` id, because `File` carries no workspace/tenant scoping of its own; Task Attachments follow the same rule to avoid introducing a cross-tenant file-reference path.
- Removing a Task Attachment deletes only the `TaskAttachment` join row; the underlying `File` is retained, matching the explicit "File Reuse" guidance for the sibling Project Files domain rather than the review-attachment convention of also soft-deleting the file.

### Verification

- The complete SQLite suite passes (145 tests), Django system checks pass, migration drift is clean, the Postman collection parses, and project Python sources compile.
- PostgreSQL execution remains unavailable in the local host environment because of the previously recorded Docker storage issue.

### Next recommended milestone

Project Files and Folders, then broaden the task/review attachment signature allowlist to cover general office-document formats.

## 2026-09-01 — Client Team invites

### Delivered

- Added manager-only `EMAIL` and `LINK` Client Team invite creation, listing, and revocation over the existing `ClientTeamInvite`/`ClientTeamInviteAcceptance` schema.
- `EMAIL` invites are recipient-bound and enforced single-use (`max_uses` is fixed to `1` regardless of input); `LINK` invites are not recipient-bound and accept an optional `max_uses`, remaining unlimited until expiration or revocation otherwise.
- Added a global authenticated accept endpoint that validates expiration, revocation, client-team-active state, and (for `EMAIL`) recipient-email match; reuses the existing member add/reactivate logic so a previously removed member is reactivated rather than duplicated.
- Made acceptance idempotent per (invite, user): re-accepting the same invite returns the existing membership without incrementing `use_count` or creating a duplicate `ClientTeamInviteAcceptance` row.
- Added Postman requests/variables and manual testing-guide steps; added positive/negative test coverage for validation, authorization, usage limits, idempotency, expiration, and revocation.

### Decisions and boundaries

- Expiration is mandatory for both invite types, matching the domain specification (unlike the optional expiration on project Guest Invites); the API defaults to 14 days and accepts 1–90.
- Accepting a Client Team Invite never creates a `USER` `WorkspaceMembership`; actual workspace access still requires a manager to run the existing Grant Client Team Workspace Access endpoint, per the documented separation between organizational membership and workspace authorization.
- Revoking an invite is not retroactive: members it already onboarded keep their `ClientTeamMember` row until explicitly removed.
- List/create/revoke are gated on `client_team.manage` (not `client_team.read`), matching how workspace invitations are gated on `workspace.members.manage` rather than `workspace.read` — invite tokens and usage are more sensitive than the team's public profile.

### Verification

- The complete SQLite suite passes (130 tests), Django system checks pass, migration drift is clean (no schema change was needed), the Postman collection parses, and project Python sources compile.
- PostgreSQL execution remains unavailable in the local host environment because of the previously recorded Docker storage issue.

### Next recommended milestone

Tasks, Task Assignees, and Task Attachments, then Project Files/Folders.

## 2026-09-01 — Client Team administration and workspace access

### Delivered

- Added `client_team.read` and `client_team.manage` permissions to the registry and system roles, with migration `0016` backfilling existing workspaces (`read` to Owner and Member, `manage` to Owner only).
- Added manager-only Client Team profile CRUD (create, list, detail, update) and lifecycle archival over the existing schema.
- Added Client Team Member management: adding an existing active registered user by email, idempotent reactivation of a previously removed member, and soft removal.
- Added a manager-only endpoint to grant a Client Team workspace access by creating its `CLIENT_TEAM` `WorkspaceMembership` (role plus `ALL`/`SELECTED` project-access mode); the existing generic membership-update endpoint continues to handle later role/scope changes and revocation.
- Exposed a nested `client_team` object on `WorkspaceMembershipSerializer` so `CLIENT_TEAM` memberships are identifiable in API responses, not just `USER` ones.
- Added Postman requests/variables and a manual testing-guide section; added positive/negative test coverage for authorization, duplicate/removed-member handling, and permission inheritance through a granted Client Team membership.

### Decisions and boundaries

- Client Team Invites (`EMAIL`/`LINK` shareable onboarding links) are deliberately out of scope for this milestone; members are added directly by a manager who already knows the registered user's email, matching the project's practice of shipping one coherent workflow at a time.
- Archiving a Client Team does not touch its `WorkspaceMembership` row. Permission evaluation already filters on `client_team.status == ACTIVE`, so archival alone immediately cuts off every member's inherited access.
- Granting workspace access is gated on `workspace.members.manage` (the same permission guarding direct-member updates and project-access grants), not `client_team.manage`, since it grants real workspace authorization rather than editing client profile data.
- Client Team CRUD and membership changes are not audited, matching the existing unaudited pattern for Role and Project administration; audit logging stays reserved for the review/media/workflow/retention/guest domains it already covers.

### Verification

- The complete SQLite suite passes (116 tests), Django system checks pass, migration drift is clean, the Postman collection parses, and project Python sources compile.
- PostgreSQL execution remains unavailable in the local host environment because of the previously recorded Docker storage issue.

### Next recommended milestone

Add Client Team Invites (`EMAIL`/`LINK` onboarding), then Tasks/Task Attachments and Project Files/Folders.

## 2026-09-01 — Verified-email gate on workspace creation

### Delivered

- Required a verified email (`email_verified_at` set) before an authenticated user may create a workspace, closing the limitation recorded in the email-verification milestone below.
- Returns `403` with a clear message when an unverified user attempts workspace creation, instead of silently allowing it.
- Added Postman documentation noting the requirement and positive/negative test coverage.

### Decisions and boundaries

- Only workspace creation is gated in this milestone. Login, registration, project creation, and other actions remain unaffected; each additional gated action is a deliberate follow-up decision, not an implicit consequence of this change.
- The gate reads the existing `email_verified_at` timestamp directly; no new field, migration, or settings flag was introduced.

### Verification

- The complete SQLite suite passes (98 tests), Django system checks pass, migration drift is clean, the Postman collection parses, and project Python sources compile.
- PostgreSQL execution remains unavailable in the local host environment because of the previously recorded Docker storage issue.

### Next recommended milestone

Add Client Team, Client Team Member, and Client Team Invite APIs over the existing schema, then Tasks/Task Attachments and Project Files/Folders.

## 2026-09-01 — Workspace retention-policy administration

### Delivered

- Added manager-only effective-policy reads and audited workspace overrides for review-file cleanup enablement and retention days.
- Added a 1–3,650 day validated window with environment-default inheritance when no workspace override exists.
- Made physical review-file cleanup policy-aware across workspaces while retaining dry-run, batch limits, storage-failure reporting, and idempotent metadata markers.
- Added optional workspace-scoped cleanup and retained `--older-than-days` as an explicit operator override.
- Added migration `0015`, authorization and cleanup integration tests, Postman requests, schema notes, and operator documentation.

### Decisions and boundaries

- A disabled workspace policy prevents automatic cleanup but does not alter logical soft deletion.
- Files referenced across workspaces are purged only after every applicable workspace policy permits it.
- The explicit age override bypasses workspace settings and is intentionally available only through the operator command, not the web API.

### Verification

- The complete SQLite suite passes (97 tests), Django system checks pass, migration drift is clean, the Postman collection parses, project Python sources compile, and `git diff --check` is clean.
- PostgreSQL execution remains unavailable in the local host environment because of the previously recorded Docker storage issue.

### Next recommended milestone

Define and enforce which product actions require a verified email.

## 2026-09-01 — Member and guest review reactions

### Delivered

- Added actor-attributed comment reactions for registered users and guest sessions.
- Added `review.reaction.create` to the permission registry, system roles, and guest-link scopes.
- Added idempotent add and own-reaction removal APIs with audited changes.
- Added grouped reaction counts and named reactors to comment responses.
- Restricted input to six supported reactions and enforced one actor plus per-actor/comment/emoji uniqueness in the database.
- Added migration `0014`, member/guest tests, Postman requests, schema notes, and developer documentation.

### Decisions and boundaries

- Reaction removal is self-service; comment managers do not currently moderate another actor's reaction.
- The supported emoji set is controlled to prevent visually equivalent Unicode variants from fragmenting counts.
- Reaction changes do not generate notifications in this milestone.

### Verification

- The complete SQLite suite passes (96 tests), Django system checks pass, migration drift is clean, the Postman collection parses, project Python sources compile, and `git diff --check` is clean.
- PostgreSQL execution remains unavailable in the local host environment because of the previously recorded Docker storage issue.

### Next recommended milestone

Add workspace retention-policy administration, then define which product actions require a verified email.

## 2026-09-01 — Email verification and identity-token cleanup

### Delivered

- Added automatic registration verification email plus enumeration-safe resend and single-use confirmation APIs.
- Added hashed, expiring verification tokens with active-token rotation and delivery-failure invalidation.
- Added independent verification throttling and environment-controlled frontend URL and lifetime settings.
- Added bounded dry-run-capable cleanup for expired password-reset and email-verification tokens.
- Added migration `0013`, identity lifecycle tests, schema notes, and operator documentation.

### Decisions and boundaries

- Verification records account ownership in `email_verified_at` but does not yet block login or workspace creation.
- Registration remains successful if email delivery fails; the undelivered token is invalidated and the failure is logged.
- Cleanup deletes only expired tokens and is an explicit scheduled operator action.

### Verification

- The complete SQLite suite passes (94 tests), Django system checks pass, migration drift is clean, the Postman collection parses, tracked Python sources compile, and `git diff --check` is clean.
- PostgreSQL execution was not available in the local host environment; the existing Docker storage blocker remains outside this milestone.

### Next recommended milestone

Add review reactions and retention-policy administration, then define which product actions require a verified email.

## 2026-09-01 — Six milestones: identity recovery and bounded review APIs

### Delivered

- Added independent IP throttles for registration, login, and password-reset traffic with environment-controlled rates.
- Added enumeration-safe reset requests, expiring hashed single-use reset tokens, email delivery, token replay denial, and invalidation of older active tokens.
- Added authenticated password changes requiring the current password while preserving the active session.
- Added guest-owned attachment deletion with a dedicated permission, exact-session ownership, soft deletion of file variants, and guest audit attribution.
- Added bounded limit/offset pagination to member and guest comment/annotation lists while preserving list-shaped JSON and exposing navigation metadata through headers.
- Added migration `0012`, Postman requests, environment examples, and positive/negative coverage for the six behaviors.

### Decisions and boundaries

- Reset delivery failures are logged and invalidate the undelivered token while the HTTP response remains enumeration-safe.
- Password validation continues to use Django's configured validators; no parallel credential rules are introduced.
- Review pagination uses response headers to avoid breaking existing clients that consume a top-level JSON list.

### Verification

- The complete SQLite suite passes (91 tests), Django system checks pass, migration drift is clean, the Postman collection parses, and `git diff --check` is clean.
- PostgreSQL execution remains blocked by the previously recorded Docker Desktop content-store `input/output error`; inspecting the cached `postgres:16-alpine` image reproduces the missing-blob failure before containers start.

### Next recommended milestone

Add email-verification lifecycle APIs, reset-token cleanup, review reactions, and retention-policy administration after Docker storage is repaired and PostgreSQL validation can resume.


## 2026-09-01 — Three milestones: decoded previews, key rotation, and production adapters

### Delivered

- Added bounded Pillow decoding for actual JPEG thumbnail variants with EXIF orientation handling and first-frame behavior.
- Added standard-library WAV decoding and deterministic SVG waveform variants with duration/channel/rate metadata.
- Retained safe review-card fallback for corrupt, unsupported, PDF, and MP3 inputs.
- Added guest access-key rotation with transactional hash replacement, one-time raw-key response, immediate old-key invalidation, and guest audit logging.
- Added environment-driven private S3-compatible storage through django-storages, with non-secret backend metadata and local defaults.
- Added a bounded ClamAV TCP INSTREAM adapter, scanner startup validation, timeout/stream limits, and an optional Compose malware profile.
- Added compatible pinned dependencies, Postman key rotation, environment examples, and deployment documentation.

### Decisions and boundaries

- Preview decoding runs only after a clean malware result and preserves idempotent one-variant behavior.
- Decoder failure is non-fatal and produces a safe review card; it never changes a clean original back to failed.
- Raw guest keys remain one-time responses and only their SHA-256 hashes are stored.
- S3 credentials stay in the provider/environment chain and are never written into Storage Backend records.

### Known limitations

- PDF rasterization and MP3 waveform decoding need explicit production decoder adapters.
- S3 and ClamAV integration tests use configuration/protocol doubles; deployment smoke tests require real infrastructure.

### Next recommended milestone

Add guest-owned edit/delete flows, PDF/MP3 decoder adapters, and external metrics export.

## 2026-09-01 — Three milestones: guest lifecycle, guest files, and retention cleanup

### Delivered

- Added manager-only guest invite/access listing without exposing stored token hashes.
- Added audited revocation for one exchanged access or an invite plus all active access derived from it.
- Added `review.attachment.create` guest scope and guest multipart uploads restricted to comments authored by that exact Guest Session.
- Routed guest uploads through the existing signature validation, SHA-256, quarantine, malware scan, preview, and private download workflow.
- Soft deletion now marks generated variants alongside the attachment File.
- Added bounded, age-gated physical retention cleanup with dry-run, storage-failure reporting, idempotent metadata markers, and an operator command.
- Updated Postman variables/requests and developer/operator documentation.

### Decisions and boundaries

- Invite revocation is terminal and cascades logically to active derived access. Individual access revocation leaves the invite usable for other reviewers.
- Guests cannot attach to member comments or another guest session's comments, even when the link grants attachment creation.
- Physical cleanup preserves database and audit history; only private storage objects are removed. The service targets review attachments, not general project/media files.
- Cleanup is an explicit scheduled operator action, not web-request work.

### Known limitations

- Guest token rotation, attachment deletion, and guest-authored comment/annotation editing remain unimplemented.
- Rich decoded thumbnails/waveforms and retention-policy administration remain follow-ups.

### Next recommended milestone

Add decoded image/PDF/audio derivatives, guest token rotation, and production object-storage/scanner adapters.

## 2026-09-01 — Four milestones: quarantine, previews, guests, and operational alerts

### Delivered

- Changed review attachment ingestion to create `PENDING` Files and durable `file.security-scan.requested` outbox events. Downloads return `409` until a scan marks the File `READY`.
- Added one durable File Security Scan record per attachment, a configurable scanner backend contract, EICAR test-marker rejection, clean/infected/failed states, and worker-driven processing.
- Added idempotent asynchronous `file.preview.requested` processing. Clean attachments receive a private SVG review-card File Variant without adding native decoder dependencies.
- Added one-time, hashed, expiring project guest invites and one-time guest access keys. Guest permissions are snapshotted at exchange and checked for every project-scoped request.
- Added guest review discovery, comment list/create, annotation list/create, and clean attachment download APIs. Guest authorship and audit logs use the existing guest identity columns.
- Added manager-only workspace operational health with scan/delivery/outbox counters, stale/failed/infected/dead-letter alerts, and a monitoring command that can fail on critical state.
- Added guest and operational requests and variables to the Postman collection.

### Decisions and boundaries

- `FILE_SECURITY_SCANNER` is a dotted Python class path. The built-in scanner only establishes the integration contract and detects the standard EICAR marker; production must configure a maintained malware engine or scanning service.
- Originals stay at private opaque keys while pending or rejected. Physical deletion/retention remains separate from logical quarantine.
- The initial preview is a safe metadata review card, not a decoded thumbnail, PDF raster, or audio waveform. Those richer variants can be added behind the same outbox/File Variant contract.
- Invite and access secrets are shown once and stored only as SHA-256 hashes. Revocation/rotation management endpoints remain a follow-up.

### Verification

- Focused tests cover pending download denial, clean scan and preview generation, infected-file blocking, critical operational alert state, guest comment/annotation authorship, missing permissions, missing access keys, and project scope.
- Full-suite, migration drift, system, Postman JSON, compilation, and whitespace checks are required before handoff.

### Next recommended milestone

Integrate a production scanner adapter and private object storage, then add invite revocation, guest attachment upload, decoded thumbnails/waveforms, and retention cleanup.

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
## 2026-09-01 — Guest ownership, decoded previews, and metrics

### Delivered

- Added guest-owned comment and annotation edit/delete APIs with explicit scoped permissions, exact-session ownership, audit events, and guest-attributed revision snapshots.
- Added guest revision-history endpoints; protected comment threads from deletion when another reviewer has replied.
- Added bounded Poppler PDF first-page rasterization and FFmpeg MP3 waveform decoding, with safe fallback cards when a decoder is unavailable or rejects input.
- Added a manager-protected Prometheus text endpoint for scan, delivery, outbox, alert, and workspace health metrics.
- Expanded Postman examples, environment documentation, and positive/negative tests for all four additions.

### Decisions

- Decoder processes receive argument arrays without a shell, private objects are copied into isolated temporary directories, and limits constrain time plus input/output size.
- Metrics use a fixed label vocabulary to avoid unbounded status cardinality.
- Guest identity is a `GuestSession`, not an email address; a different exchanged session cannot mutate content even if it represents the same email.

### Verification

- Focused guest-review and review-asset tests pass (22 tests).
- The full SQLite suite passes (86 tests), Django system checks pass, migration drift is clean, and the Postman collection parses as valid JSON.
- The Docker build installed Poppler/FFmpeg successfully but Docker Desktop failed while unpacking the resulting layer with a host `input/output error`; the same daemon storage error prevented the final PostgreSQL run. This is an environment limitation, not an application test failure.
# 2026-09-09 — Frontend onboarding, settings, and media upload

### Delivered

- Added verified-email onboarding and first-workspace creation; registration now enters this flow and the dashboard redirects workspace-less accounts into it.
- Added `/settings` with account identity, email-verification resend, workspace business-profile editing, and authenticated password change.
- Replaced the inert Projects upload button with a multipart asset dialog supporting the backend's accepted image and video types, priority, notes, and download policy.
- Streamed uploads through the same-origin Django rewrite with an explicit CSRF header, avoiding the 1 MiB Server Action request limit.

### Known limitations

- The API has no user-profile update endpoint, so account name, email, avatar, and timezone are displayed read-only.
- Workspace selection still defaults to the first authorized workspace.

### Verification

- TypeScript, ESLint, the Next.js production build, and patch whitespace checks pass.
# 2026-09-09 — Client-linked projects, review transitions, Google auth, and frontend tests

### Delivered

- Added nullable `Project.client_team` ownership with same-workspace validation and API serialization/input.
- Added a compatibility data migration that maps legacy `ClientTeam.metadata.project_ids` values, removes the legacy key, and preserves other metadata.
- Reduced campaign creation to one transactional project write and rebuilt frontend grouping from `client_team_id`.
- Added configured workflow-stage transitions to Review, including approval/completion-stage discovery and server-enforced permission feedback.
- Added an optional Google Identity Services button on sign-in and sign-up, exchanging the returned ID token through the existing Django Google endpoint.
- Added Vitest 3, jsdom, Testing Library, AppleDouble exclusions, a component interaction test, and a review view-model nesting test.

### Configuration

- Google sign-in requires the same Web OAuth client ID in backend `GOOGLE_OAUTH_CLIENT_ID` and frontend `NEXT_PUBLIC_GOOGLE_CLIENT_ID`; localhost origins must be authorized in Google Cloud.

### Verification

- Focused project authorization and media backend tests pass (29 tests).
- Frontend component/view-model tests pass (2 tests); TypeScript, ESLint, and the production build pass.
# 2026-09-09 — Persistent tasks, workspace switching, and task board

### Delivered

- Replaced dashboard-only task completion state with authenticated task status updates, optimistic feedback, and rollback on API failure.
- Added a cookie-backed workspace selector to the sidebar and made dashboard, projects, review, settings, tasks, and their mutations resolve the authorized selected workspace.
- Added `/tasks` with open/all/completed filters, search across task/project content, persistent completion and reopening, and task creation with project, priority, due date, and description.
- Added typed task create/update API methods and a shared task action layer used by both dashboard and task board.

### Decisions

- Workspace selection is an HTTP-only, same-site cookie validated against the live authorized workspace list on every load; invalid or stale ids fall back safely.
- Notifications remain account-wide because the existing endpoint is not workspace-scoped.

### Verification

- The backend task suite passes (18 tests).
- Frontend tests pass (2 tests); TypeScript, ESLint, the Next.js production build, and patch whitespace checks pass.
# 2026-09-09 — Team administration, file delivery, and richer review actions

### Delivered

- Added `/team` with live membership status, role and access-scope editing, custom-role creation, and workspace invitation creation with secure token handoff.
- Added `/files` with a searchable cross-project inventory, folder context, processing status, and CSRF-protected multipart uploads into a selected project/folder.
- Added `/deliverables`, listing only media versions whose download policy is enabled and linking through the permission-enforced media download endpoint.
- Added comment reaction summaries/actions and atomic revision requests with player timecodes to the review workspace.

### Decisions

- Project files are not presented as downloadable because the backend currently exposes metadata and deletion but no project-file download endpoint.
- Invitation tokens are shown exactly once after creation because invitation email delivery remains a backend gap.
- Advanced review work is incremental: reactions and revision requests are complete; annotation drawing and comment attachments remain next.

### Verification

- Frontend tests, TypeScript, ESLint, the Next.js production build, and patch whitespace checks pass.

# 2026-09-10 — Workspace asset library persistence

### Delivered

- Extended existing project file/folder rows with a required workspace and nullable client/project relationships, including an in-place backfill migration.
- Added workspace-level folder and file list/create/detail/update/delete endpoints plus authenticated downloads, while retaining project routes as filtered views of the same records.
- Added standalone root uploads, nested folders, project/client assignment, recursive folder reassignment, rename, deletion, and relationship validation.
- Replaced the Files page project-by-project request fan-out with one workspace asset read and connected optimistic create/upload/rename/move/delete interactions to the persistence API.
- Added backend coverage for unassigned assets, shared project visibility, and assignment changes.

### Verification

- Migration 0022 applies cleanly, Django system and migration-drift checks pass, and all 19 project/asset tests pass against PostgreSQL.
- Frontend TypeScript, ESLint, the production build, 4 test files, and all 10 tests pass.
- The full 224-test backend run reached 221 passing tests; three pre-existing shared-media-root tests collided on filesystem paths when run as one suite, while the isolated project/asset suite is green.

# 2026-09-10 — Global production task management

### Delivered

- Rebuilt `/tasks` as a workspace-wide five-stage production Kanban with To Do, Revisions, Internal QA, Client, and Approved columns.
- Added persistent drag-to-status ordering, a shared List view, search, and client/project/assignee/status/priority/due-date filters.
- Added complete create/edit/delete flows with optional client, project, assignee, and due date; selecting a project derives its client.
- Added nullable task client ownership, production workflow statuses, embedded assignee summaries, and safe project reassignment to the task API.
- Added a Project Tasks tab that filters the same task records and writes through the same endpoints—no duplicate task objects.

### Verification

- Migration 0023 applies cleanly; Django checks and migration drift are clean; all 19 task API tests pass against PostgreSQL.
- All 12 frontend tests, TypeScript, ESLint, and the production build pass.
- A public authenticated smoke test created a task, moved it from To Do to Revisions, and deleted it successfully through the ngrok origin.

# 2026-09-10 — Asset workflow status on uploads

### Delivered

- Added a fixed workflow status to every asset—Draft, In Review, Approved, Final, Archived—so an upload can be linked to a client, a project, and a status in one pass.
- Added `ProjectFile.status` (migration 0025) defaulting to `DRAFT`, indexed, and exposed on the asset API; `file.status` still reports the scan/processing state separately.
- Accepted `status` on asset upload and PATCH, rejecting unknown values, and left relationships untouched when only the status changes.
- Added a Status select to the upload dialog and the bulk Move / assign dialog, where an empty choice leaves each file's status alone.
- Added a per-file Status submenu to the card context menu, a status chip on every file card, an "All statuses" filter, and a Status row in Asset details.
- Cascaded bulk status changes from a selected folder down to every file beneath it, since status lives on files only.
- Coerced libraries persisted before this field existed to `DRAFT` on read, so existing local state keeps working.

### Verification

- Migration 0025 applies cleanly, `makemigrations --check` reports no drift, and all 23 project/asset backend tests pass against PostgreSQL.
- All 17 frontend tests, TypeScript, ESLint, and the production build pass.
- `test_owner_can_read_and_update_workspace` fails on this branch for an unrelated reason: `Workspace.task_workflow_settings` is a `JSONField(default=dict)` without `blank=True`, so `full_clean()` rejects its own `{}` default. Pre-existing, from the task-stages work in migration 0024.

# 2026-09-10 — Uploaded files reach the Status tab

### Delivered

- Fixed the Status tab showing nothing for a file uploaded with a status. Two causes, both addressed.
- Applied migration 0025 to the development database. It had only ever run against the throwaway test database, so `project_files.status` did not exist and every upload carrying a status failed server-side; the card users saw came from the browser's local library copy alone.
- Rebuilt the Status board around the five file statuses—Draft, In Review, Approved, Final, Archived—so anything uploaded through Files appears in the column for its status. Media-version stage columns still follow, and now only when versions actually exist, instead of leaving a project with stages but no media looking broken.
- Rendered an uploaded file as a board card: extension badge, size (or "Processing" until the scan finishes), and an inline preview for ready images.
- Refreshed the server-rendered Status tab after an asset write, once the API confirms it, so a status set in Files is not stale when the user switches tabs.
- Corrected the board's empty-state copy, which blamed missing workflow stages for what is now an unselected campaign.

### Verification

- All 22 frontend tests pass, including 5 new Status-board tests covering status grouping, empty projects, a missing status falling back to Draft, card labelling and image previews, and stage columns appearing only alongside media versions.
- TypeScript, ESLint, and the production build pass; migration 0025 is applied and `project_files.status` is present in development.

### Known issue, not addressed

- A failed asset upload leaves a card in the browser's local library with no error shown, because `updateNoWait` swallows the rejection. That is what hid the migration problem: the file looked uploaded and carried its status, while the server had never stored it.

# 2026-09-11 — Loading states for navigation

### Delivered

- Added `loading.tsx` to every route that renders the app shell—dashboard, projects, tasks, files, clients, team, settings, render queue, deliverables, review, and help—so a navigation shows a placeholder instead of a frozen page.
- Added a shared `PageSkeleton` that redraws the sidebar and topbar with the real shell classes. Each page renders its own `AppShell`, so a plain `loading.tsx` blanked the chrome on every navigation; the skeleton keeps it at the same geometry and only the content area visibly changes. Its padding mirrors `.studio-main > main` so nothing shifts when real content arrives.
- Gave the skeleton four content shapes—board, grid, list, split—matched to each route.
- Added a top progress bar for in-app navigation. The App Router exposes no router events, so it starts on a left-click of a same-origin link and clears when the resolved route changes; a 15s guard keeps an aborted navigation from stranding it.
- Added an inline pending spinner, via `useLinkStatus`, to the sidebar links, the workspace tabs, and the project sidebar's campaign links. A campaign link changes only query params, so it never reaches a `loading.tsx` fallback and would otherwise give no feedback at all.
- Replaced the Files-only placeholder with the shared skeleton and removed its now-dead CSS.
- Honoured `prefers-reduced-motion` for the pulse, bar, and spinner.

### Verification

- TypeScript, ESLint, all 22 tests, and the production build pass; every shell route still returns 200.
- Screenshotted the board, grid, and split skeletons with JavaScript disabled, which holds the streamed fallback on screen, and confirmed the chrome lands at the shell's real 256px sidebar and 56px topbar.

### Known trade-off, resolved the same day

- Adding the fallbacks briefly turned the signed-out redirect into a streamed `<meta http-equiv="refresh">` instead of an HTTP 307, because a Suspense boundary had already flushed. Moving the shell into a layout put `loadSession` back above that boundary and restored the real redirect. See the next entry.

# 2026-09-11 — The app shell persists across navigation

### Delivered

- Moved the signed-in chrome out of the pages and into a layout, so the sidebar and topbar are no longer torn down and rebuilt on every navigation. Only the page body changes.
- Grouped the eleven shell routes under `src/app/(app)/`—dashboard, projects, tasks, files, clients, team, settings, render queue, deliverables, review, help—with a single `layout.tsx` that resolves the session and workspace context once and renders `AppShell`. URLs are unchanged; a route group does not appear in the path.
- Left `/sign-in` and the other auth routes, `/onboarding`, and the public `/guest-review` outside the group, since none of them use the shell.
- Removed `AppShell` and its per-page session and workspace loading from all eleven pages. Seven no longer need `loadSession` or `loadWorkspaceContext` at all.
- Reduced `PageSkeleton` to the body alone; it no longer redraws a sidebar and topbar silhouette, because the real ones stay on screen. Per-route shapes are unchanged.
- Derived the projects page's full-bleed `flush` layout from the pathname inside `AppShell`, replacing the prop that only a layout-less page could pass.
- Repointed `@/app/tasks/*` imports at the new group path.

### Verification

- TypeScript, ESLint, all 22 tests, and the production build pass. The build lists all 18 routes at their original URLs.
- Every shell route answers 307 to a signed-out request again, `/sign-in` and `/guest-review` answer 200.

# 2026-09-12 — shadcn/ui and Skiper UI as the component baseline

### Delivered

- Added `frontend/components.json`, so the shadcn CLI works against this project for the first time. The app already had shadcn's output—`cn`, `cva`, Radix primitives, `src/components/ui/`—but never the config file the CLI reads.
- Declared the `@skiper-ui` registry in that config, so free Skiper UI components install with `npx shadcn add @skiper-ui/<name>`.
- Added `src/app/shadcn-theme.css`, mapping shadcn token names onto the Blaze Flow palette so registry components arrive in the studio theme instead of shadcn's default neutral grey. The mapping is one way: `shell.css` stays the source of truth and is never redefined, because `--muted` is a text colour here and a surface in shadcn—overwriting it would turn every `.muted` label into an unreadable block.
- Installed two free components. `TextRoll` animates the Files heading on hover and was kept. `ProgressiveBlur` was added to the projects client tree and then removed the same day—see below.
- Wrote the conventions into `frontend/AGENTS.md`, outside the block `next dev` regenerates.

### Registry components need three fixes on arrival

- The CLI adds `framer-motion` as a direct dependency; `motion` already depends on it, so that is a second copy and a second motion context. Removed it—the app imports `motion/react` throughout—leaving one copy as a transitive dependency.
- Registry items ship a `SkiperNN` demo export full of the vendor's own marketing copy and routes. Dropped, keeping only the real component.
- `TextRoll` renders one span per character, which assistive tech announces letter by letter. The character layers are now `aria-hidden` behind a single `aria-label`.

### Placement matters more than it looks

- `TextRoll` was first put on the projects campaign heading and moved. That heading ellipsises long campaign names, and per-character spans break `text-overflow`. The Files heading is short and fixed, so it is a safe slot. This is now a rule in `AGENTS.md`: these components assume they own their layout, and a fixed `line-height` also clips descenders.

### Verification

- TypeScript, ESLint, all 22 tests, and the production build pass; `npm ls framer-motion` shows a single copy under `motion`.
- The free tier is the 24 items that return 200 from `https://skiper-ui.com/r/<name>.json`; premium items 404 there. Nothing paid was used.

### Pre-existing, unrelated

- The dev server logs a hydration mismatch on `/projects` from browser-extension attributes (`webcrx`, `cz-shortcut-listen`) injected into `<html>` and `<body>`. Present before any of this work, and not fixable from application code.

# 2026-09-12 — Removed ProgressiveBlur from the projects rail

Reverted the `ProgressiveBlur` fade added to the client tree earlier today. It applied a
`backdrop-filter` over the bottom 44px of the rail unconditionally, with no knowledge of
whether the list actually overflowed, so on a short list it simply fogged the last row—in
practice the "Add folder in <campaign>" button, which looked broken rather than faded.

A scroll-aware version that appears only when the tree overflows and is not scrolled to the
bottom would be correct, but it is a decorative cue and not worth the scroll listener. The
component file was deleted since nothing else used it; `npx shadcn add @skiper-ui/skiper41`
brings it back. `TextRoll` on the Files heading is unaffected.

# 2026-09-12 — Asset library header actions use the shared Button

- Replaced the hand-rolled New folder and Upload buttons in the asset library header with the shadcn `Button` component, following the convention in `frontend/AGENTS.md`.
- Sized them `sm` when the library is embedded in a project tab and `md` on the standalone `/files` page. Embedded, the header block is hidden, so full-size actions sat directly under the tabs and dominated a compact view.
- Removed the two bespoke rules that existed only for these buttons (`.al-head button` and `.al-head button.primary`), leaving the shared declaration for the form and empty-state buttons that still rely on it.
- Replaced the fixed `.al-head svg { width: 15px }` with rules that track button size, so icons stay proportionate at `sm`.
- Gave `.asset-library.compact` 18px of top padding. Embedded, it sits directly beneath the project tab row, whose `border-bottom` the actions were touching.
- Right-aligned the actions in compact with `justify-content: flex-end`. The header uses `space-between`, but compact hides the heading block, and a lone remaining child under `space-between` falls to flex-start — which is why they had drifted to the left.

### Verification

- Rendered both sizes in a throwaway route and screenshotted them before deleting it. The first attempt was misleading: the preview did not import `asset-library.css`, so lucide's default 24px icons rendered instead of the sized ones. Importing the stylesheet and shooting at desktop width showed the real result.
- TypeScript, ESLint, and all 22 tests pass.

# 2026-09-12 — Removed the Assets tab from the project view

The Assets and Files tabs were not the same data. Assets rendered `MediaVersion` rows—the
versioned cuts that carry review stages, comments and approvals—while Files renders
`ProjectFile` rows, the asset library with its folders and statuses. The user's call was
that the distinction is not one this product needs to surface twice, so Assets is gone and
Files is the single place for a project's media.

### Delivered

- Dropped `Assets` from `TABS`; `Files` is now the first and default tab.
- Removed the tab's body: its toolbar, the per-asset search state, the grid, and `AssetTile`.
- Removed the asset-card chain from `projects-view.ts`, which nothing consumed once the tab
  was gone: the `AssetCard` type, `toAssetCard`, `demoAssets`, the `assets` field on
  `ProjectsView`, and the assignments feeding it.
- Kept `AssetTone` and `toneFor`—the Status board still uses both—and kept the
  `listMediaVersions` call, which feeds the board's stage columns and `assetCount`.

### Still reachable, and worth a follow-up

- Media versions remain visible on the Status board and under Active Reviews, so removing
  the tab hides no data.
- The header's **+ Upload Asset** button still uploads a `MediaVersion`, which is now a
  different thing from the Files tab's **Upload**. Two upload paths with near-identical
  labels in one view is the confusion that prompted this change; the button was left alone
  because renaming or rerouting it is a product decision, not a cleanup.

### Verification

- TypeScript, ESLint, all 22 tests, and the production build pass.

# 2026-09-12 — Folders and files share one grid

The asset library split its contents into a "Folders" section and a "Files" section, each
with its own heading and count. With one folder and no files that read as two near-empty
blocks. They are now a single grid, folders first.

### Delivered

- Merged the two sections into one `al-section` headed "Items" with a combined count.
- Render folders ahead of files in the same grid, so folders always lead. Each kind keeps
  its existing sort within that order.
- Replaced `.al-folder-grid` and `.al-file-grid` with a single `.al-grid`. The folder grid
  had wider tracks and a larger gap (245px/14px against 210px/12px), which would have made
  the two kinds disagree about column width once they shared a row.
- Dropped the folder preview from 150px to 125px to match the file preview, so a folder and
  a file in the same row line up. `align-items: start` keeps card tops aligned while letting
  each keep its natural height—file cards are slightly taller, carrying a status chip.
- Updated the dense (list) and responsive rules, which still referenced both old grids.

### Verification

- TypeScript, ESLint and 23 tests pass, including a new one asserting a single grid, no
  per-kind headings, and a folder card ahead of a file card.
- Rendered a mixed library of two folders and three files in a throwaway route and confirmed
  the layout before deleting it.

# 2026-09-12 — Asset menus rebuilt on Radix

Two reported bugs, both rooted in the menus being native `<details>` elements.

- **Menus never closed.** `<details>` only toggles from its own `<summary>`. Nothing
  dismissed it on an outside click and nothing closed a sibling, so every menu opened stayed
  open and they accumulated on screen.
- **Move / assign showed nothing.** The submenu was absolutely positioned outside its parent
  panel (`right: calc(100% + 5px)`), and that panel carried `overflow: auto`, which clipped
  it entirely. The Status submenu added earlier had the same defect.

### Delivered

- Added the shadcn `dropdown-menu` and rebuilt `ContextMenu`, `StatusMenu` and
  `AssignmentMenu` on it. Radix portals the content, so nothing clips it, and handles
  outside-click, Escape, focus and keyboard navigation.
- Extended Move / assign to offer **clients** on their own, not just projects. Assigning to a
  client sets `client_team_id` with no project, which is what the API already allowed but the
  menu never exposed. Items are grouped under Clients, Projects and Folders headings.
- Deleted the `.al-menu` / `.al-submenu` rules; only a trigger style and a density tweak
  remain, since the panel is styled by the shadcn component.

### The CLI needed correcting again

- It emitted `import { cn } from "cn"` and installed an unrelated npm package named `cn` to
  satisfy it, and pulled the `radix-ui` umbrella alongside the individual `@radix-ui/react-*`
  packages already here. Both repointed and both packages uninstalled. Recorded in `AGENTS.md`.

### A gap in the theme bridge

- shadcn components use a bare `border` utility whose colour comes from a base-layer default
  that `shadcn-theme.css` did not provide, so the browser fell back to `currentColor` and
  painted a white outline around every panel. Measured it rather than guessing: the computed
  `borderColor` was `#f4f3f8`, the text colour. Added the `@layer base` default, which is
  layered and therefore still loses to the app's own unlayered stylesheets.
- Menu text was also dropped from shadcn's 14px to 12px to sit with the surrounding cards.

### Verification

- Drove the menu in a browser: one menu open after a click, the assign submenu listing
  `Root / unassigned`, both clients and the project, and zero menus open after clicking away.
- TypeScript, ESLint, 23 tests and the production build pass.

# 2026-09-12 — Menu position, inline rename, and assignment persistence

### The three-dots button sat in the middle of folder cards

`.al-folder-card > footer > button` gives its children `flex: 1`, and the Radix trigger is a
real `<button>` where the old `<summary>` was not, so it claimed half the footer. A
`flex: none` on `.al-menu-trigger` did not help—the footer selector outranks it—so the rule
now excludes the trigger with `:not(.al-menu-trigger)`. Measured at 27px afterwards.

### Rename used the browser's prompt()

Replaced with an input rendered in place of the name on both card types. Enter commits,
Escape cancels, blur commits. The old `prompt()` sat outside the page entirely.

### Assignment appeared not to save

The backend was never at fault—two new tests assign a file and a folder to a client with no
project, and both persist and read back correctly (25 backend tests pass).

The frontend was. `AssignmentMenu` wrote through `updateNoWait`, which swallows rejections,
and unlike `StatusMenu` it never refreshed afterwards. So a failed write left the optimistic
copy on screen and, because the library is mirrored into `localStorage` and local rows
override server rows in `merge()`, that stale copy survived a reload and masked the truth.
Assignment now refreshes the server-rendered views once the API confirms, and on rejection
rolls the library back to its pre-write snapshot and says so.

### Still worth addressing

- `updateNoWait` still swallows failures everywhere else it is used—upload, delete, folder
  creation. Assignment was fixed because it was the reported symptom; the same trap remains
  on the other paths.
- `merge(serverFiles, stored.files)` letting `localStorage` win over server rows is the
  deeper design issue behind this class of bug.

### Verification

- Drove it in a browser: trigger 27px and flush to the footer's right padding, no native
  dialog raised on rename, inline input present, and the name updated after Enter.
- TypeScript, ESLint, 23 frontend tests, 25 backend tests, and the production build pass.

# 2026-09-12 — Writes report failure, and the server is authoritative again

The two problems flagged with the assignment fix, addressed together, because they were one
bug wearing two hats: a write could fail silently, and the local mirror then preserved the
lie indefinitely.

### Writes no longer fail silently

- Deleted `updateNoWait`, which was `promise.catch(() => undefined)` on every asset write.
- All eight call sites—upload, folder creation, rename, delete, bulk delete, status,
  assignment, bulk move—now go through one `useAssetWrite` helper. It applies the optimistic
  change, marks the affected rows in flight, and then either re-fetches the server views or
  rolls the library back to its pre-write snapshot and reports what failed.
- Failures surface in an in-page banner rather than an `alert()` or nothing at all.
- A component cannot consume a context it provides, so `AssetLibrary` passes its own refresh
  and reporter into the helper directly; everything below it uses the contexts.

### The local library no longer overrides the server

- The library was mirrored into `localStorage` and `merge()` let those rows win over server
  rows unconditionally and permanently. A failed write stayed on screen through a reload, and
  the sample content seeded into that store leaked into real workspaces—which is where the
  Footage, Graphics and Sound Effects folders nobody created came from.
- The store is now in memory only. A reload always shows what the server has.
- `merge()` treats server rows as the base. A local row wins only when the server has never
  heard of its id—a create still in flight—or while that row has a write outstanding, tracked
  by a `pending` set. Both conditions are temporary by construction.
- The sample library is passed in explicitly when there is no workspace, and is never mixed
  into a real one.

### Verification

- 27 frontend tests, four of them new: server rows beating a stale local copy, a local row
  held on screen while its write is in flight, the sample library appearing only with no
  workspace, and a rejected delete rolling back with its reason shown.
- TypeScript, ESLint and the production build pass.

# 2026-09-12 — Removed the Status tab from the project view

Tasks and Status were two boards in one view. Tasks renders `Task` records in the
workspace's customizable stages, with assignees, priorities and due dates; Status rendered
project *files* grouped by their fixed asset status. The user's call was that one board is
enough, so Status is gone and the project view is Files, Tasks, Brief & Specs, Activity Log.

### Delivered

- Dropped `Status` from `TABS` and removed its branch.
- Removed everything that existed only to serve it: `StatusBoard`, `BoardTile`, `BoardRow`,
  `CardMedia`, `CardMeta`, `AddCardButton`, `ViewToggle`, and the `dense` list-view state
  along with the `?view=list` parameter and `initialDense` prop that fed it.
- Removed the board chain from `projects-view.ts`, which nothing consumed once the tab was
  gone: `BoardCard`, `BoardColumn`, `ColumnTone`, `AssetTone`, `columnTone`, `toneFor`,
  `toBoardCard`, `toFileCard`, `buildBoard`, `demoBoard`, `shortDate`, and the `board` field.
  Its test file went with it.
- Narrowed the loader accordingly: it no longer fetches workflow stages or project files for
  this page, only media versions (for `assetCount`) and folders.
- `browser.tsx` is down from 403 to 264 lines and `projects-view.ts` from 245 to 121.

### Not done, because it is a product decision

The stated reason for the removal—that assigning a file a status should put it on the Tasks
board—describes behaviour that does not exist. Asset statuses (Draft, In Review, Approved,
Final, Archived) are a fixed enum on `ProjectFile`; task stages are per-workspace `TaskStage`
rows, and "In Progress" is a task concept, not an asset one. Nothing currently renders files
on the Tasks board. Asked rather than guessed at the mapping.

### Verification

- TypeScript, ESLint, 22 tests and the production build pass; `/projects` still serves.

# 2026-09-12 — Files use task stages and appear on the Tasks board

Replaced the fixed asset-status enum with a reference to the workspace's own task stages, so
a file assigned a stage shows up in that column on the Tasks board and can be dragged
between columns like a task. One vocabulary for work and for files.

### Backend

- `ProjectFile.status` (DRAFT/IN_REVIEW/APPROVED/FINAL/ARCHIVED) is gone; `ProjectFile` now
  has a nullable `task_stage` FK with `on_delete=PROTECT`, matching `Task`. `AssetStatus` is
  deleted. `clean()` rejects a stage from another workspace.
- Migration 0026 adds the column, backfills by mapping each old status onto the stage of the
  matching name in that workspace (To Do, Client, Approved; ARCHIVED deliberately drops to no
  stage), then removes `status`. Reversible.
- Deleting a stage already demanded a replacement when it held tasks; it now does the same
  when it holds files, and reassigns them alongside the tasks. Without that, `PROTECT` would
  have turned a stage deletion into a 500.
- `task_stage_id` is accepted on upload and PATCH. A `clear_stage` flag distinguishes "leave
  the stage alone" from "move it back to no stage", which a bare `None` cannot express.

### Frontend

- `FilesView` and `TasksView` both carry the workspace's stages; `TasksView` also carries the
  project files.
- The library's status chip, filter, per-file submenu, bulk dialog and upload dialog all work
  in stages now, and the chip takes its colour from the stage so it matches the board column.
- The Tasks board renders each staged file as a dashed card in its column, draggable to
  another column, which patches the file through the asset API with the same optimistic
  rollback the tasks use.

### Verification

- 25 asset tests pass, including a stage from another workspace being rejected, and a stage
  being set then cleared without disturbing the file's client or project.
- 23 frontend tests pass, one new: a staged file renders in its column, is counted in that
  column's badge, and is draggable.
- Migration 0026 applied to development: the one existing file moved from `DRAFT` to `To Do`.
- TypeScript, ESLint and the production build pass.

### Unchanged

- `test_owner_can_read_and_update_workspace` still errors on `task_workflow_settings` being
  blank. Pre-existing since 2026-09-10 and unrelated; the rest of the 231-test suite passes.

# 2026-09-12 — Local writes were failing CSRF

The error banner added earlier surfaced the real cause of every "it is not saving" report:

    CSRF Failed: Origin checking failed - http://localhost:3000 does not match any trusted origins.

Django checks the `Origin` header on unsafe requests against `CSRF_TRUSTED_ORIGINS`. That
list is built from `DJANGO_CSRF_TRUSTED_ORIGINS`, which defaults to empty, so a local clone
could not write at all—no upload, no assignment, no rename. Worse, setting the variable for a
tunnel *replaced* the list rather than extending it, so this environment trusted the ngrok
origin and nothing else.

This had been failing since long before today. `updateNoWait` swallowed the rejection, the
optimistic copy stayed on screen, and `localStorage` preserved it across reloads, so the UI
looked like it had saved. Removing that swallow is what finally made the cause visible.

### Delivered

- Under `DEBUG`, `CSRF_TRUSTED_ORIGINS` now always includes `http://localhost:3000` and
  `http://127.0.0.1:3000`, unioned with anything the environment supplies rather than
  replaced by it. Production is unchanged and still has to list its origins explicitly.
- Documented the variable in `.env.example`.

### Verification

- `CSRF_TRUSTED_ORIGINS` now resolves to the ngrok origin plus both local ones.
- A PATCH carrying `Origin: http://localhost:3000` no longer returns the origin error; it
  falls through to the normal authentication check.
- 57 asset and client-team tests pass.

Note the local `.env` was left alone—the fix belongs in settings so a fresh clone works, not
in one machine's configuration.

## 2026-09-12 — Video review workspace

Built the review experience: a focused, dark, video-first workspace reachable from every
place a video appears.

### The problem worth solving first

The brief's hard requirement was "one media file, many entry points, one review, one source
of truth". Blaze Flow describes a video in two unrelated tables — `ProjectFile` (the Files
library) and `MediaVersion` (a project deliverable, which is what review data hangs off) —
and nothing links them. The obvious approaches were both bad: duplicate the record, or
invent a join column.

Neither was needed. Both tables already point at the same third row:

```
ProjectFile.file_id ──┐
                      ├──► File
MediaVersion.original_file_id ─┘
TaskAttachment.file_id ─┘
```

So the `File` id became the identity. Every entry point links `/review?media=<file id>`,
and two entry points for one video now produce a byte-identical URL. `TaskAttachment.file`
falls out of the same join, which is why "Task → attachment → Review" opens the same cut
with no backend change. `?project=`/`?version=` still resolve, for older links.

### Delivered

- `lib/review-media.ts` — the catalogue: joins the sources on `File` id, infers version
  lines from filenames, and decides per cut whether review data has anywhere to live.
- `lib/review-local.ts` — notes for a library file that was never published as a media
  version. In memory only, and the page says so on screen.
- `app/(app)/review/writer.ts` — the single write path. The UI calls `compose` and never
  learns which backing it has, so the server and local paths cannot drift apart.
- Player: frame-accurate stepping (frame duration measured via `requestVideoFrameCallback`
  rather than assumed), speed, volume, source selector, fullscreen, J/K/L and arrow
  shortcuts, and comment markers on the timeline that seek, reveal that frame's drawings,
  and focus the note in one click.
- Comments: timecode pinning, threading, resolve/reopen, reactions, attachments, and
  mentions — mentions are real, `mentioned_user_ids` was already on the API and the
  notification path with it.
- Voice and screen recording via `MediaRecorder`. Real, not mocked, and needing no new
  endpoint: a comment already accepts file attachments and the mime type decides playback.
- Fields panel, version history, and a board-status control that writes the file's
  `task_stage` — so review and the task board share one state rather than each keeping its
  own.
- Entry points: Files, project files, the task board, deliverables, and the dashboard.

### Two hydration races, both found by looking at the page

The markup is server-rendered, so the browser settles the video before hydration attaches
any handler, and React's `onLoadedMetadata` / `onError` never fire:

- Duration stayed `0`, which collapsed every comment marker onto 0% of the timeline.
- A proxy that 404s left a blank stage instead of the "still being generated" message.

Both are fixed by reading `readyState` and `error` on mount rather than waiting to be told.
Neither was visible in the type checker, the linter, or the test suite — only in a browser.

### Verification

- 37 frontend tests pass, including 14 new ones covering the catalogue's grouping rules.
- Types, lint, and a production build are clean.
- Driven in Chrome against a generated test clip: a marker click seeks to 00:08 (confirmed
  against the burned-in timecode), renders that frame's annotation, and focuses its note;
  the mention picker filters and inserts; resolved notes hide and reveal; the draw tools
  arm. Composing, resolving and the local banner were exercised on the device-local path.

### Not done, and why

- Attaching an *existing* library file to a task. `TaskAttachment` can be read, but its
  upload endpoint takes a new file rather than a `file_id`, so creating that link from
  review needs a backend change. Reading linked tasks works today.
- "Uploaded by" — recorded by both models, returned by neither serializer. The panel says
  so rather than inventing a name.
- Capture paths could not be exercised here: a headless browser has no camera, microphone
  or screen to grant.

## 2026-09-12 — Files toolbar and filter panel

The Files page opened with a header, then a breadcrumb row, then a row of five filter
controls, and only then the grid. Two of those rows existed mostly to say "nothing is
filtered".

### Delivered

- Search and the grid/list toggle moved onto the actions row, beside New folder and
  Upload, so the page is a header and then content.
- The five filters (scope, client, project, file type, stage, sort) collapsed behind one
  **Filters** button. The trigger carries a count of what is active — with the controls
  hidden, that badge is the only thing distinguishing a filtered list from an empty folder
  — and a Reset appears alongside it once anything is set.
- The panel animates in with `motion`, honouring `prefers-reduced-motion`.

### Two library traps, both paid for

`npx shadcn add popover select` reproduced exactly what `frontend/AGENTS.md` already warns
about: it wrote `import { cn } from "cn"`, installed an unrelated package of that name, and
pulled the `radix-ui` umbrella alongside the individual packages already in use.

Then two new ones:

- **Portalled content cannot see `--shell-*`.** Those variables are declared on
  `.studio-shell`; Radix renders popovers into `document.body`. The panel came out fully
  transparent over the grid. The `:root` palette in `globals.css` is what works there.
- **Radix Popover polls under jsdom.** Floating UI's positioning never settles: a 130ms
  test became 1.8s, and opening the panel before a dialog hung the runner outright.
  Stubbing `ResizeObserver` and `IntersectionObserver` changed nothing. Radix `Select` was
  worse — it never opens under jsdom at all, and one keyboard path hangs.

So the panel is a small local component anchored to its trigger (no collision detection
needed), and the filters inside it are native `<select>`s with `color-scheme: dark`. The
suite went back to 37 passing in under two seconds. Radix Popover and Select were
uninstalled again; the Switch, Dialog and DropdownMenu still come from the registry.

### Also fixed

`tw-animate-css` was never installed, so the `animate-in` / `fade-in-0` / `zoom-in-95`
classes every shadcn component ships with resolved to nothing — menus and dialogs have been
appearing instantly this whole time. Importing it in `globals.css` switches them all on.

### Verification

- 37 tests, types, lint and a production build all clean.
- Driven in Chrome: the panel opens opaque, filtering by type drops the grid from 6 items
  to 4 and puts `1` on the trigger, and an outside click dismisses it. Checked at 1512px,
  900px and 760px, and in the compact project view — where the client and project filters
  correctly disappear, because that view is already scoped to one project.

## 2026-09-12 — One navigation rail, no topbar

The app had chrome on two edges: a sidebar and, above every page, a bar carrying a second
brand mark, four tabs, a search box, notifications and the account menu. The bar is gone.

Nothing it did went with it — deleting the bar would have taken sign-out, notifications and
three routes with it — so each piece moved into the sidebar:

- **Active Reviews, Render Queue, Deliverables** became a "Workspace" group in the nav.
  Its fourth tab, "All Projects", was the same `/projects` already linked above it.
- **Search**, **notifications** and the **account menu** moved into the rail; the account
  row now shows who is signed in rather than only an avatar.
- The calendar button was dropped: it linked to `/projects`, which the nav already does.

### Both rails collapse

The shell rail collapses to a 76px icon strip and the projects client rail collapses to
nothing, each behind a handle straddling its own edge. The main rail's state is a cookie
read in `(app)/layout.tsx`, so the first paint is already the right width — restoring it
after hydration would paint full-width and then snap shut on every load.

The width is a **registered custom property** (`@property --rail-w`), transitioned in CSS.
Registering it is what makes it animatable at all; an unregistered custom property jumps.
One transition then drives both the rail and the main column off the same value, so they
cannot drift apart mid-animation and nothing re-renders while it runs. The bounce is an
overshooting curve, `cubic-bezier(.34, 1.56, .64, 1)`, and `motion` is used only for the
handle's press — a transform, which is cheap. No GSAP: `motion` was already here, and a
second animation runtime for one handle is not worth its weight.

Measured in Chrome rather than assumed: 32 sampled frames over the transition produced 25
distinct widths, overshot past the target, and settled on exactly 76px.

### Knock-on fixes

Everything positioned under a 56px bar had to stop doing so — `main` padding, the review
workspace's `calc(100vh - 56px)`, and the projects rail's sticky offset. The review page
now measures exactly the viewport height with no page scroll. `.studio-main > main.flush`
also outranks the bare selector, so the mobile rule had to name it explicitly or the fixed
menu button sat on top of full-bleed pages.

### Verification

- 37 tests, types, lint and a production build all clean.
- Driven in Chrome at 1440px and 820px: both rails toggle and restore, the handles clear
  each other when the client rail is shut, the mobile breakpoint hides both handles and
  restores the off-canvas drawer, and neither page scrolls sideways.

## 2026-09-12 — Inline create forms could not be dismissed

Reported: opening "+ Add Subfolder" and then trying to back out left the form wedged in the
tree.

It was not a state bug so much as a missing feature, in all three inline forms — client,
subfolder and folder. None had a cancel control, none listened for Escape, none closed on
clicking away, and none closed on **success** either: the action returned `{error: null}`
both before and after saving, so a form had no way to tell that it had done its job.

The three hand-written copies are now one `InlineCreate` component:

- Escape and a cancel button always close it.
- Clicking away closes it **only while the field is empty**, so a half-typed name is never
  thrown away.
- `ActionState` gained `savedAt`, which makes a completed write distinguishable from the
  initial state, and the form closes on it.

Verified in Chrome, all four paths: opens on click, closes on Escape, closes on the cancel
button, closes on clicking away when empty, and stays open with "April 2026" intact when
clicking away after typing.

The rail handles were also reworked — a pill straddling the edge with a gradient, a
hairline top highlight and a drop shadow, plus an accent ring on hover, in place of the
flat disc.

## 2026-09-12 — Rename and delete from the projects tree

Right-clicking a subfolder or a folder in the projects rail now offers Rename and Delete.
Both endpoints already existed (`PATCH`/`DELETE` on the project and project-folder detail
routes); nothing new was needed server-side except one correction.

### The correction

`DELETE` on a project **archives** it — `archive_project` flips `status` and nothing more —
but the listing endpoint did not filter archived projects out. A delete would therefore
have left the row exactly where it was, in the tree, in the Files filters and on the task
board: the same "it did nothing" failure as the inline forms. `project_list_create` now
excludes `ARCHIVED`. No test depended on archived projects being listed.

### Frontend

- Radix's `ContextMenu`, not a hand-rolled one: it already handles opening at the pointer,
  Escape, outside clicks, keyboard navigation and Shift+F10. Unlike Popover it behaves
  under jsdom — the suite stayed at 37 passing in under two seconds.
- Rename happens in place, pre-selected, Enter to commit and Escape to abandon.
- Delete confirms first, and a refusal from the server is shown on the row rather than
  being swallowed.

A bug caught while testing: committing on the input's own `blur` meant clicking **Cancel**
blurred the field, saved the rename, and *then* cancelled. Only leaving the form entirely
commits now — verified by counting requests, which is zero during a cancel.

The shadcn CLI reproduced both documented traps again (`import { cn } from "cn"` plus a
package of that name, and the `radix-ui` umbrella). Both fixed as `frontend/AGENTS.md`
prescribes.
