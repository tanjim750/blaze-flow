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

## 6. Test mentions and notifications

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

## 7. Correct payload formats

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

## 8. Expected responses

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
- Access-grant detail supports `DELETE` only.
- The built-in EICAR-aware scanner is a development contract; configure the ClamAV adapter or another maintained scanner in production.
- Local storage is the development default; the S3-compatible adapter still requires a private bucket and production credentials.
- A retention-policy administration UI is not implemented yet.
- HTML/localized email and push/WebSocket delivery are not implemented yet.
- PDF/MP3 decoding requires Poppler and FFmpeg; Docker includes both, while local non-Docker setups must install them or will receive fallback preview cards.

## Guest mutation and metrics checks

Create a guest invite with the comment/annotation `edit` and `delete` permissions, exchange it, then run the guest create, edit, revision-list, and delete requests in order. The API permits changes only for content owned by that exact guest session. Run **Operations → Prometheus Metrics** while logged in as a workspace manager; the response is Prometheus text format rather than JSON.

Guest attachment deletion requires `review.attachment.delete` and works only for attachments on that guest session's own comment. Comment and annotation list requests can add `?limit=50&offset=0`; inspect the `X-Pagination-*` response headers for totals and the next offset.
