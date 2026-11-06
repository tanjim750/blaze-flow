# Reliable uploads and downloads

## What was actually wrong

1. **Screen off / connection loss:** the browser owns its network stack, and phones may freeze a page on lock. The tray had no wake lock, no return/online recovery, and gave up after a few part errors. Normal file downloads already redirected to signed R2 URLs, but guest attachments fetched the whole file into a JavaScript Blob; folder ZIPs also depend on the page's running JavaScript.
2. **Interrupted uploads:** multipart uploads already existed (PRs #131/#133), with bounded concurrency, exponential retry delays and refreshed part URLs. However, resuming trusted localStorage's completed-part list. A part whose success reply was lost could be uploaded again; stale saved parts could incorrectly skip bytes. The API did not expose an authoritative list of saved parts.
3. **Cancel one at a time:** the tray only had per-file controls, and cancelling a queued item immediately started another queued upload. Also, storage abort failures were swallowed, making cancellation look successful even when parts remained.
4. **Re-upload after closing the tab:** the browser resume key included workspace/name/size/date but not project/folder/stage. The server did not match a newly selected file to an open upload. Clearing browser metadata therefore meant a fresh transfer, and identical names in different destinations could collide. The old expiry was only 24 hours.

## Changes

- While transfers run, request a Screen Wake Lock if supported. Reacquire it on returning to the visible page; release when idle. Healthy desktop background requests are not deliberately stopped.
- Storage PUTs have a two-minute inactivity timeout (reset on progress) and detect a stalled request on returning to the page. Part failures wait for visibility/connectivity instead of exhausting retries while a phone is locked. The tray automatically retries recoverable interrupted R2 uploads on `visibilitychange`, `online`, and a 30-second recovery check, without retrying deterministic permission/validation errors or automatically replaying legacy form uploads.
- `GET uploads/<id>/parts/` lists the bucket's successfully completed, correctly sized parts. The client reconciles before sending, including on first initialize. The bucket remains the source of truth; the database stores the multipart ID/key, part size, owner, destination and file identity. ETags are never trusted from client completion requests.
- Initialize reuses an unexpired multipart session owned by the same user, with matching workspace/client/project/folder/task stage, filename, size, declared type, optional checksum and `lastModified`. Matching and quota reservation run under the workspace lock. Browser metadata uses the same destination scope. Picking the same file again can recover even if localStorage was cleared.
- Default part size and single-PUT ceiling are 8 MiB. The smallest recoverable unit is a completed part, not an arbitrary byte within an unfinished part. Larger configured part sizes remain supported.
- **Cancel all** asks once, marks the whole upload selection cancelled before freeing queue slots, aborts active browser requests, cleans up saved R2 sessions (including parked uploads), and cancels all tracked folder downloads. Abort failures remain visible and can be retried; the server does not acknowledge failed storage cleanup. Finalizing/completed files cannot be accidentally deleted by cancellation.
- Existing `expire_direct_uploads` scheduler runs every 30 minutes. Default session retention is now seven days; expired failed sessions are cleaned too, with retries if storage is unavailable. Existing explicit environment settings override these defaults.
- Guest attachments request a small authenticated signed-link response and use native browser downloads on R2, keeping access keys out of URLs. Local-storage fallback retains its existing authenticated Blob route.
- An interrupted **in-tab folder ZIP** stream reconnects with `Range` at the last byte written to the ZIP and refreshes expired URLs. It validates HTTP 206, exact Content-Range and ETag (when exposed) rather than silently duplicating/corrupting ZIP bytes. All page-managed folder downloads appear in the tray and participate in Cancel all.

## Browser limits — do not promise the impossible

- A website cannot override a manual screen lock, OS suspension or iOS Safari freezing JavaScript. Wake Lock only prevents automatic screen sleep while the page is visible, and may be denied (e.g. battery saver). Completed upload parts are retained; the unfinished part is retried when the page returns.
- After closing a tab, the browser normally forgets the `File` object. Users must pick the same file again; there is no silent access to their disk. Resume identity uses metadata, not a full-file fingerprint; files deliberately changed while preserving all metadata cannot be distinguished unless a checksum is supplied.
- Native browser downloads are **not** JavaScript-controlled: their cancel/resume controls live in the browser's download manager. Cancel all cannot stop those. Reopening an expired download URL requires requesting a new link.
- Folder ZIPs are assembled in the page, so keeping the tab open is required. Their in-tab recovery does not survive a tab close. Browser/OS sleep can still pause them. ZIP Blob fallback is still limited to 2 GiB; supported desktop browsers can stream to disk.
- Byte-preserving upload resume applies to the existing authenticated direct-to-R2 **Files/task-drawer asset** flow, with `DIRECT_UPLOADS_ENABLED=true`. Public upload links, client-portal submissions, standalone media-version uploads and chat/review/task attachments still use their existing distinct form-upload protocols; they benefit from wake lock/cancel controls, **not** multipart byte resume. Local storage and small single PUTs restart their unfinished request. These limitations must be communicated rather than claiming all upload surfaces are resumable.

## Rollout prerequisites (no production changes made)

- Apply migration `0065_direct_upload_resume_identity` before deploying the new backend. Old clients can continue using existing endpoints.
- Verify R2 CORS allows the app origin, PUT/GET/HEAD, `Range` and `If-Match`, and exposes `ETag` and `Content-Range`. Existing upload CORS must continue exposing ETag. A browser that cannot validate a resumed download safely gets a clear restart error.
- Consider a bucket lifecycle rule to abort incomplete multipart uploads after seven days as a second safety net. The app scheduler can only clean sessions recorded in its database. Configure bucket lifecycle separately with approval; this PR does not change R2 settings.
- Keep `DIRECT_UPLOAD_TTL_SECONDS` consistent with the desired retention (default 604800), and confirm the scheduler is running. No server environment or bucket settings have been changed.

Reference: https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API
