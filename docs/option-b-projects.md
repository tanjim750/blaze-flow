# Option B: Projects is home

Projects contains the project list and an **All files** row for finding files across projects.
Open a project to upload files or folders. Old `/files` bookmarks keep their search and
folder parameters and redirect to All files. Old `?view=unsorted` bookmarks open the real
Unsorted project, subject to the viewer's usual project access.

## Folder guest links

The existing guest-invite API accepts `shared_folder_id` for a live folder in the project.
It cannot be combined with `asset_file_id`. Guest sessions, short links, expiry, revocation,
comment/approval permissions and download permissions are unchanged.

Scope is checked on the server on every media, comment, annotation, attachment, signed
playback and folder-download request. The scope follows the live folder tree: a file moved
out is no longer accessible. Deleted or moved-out folders never turn a link project-wide.
The guest review page lists only review versions inside the shared folder and its live
subfolders. It shows the folder name instead of the project's name and private brief.
Download folder paths do not include ancestor names. Existing reviewable-file and
per-file download rules still apply; this is not a new arbitrary-file public hosting API.
Replacing a folder link preserves its folder scope. A file link cannot be replaced with a
project-wide link; users are directed to create a new link from that file instead.

## Unsorted migration and rollback

- `0066_option_b_scope_and_unsorted` adds the guest-folder UUID and the Unsorted flag/journal.
  The UUID intentionally is not a nullable FK that could become null on deletion and widen access.
- `0067_unsorted_projects` creates one separate Unsorted project per existing studio, including
  empty studios. It does not reuse or rename a user-created project called Unsorted.
- It moves only `ProjectFile` and `ProjectFolder` rows with no project, including soft-deleted
  rows. Existing project assignments, file IDs, storage keys and actual file bytes are unchanged.
- A single studio project has no client: previous per-file/folder client assignments are saved
  in a private JSON rollback journal, then cleared to keep project relationships valid.
- Folder hierarchy is retained. Duplicate root names receive a deterministic UUID suffix;
  original names and parent relationships are kept in the rollback journal.
- It uses historical models and the migration database alias, with no processing jobs,
  notifications, external requests, or production credentials. Running the forward function
  twice does not create more projects or move more data.
- Reverse `0067` restores the journaled file/folder relationships and names for rows still in
  the generated project. Explicit moves to another project are left alone. Empty generated
  projects are removed. If later uploads, tasks, reviews or links reference one, it is kept
  as an ordinary project instead of deleting later user work. Then `0066` can also reverse.
- The journal is not in API serializers. Keep a fresh database backup before any future
  deployment. This PR does not run migrations on live or shared databases.

Normal-merge base: `1584da7` (PR #150). No conflicts occurred; the live tray animation,
right-aligned Cancel all button, abort confirmation and resumable transport were preserved.
