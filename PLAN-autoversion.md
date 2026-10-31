# Plan: auto-versioning uploads (Frame.io-style)

**Goal:** any reviewable upload into a project becomes a review version straight away (V1, V2…), with no publish step. "Files" is now a view over project assets. Guest links work on any uploaded file.

**This supersedes PR #121** (fix/share-file-guest-cut). Its "Publish & create link" confirm and the `409 not_published` path are no longer needed, because every project file already has a version. Close #121 once this lands. Its `&cut=` link scoping is carried over here.

## 1. Data model
- No new tables or columns. The link stays `MediaVersion.original_file == ProjectFile.file`.
- `ProjectFile` keeps the bytes, project, folder, asset and per-asset `version_number`.
- `MediaVersion` keeps the review data: comments, approvals, timecodes, drawings and stage history.
- New service `app/services/auto_version.py`, with `ensure_review_version(project_file, user, title, notify)`:
  - It is idempotent and runs under the `Project` row lock.
  - It allocates `next_media_version_number`, creates the `MediaVersion` plus the first-stage `MediaVersionStageEntry`, and writes the audit entry `media.auto_versioned`.
- Reviewable types: `video/*`, `image/*`, `audio/*` and `application/pdf`. Other documents (zip, docx…) stay plain files.
- The `ProjectFile` serializer gains `review_version_id`.

## 2. Migration / backfill (`0061_auto_version_project_files`)
- A RunPython step creates a version for every live, project-scoped, reviewable `ProjectFile` that doesn't have one.
- `created_at` is copied from the file row.
- It is idempotent.
- **Non-destructive:** nothing is deleted or updated apart from the project's version counter.
- The reverse is a deliberate no-op, so comments made after the migration are never lost. Rolling back the code leaves harmless extra versions.
- Row kinds touched (3):
  - INSERT `media_versions`
  - INSERT `media_version_stage_entries`
  - UPDATE `projects.next_media_version_number`
- **Files with no project (default chosen):** they stay as plain "Unsorted" files and are not touched. They auto-version the moment they are moved into a project (PATCH/move calls `ensure_review_version`). We considered auto-creating an "Inbox" project and rejected it, because it would hit plan project limits and surprise users.

## 3. Upload endpoints
All of these call `ensure_review_version` after the row is saved:
- `create_project_file_records`
- the project-files endpoint
- duplicate
- update/move

`/publish` stays for backward compatibility. It now delegates to the same service, so there is one code path.

## 4. Stacking as V2
`add_file_as_version` makes the new `ProjectFile` (per-asset `version_number` n+1), auto-creates its `MediaVersion` and sends the existing "new version added" notification once.

## 5. Files page
`/files` becomes a view over project assets, grouped by project, plus an **Unsorted** group for projectless files. Each card links to review via `review_version_id`. There is no separate library concept in the UI.

## 6. Removing publish and local notes
These go away:
- the "Publish to project" button, banner and dialog
- `publish.ts`
- `review-local.ts` (session-only notes) and the local branches in `writer.ts`

A projectless file shows "Move to a project to review" instead of offering local notes.

## 7. Guest links
The share modal is scoped to the file: it uses `review_version_id` and appends `&cut=<media_version_id>`, so the guest sees only that file. No publish is required. The backend guest invite also accepts `asset_file_id` and resolves it to the version.

## 8. Storage quota, AI QA, notifications
- **Quota:** still enforced at upload. A version adds no bytes, since no copy is made.
- **AI QA:** there is no automatic trigger today, so this is unchanged (it can still be run manually per version).
- **Notifications:**
  - V1: none (same as a plain upload).
  - V2+: "new version" fires exactly once.
  - The video preview job is enqueued as before.

## 9. Risks
- Moving a versioned file to another project leaves its `MediaVersion` in the old project (follow-up: move or re-link it).
- Version labels use the project-wide number; per-asset V-labels are a follow-up.
- On big projects the backfill makes many inserts. It is batched per project under a lock; run it in a quiet window.
- Old clients still calling `/publish` keep working.
