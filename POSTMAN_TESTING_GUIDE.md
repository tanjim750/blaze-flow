# Blaze Flow Postman Testing Guide

`Postman_Collection.json` matches the currently implemented Django routes and serializers. It uses session-cookie authentication and automatically captures IDs and tokens from successful responses.

## 1. Start Blaze Flow

Create `.env` from `.env.example`, then run:

```bash
docker compose up --build
```

Confirm that `http://localhost:8000/api/health/` returns `{"message":"ok"}`.

## 2. Import the collection

In Postman, select **Import**, choose `Postman_Collection.json`, and open the **Blaze Flow API** collection.

| Variable | Initial value | Purpose |
| --- | --- | --- |
| `base_url` | `http://localhost:8000` | Local API origin |
| `email` | `owner@example.com` | Account used by Register and Login |
| `password` | `a-secure-test-password` | Account password |
| `new_password` | `a-new-secure-test-password` | Replacement used by password reset/change |
| `reset_token` | Manual from reset email | One-time token consumed by reset confirmation |
| `google_id_token` | Manual, from a real Google Sign-In flow | Consumed by Google Sign-In; only needed if `GOOGLE_OAUTH_CLIENT_ID` is configured |
| `verification_token` | Manual from verification email | One-time token consumed by verification confirmation |
| `invitation_email` | `member@example.com` | Invited member account |
| `csrf_token` | Automatic | Captured after Login |
| `workspace_id` | Automatic | Captured after workspace creation |
| `project_id` | Automatic | Captured after project creation |
| `role_id` | Automatic | Captured after custom-role creation |
| `membership_id` | Automatic | Captured after invitation acceptance |
| `invitation_token` | Automatic | Captured after invitation creation |
| `grant_id` | Automatic | Captured after access creation |
| `media_version_id` | Automatic | Captured after media upload |
| `comment_id` | Automatic | Captured after creating a timestamped comment |
| `attachment_content_id` | Automatic | Captured after uploading a comment attachment |
| `annotation_id` | Automatic | Captured after creating visual markup |
| `mentioned_user_id` | Automatic | Captured by List Members for `invitation_email` |
| `notification_id` | Automatic | Captured from the invited user's unread inbox |
| `workflow_stage_id` | Automatic | Captured as In Review by List Workflow Stages |
| `guest_invite_token` | Automatic | One-time guest invite token |
| `guest_access_key` | Automatic | Guest API key sent in `X-Guest-Access-Key` |
| `guest_comment_id` | Automatic | Comment created by the guest flow |
| `guest_invite_id` | Automatic | Guest invite used by lifecycle requests |
| `guest_access_id` | Automatic | Exchanged access selected by List Guest Invites |
| `guest_attachment_content_id` | Automatic | Attachment uploaded by the guest |

Postman retains Django's `sessionid` and `csrftoken` cookies. Login saves the response's `csrf_token`, and unsafe requests send it through `X-CSRFToken`.

Password-reset request responses never reveal whether an email exists. With the development console email backend, copy the `token` query parameter from the server output into `reset_token`, then run **Confirm Password Reset**. Successful reset/change requests update the collection's `password` variable to `new_password`.

Registration automatically sends a verification message. Copy its `token` query parameter into `verification_token`, then run **Confirm Email Verification**. **Request Email Verification** resends safely without revealing whether the account exists and invalidates the previous active token.

Register and Login deliberately ignore any stale session authentication, so they remain usable when Postman already holds cookies from an earlier test account. If behavior appears inconsistent after changing servers or databases, clear the cookies for `localhost` and log in again.

## 3. Test the owner flow

Run these requests individually in order:

1. **Health → Health Check**
2. **Authentication → Register**, then **Confirm Email Verification** after setting `verification_token`
3. **Authentication → Login**
4. **Authentication → Current User**
5. **Workspaces → Create Workspace**
6. **Workspaces → List Workspaces**
7. **Roles → List Roles**
8. **Roles → Create Custom Role**
9. **Projects → Create Project**
10. **Projects → Project Detail**
11. **Media Versions → Upload Media Version**
12. **Media Versions → List Workflow Stages**
13. **Media Versions → List Media Versions**
14. **Media Versions → Media Version Detail**
15. **Media Versions → Download Media Version**
16. **Media Versions → Workflow History**
17. **Media Versions → Transition to In Review**
18. **Media Versions → Workflow History** again to see the closed and open entries
19. **Review Comments → Create Timestamped Comment**
20. **Review Comments → List Active Comments**, then **Add Comment Reaction**
21. **Review Comments → Reply to Comment**
22. **Review Comments → Edit Own Comment**
23. **Review Comments → Comment Revision History**
24. **Review Comments → Resolve Comment Thread**
25. **Review Comments → Reopen Comment Thread**
26. **Review Comments → Request Media Revision**
27. **Media Versions → Workflow History** to confirm the Revision stage
28. **Review Comments → Upload Comment Attachment** after selecting a supported file
29. Wait for **Operations → Operations Health and Alerts** to show the attachment scan as `CLEAN`, then run **Review Comments → Download Comment Attachment**
30. **Annotations → Create Annotation**
31. **Annotations → List Annotations**
32. **Annotations → Edit Own Annotation**
33. **Annotations → Annotation Revision History**
34. **Operations → Get Retention Policy**, then **Update Retention Policy** if you want a workspace override
35. **Operations → Delivery Health**
36. **Operations → Operations Health and Alerts**

The worker performs scan and preview events in separate batches. With Compose it runs continuously; for deterministic manual testing run `docker compose exec web python manage.py process_outbox` twice after an attachment upload.

Retention-policy reads show `source: environment_default` until a manager saves an override. Physical cleanup remains an operator command; use `purge_review_files --workspace-id <uuid> --dry-run` before a real workspace-scoped run.

## 4. Guest review flow

While authenticated as the owner, run **Guest Reviews → Create Guest Invite**. Then run **Exchange Guest Invite**, **Open Guest Review**, **Create Guest Comment**, **Add Guest Reaction**, **Create Guest Annotation**, and **Upload Guest Attachment**. The exchange and guest endpoints deliberately do not use the owner session or CSRF header; they authenticate with the one-time captured guest access key.

Run the outbox processor twice, then log back in as the owner and run **List Guest Invites and Access**. **Rotate Guest Access Key** captures the one-time replacement and invalidates the previous key. Run **Revoke Guest Access** or **Revoke Guest Invite** last; the current guest key must immediately return `403` afterward.

Run **Remove Guest Reaction**, **Delete Comment Attachment**, **Delete Annotation**, and **Delete Comment Thread** last, in that order.

For media upload, select a PNG, JPEG, GIF, WebP, MP4, QuickTime, or WebM file in the `file` form-data row. The request enables downloads by default for this manual flow. The server verifies its signature, records a SHA-256 checksum, and rejects a spoofed MIME declaration.

Do not run **Archive Custom Role**, **Archive Project**, **Remove Member**, or **Revoke Project Access** until those resources are no longer needed.

## 5. Test invitations and selected access

While logged in as the owner, run **Send Invitation**. The raw token is captured automatically.

Then create and authenticate the invited account:

1. Change collection variable `email` to the value of `invitation_email`.
2. Run **Register**.
3. Run **Login** to replace the owner session with the member session.
4. Run **Accept Invitation**. The new `membership_id` is captured.

Grant the project as the owner:

1. Change `email` back to `owner@example.com`.
2. Run **Login** again.
3. Run **Grant Project Access**. The `grant_id` is captured.

Verify the member by changing `email` to `member@example.com`, logging in, and running **Project Detail** and **List Media Versions**.

The Reviewer role can read comments, create comments, and edit only their own comments. It cannot resolve, reopen, or delete threads because it does not have `review.comment.manage`. It also lacks media-upload, download, transition, and project-delete permissions; those operations should return `403 Forbidden`.

## 6. Test client team administration and access

While logged in as the owner:

1. Run **Client Teams → Create Client Team**. `client_team_id` is captured.
2. Run **Client Teams → List Client Teams** and **Client Team Detail** to confirm it reads back.
3. Run **Client Teams → Update Client Team** to set profile fields such as `phone` or `description`.
4. Change `email` to `member@example.com` (the account must already be registered; run **Register** first if it is not) and run **Login**.
5. Change `email` back to `owner@example.com`, log in again, and run **Client Teams → Add Client Team Member** with `invitation_email` as the member's email. `client_team_member_id` is captured.
6. Run **Client Teams → Grant Client Team Workspace Access** with `role_id` set to the Member role. This creates the `CLIENT_TEAM` workspace membership; its `id` is the membership to use afterward with **Members and Invitations → Update Member** if the role or project-access mode needs to change.
7. Log in as `member@example.com` and confirm the workspace and its projects are now visible, inherited through the client team membership rather than a direct membership.

Removing a member (**Remove Client Team Member**) only removes that person; the client team keeps its workspace access for any other active members. Archiving the client team (**Archive Client Team**) immediately revokes inherited access for every member, independent of the underlying `WorkspaceMembership` row, so run it last.

`client_team.manage` is required to create, update, add/remove members, and archive; `client_team.manage` alone does not grant workspace access — that step requires `workspace.members.manage`, the same permission that guards **Update Member**.

As an alternative to **Add Client Team Member**, onboard members by invite:

1. As the owner, run **Client Teams → Create Client Team Email Invite** with `invitation_email`, or **Create Client Team Link Invite** for a reusable, non-recipient-bound link. Either way `client_team_invite_token` is captured; the raw token is returned only in this response.
2. Log in as the intended recipient and run **Client Teams → Accept Client Team Invite**. An `EMAIL` invite requires the logged-in account's email to match `recipient_email` exactly and is single-use; a `LINK` invite accepts any authenticated user up to its `max_uses` (unlimited if omitted). Re-accepting the same invite as the same user is idempotent and does not consume a second use.
3. As the owner, run **List Client Team Invites** to see `use_count` update, and **Revoke Client Team Invite** to invalidate a link early. Revocation does not remove access already granted through it; use **Remove Client Team Member** for that.

Accepting an invite never creates a direct `USER` workspace membership by itself; the member still only gains workspace access once someone runs **Grant Client Team Workspace Access** for the client team.

## 7. Test tasks

Tasks can be workspace-level (no project) or scoped to a project. Access to a project-scoped task always follows the same project permission as the project itself; access to a workspace-level task only depends on the workspace role.

1. As the owner, run **Tasks → Create Workspace Task**. `task_id` is captured.
2. Run **Tasks → Task Detail**, **Update Task** (for example set `status` to `IN_PROGRESS`, then `COMPLETED` to see `completed_at` populate, then back to `TODO` to see it clear), and **List Tasks**.
3. Run **Tasks → Assign Task** with `membership_id` set to a member's membership. `task_assignee_id` is captured. Run **List Task Assignees**, then **Unassign Task**.
4. Run **Tasks → Upload Task Attachment** with a supported file selected in the `file` form-data row, then **List Task Attachments** and **Delete Task Attachment**.
5. Run **Tasks → Create Project Task** with `project_id` set to an existing project. A member without access to that project (no `ALL` access, no grant) gets `403` from **Task Detail** even if they can read workspace-level tasks; granting **Projects → Grant Project Access** for that project immediately allows it.
6. Run **Tasks → Delete Task** as the owner. The Member role does not have `task.delete`, so a member attempting the same request gets `403`; both `task.create` and `task.update` are available to Member, so members can create and edit tasks (including their attachments and assignees).

## 8. Test project files and folders

Unlike tasks, every folder and file belongs to exactly one project, so access always follows that project's permissions (`project_file.read`/`create`/`update`/`delete`), never a workspace-level check.

1. As the owner, run **Project Files → Create Root Folder**. `project_folder_id` is captured.
2. Run **Create Root Folder** again with the same name; it fails with `400` because root-level names must be unique within the project. Change the name and create a second root folder, then create a folder with `parent_folder_id` set to the first one's id — nested folder names only need to be unique among siblings, so the same name is allowed under a different parent.
3. Run **List Project Folders**. Folders come back as a flat list with `parent_folder_id`; assemble the visible tree client-side, the same way review-comment threads work.
4. Run **Rename Folder**. A folder's parent cannot be changed later; there is intentionally no "move folder" operation in this milestone.
5. Run **Upload Project File** with a supported file selected in the `file` form-data row, leaving `folder_id` disabled to place it at the project root. Run it again with `folder_id` enabled to place a file inside the folder from step 1.
6. Run **List Project Files**, then **Delete Project File**. Deletion removes only the project/file association; the underlying `File` record is not destroyed.
7. Run **Delete Folder** last. It cascades: descendant folders and the project files inside them are all soft-deleted in one request, but their underlying `File` records are retained the same way.

## 9. Test workspace lifecycle and profile

1. As the owner, run **Workspaces → Workspace Detail** and **Update Workspace** (rename it or change its timezone; the slug is fixed at creation and cannot be changed here).
2. Run **Get Workspace Profile**. It returns empty fields and does not create anything until you run **Update Workspace Profile**, which creates the row on first write and updates it in place afterward.
3. As `member@example.com`, confirm **Workspace Detail** and **Get Workspace Profile** both return `200` (Member has `workspace.read`) while **Update Workspace** and **Update Workspace Profile** both return `403` (only Owner has `workspace.manage`).
4. As the owner, run **Schedule Workspace Deletion**. The workspace moves to `PENDING_DELETION` with `deletion_scheduled_at` set roughly `WORKSPACE_DELETION_GRACE_DAYS` (default 30) days out; nothing is physically deleted. Run **Restore Workspace** to cancel it and return to `ACTIVE`.
5. Running **Schedule Workspace Deletion** a second time while already `PENDING_DELETION`, or **Restore Workspace** while still `ACTIVE`, both return `400`.

Only run step 4 at the very end of a manual test session against a workspace you are done with — every other request in this guide assumes the workspace stays `ACTIVE`.

## 10. Test subscriptions and plan limits

There is no payment provider wired up; "PRO" is a self-service simulation and "cancellation" only takes effect once an operator runs a command.

1. As the owner, run **Subscriptions → Get My Subscription**. A freshly registered account already has a `FREE` row (provisioned at registration); `limits.max_workspaces_owned` is `1` and `limits.max_projects_per_workspace` is `3` by default.
2. Run **Workspaces → Create Workspace** again on the same account. It fails with `400` — the owner already owns one active workspace, which is the FREE limit.
3. Run **Subscriptions → Upgrade to PRO**. `plan` becomes `PRO` and a `current_period_end` roughly `SUBSCRIPTION_PRO_PERIOD_DAYS` (default 30) days out appears. Running it again immediately fails with `400`.
4. Retry **Create Workspace**; it now succeeds, since PRO's limit is much higher.
5. In the original workspace, create three projects (**Projects → Create Project**, three times); a fourth fails with `400` while still on FREE. If you already upgraded in step 3, the owner's new PRO limit covers many more, so this check only demonstrates the cap on an account still on FREE.
6. Run **Subscriptions → Cancel Subscription**. It returns `200` with `cancel_at_period_end: true`, but `plan` is still `PRO` — nothing downgrades until the period actually ends. Run **Resume Subscription** to undo it before the next step, or leave it to observe the operator flow.
7. To simulate the period ending, an operator would run:

```bash
docker compose exec web python manage.py process_expired_subscriptions --dry-run
docker compose exec web python manage.py process_expired_subscriptions
```

The command only affects rows with `cancel_at_period_end=True` and `current_period_end` in the past; there is no scheduler wired up to run it automatically.

## 11. Test Google sign-in

This requires `GOOGLE_OAUTH_CLIENT_ID` to be set in the running server's environment and a real Google OAuth client configured in Google Cloud Console; Postman cannot generate a Google ID token itself.

1. Leave `GOOGLE_OAUTH_CLIENT_ID` unset and run **Authentication → Google Sign-In**. It returns `400` with a "not configured" message and does not attempt any network call.
2. Configure `GOOGLE_OAUTH_CLIENT_ID`, restart the server, obtain a real ID token for that same client ID from a frontend Google Sign-In button (or Google's OAuth Playground configured with your client), set `google_id_token`, and run **Google Sign-In** again. `csrf_token` is captured the same way as **Login**.
3. A first sign-in with a verified Google email and no matching account creates a new user (email already marked verified, password unusable, a `FREE` subscription provisioned, same as **Register**), links a Google `OAuthIdentity`, and starts a session.
4. Running **Google Sign-In** again with the same Google account reuses the same identity and user — no duplicate account is created, and the identity's cached name/picture are refreshed from the new token's claims.
5. If a Google account's email matches an already-registered Blaze Flow account (created through **Register**) and the Google email is verified, signing in links that Google identity to the existing account instead of creating a second one. If the Google email is not verified, linking is refused rather than silently trusting it.
6. A suspended account cannot sign in through Google either way (matched by an existing linked identity, or matched by email) — both return `400`.

## 12. Test mentions and notifications

After the member has accepted the invitation and the owner has granted project access:

1. Log in as the owner.
2. Run **Members and Invitations → List Members** to capture `mentioned_user_id`.
3. Run **Review Comments → Create Comment with Mention**.
4. Confirm the response includes the member under `mentions`.
5. Log in as `member@example.com`.
6. Run **Notifications → List Unread Notifications** to capture `notification_id`.
7. Run **Notifications → Get Notification Preferences**.
8. Run **Notifications → Update Notification Preferences**.
9. Run **Notifications → Mark Notification Read**.
10. Run **List Unread Notifications** again and confirm it returns an empty list.
11. Run **Mark All Notifications Read**; `updated_count` should be `0` if nothing else is unread.

Outbox events are separate from the in-app inbox. Publish pending events to registered handlers with:

```bash
docker compose exec web python manage.py process_outbox --limit 100
```

Local development prints email content to the web/worker console. For SMTP delivery, configure the `EMAIL_*`, `DEFAULT_FROM_EMAIL`, and `APP_BASE_URL` variables documented in `.env.example`.

After correcting a terminal delivery problem, requeue dead letters explicitly:

```bash
docker compose exec web python manage.py requeue_dead_letters --limit 100
```

The Compose stack also starts a continuous `worker` service. Use `docker compose logs -f worker` to inspect processing output.

## 13. Correct payload formats

Roles use `permission_keys` and dot-separated application keys:

```json
{
  "name": "Reviewer",
  "description": "Reviews selected project media",
  "permission_keys": [
    "workspace.read",
    "project.read",
    "media.read",
    "review.comment.read",
    "review.comment.create"
  ]
}
```

Explicit project access targets a Workspace Membership:

```json
{
  "membership_id": "{{membership_id}}"
}
```

The membership must be active, belong to the same workspace, and use `SELECTED` scope. `ALL` memberships do not need grants.

## 14. Expected responses

| Code | Meaning |
| --- | --- |
| `200` | Successful read or update |
| `201` | Successful creation or invitation acceptance |
| `204` | Successful logout, archival, or revocation |
| `400` | Invalid fields, conflict, duplicate, or expired token |
| `403` | Missing permission or CSRF token |
| `404` | Resource does not exist within the routed workspace/project |
| `409` | Attachment is still quarantined or was rejected by scanning |

## Limitations

- No administrator account is created automatically; use Register or `createsuperuser`.
- Invitation email delivery is not implemented; the raw token is returned once.
- Project and role deletion are lifecycle archival operations.
- Member removal uses `PATCH {"status":"REMOVED"}`.
- Client team deletion is lifecycle archival; client team member removal uses `DELETE`, not `PATCH`.
- Task attachment uploads use the same signature-verified type allowlist as review attachments, now including DOCX/XLSX/PPTX (verified by the internal ZIP part, not just the outer `PK` signature) and RTF. Legacy binary Office formats (`.doc`, `.xls`, `.ppt`, the pre-2007 OLE compound-file formats) and formats with no reliable magic bytes (`.csv`, `.txt`) are still not accepted — the latter would require trusting the file extension alone, which conflicts with this project's signature-verification model. Task attachment scanning is queued through the same worker as review/media attachments; deletion removes only the association, not the underlying `File`.
- Project files share the same signature-verified type allowlist as task attachments (same legacy-format/no-magic-bytes limitation). A folder's parent cannot be changed after creation, and a file's folder cannot be changed after upload — reorganizing means deleting and re-adding.
- A workspace's slug is fixed at creation. `PENDING_DELETION` only schedules and can be restored; there is no operator command yet that physically purges a workspace once its grace period elapses (every child table uses `on_delete=DO_NOTHING`, so cascading physical deletion needs dedicated work across every domain, not just the Workspace endpoint).
- There is no payment provider integration. "Upgrade to PRO" is a self-service simulation with no charge; "Cancel Subscription" only schedules `cancel_at_period_end` and requires the `process_expired_subscriptions` operator command to actually downgrade once the period ends — nothing runs that command on a schedule automatically. Only `max_workspaces_owned` and `max_projects_per_workspace` are enforced; other resource limits (members, storage, media) are not yet capped by plan.
- Google Sign-In verifies an ID token issued by an existing Google OAuth client; this project does not implement the browser-side "Sign in with Google" button/redirect flow that produces that token — a frontend or a tool like Google's OAuth Playground must obtain it. No other OAuth providers are implemented.
- Client team invite email delivery is not implemented; the raw token is returned once. Accepting an invite only creates client-team membership, never a direct workspace membership.
- Access-grant detail supports `DELETE` only.
- The built-in EICAR-aware scanner is a development contract; configure the ClamAV adapter or another maintained scanner in production.
- Local storage is the development default; the S3-compatible adapter still requires a private bucket and production credentials.
- A retention-policy administration UI is not implemented yet.
- HTML/localized email and push/WebSocket delivery are not implemented yet.
- PDF/MP3 decoding requires Poppler and FFmpeg; Docker includes both, while local non-Docker setups must install them or will receive fallback preview cards.

## Guest mutation and metrics checks

Create a guest invite with the comment/annotation `edit` and `delete` permissions, exchange it, then run the guest create, edit, revision-list, and delete requests in order. The API permits changes only for content owned by that exact guest session. Run **Operations → Prometheus Metrics** while logged in as a workspace manager; the response is Prometheus text format rather than JSON.

Guest attachment deletion requires `review.attachment.delete` and works only for attachments on that guest session's own comment. Comment and annotation list requests can add `?limit=50&offset=0`; inspect the `X-Pagination-*` response headers for totals and the next offset.
