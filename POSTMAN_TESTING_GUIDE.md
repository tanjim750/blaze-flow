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

Postman retains Django's `sessionid` and `csrftoken` cookies. Login saves the response's `csrf_token`, and unsafe requests send it through `X-CSRFToken`.

Register and Login deliberately ignore any stale session authentication, so they remain usable when Postman already holds cookies from an earlier test account. If behavior appears inconsistent after changing servers or databases, clear the cookies for `localhost` and log in again.

## 3. Test the owner flow

Run these requests individually in order:

1. **Health → Health Check**
2. **Authentication → Register**
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
20. **Review Comments → List Active Comments**
21. **Review Comments → Reply to Comment**
22. **Review Comments → Edit Own Comment**
23. **Review Comments → Comment Revision History**
24. **Review Comments → Resolve Comment Thread**
25. **Review Comments → Reopen Comment Thread**
26. **Review Comments → Request Media Revision**
27. **Media Versions → Workflow History** to confirm the Revision stage
28. **Review Comments → Upload Comment Attachment** after selecting a supported file
29. **Review Comments → Download Comment Attachment**
30. **Annotations → Create Annotation**
31. **Annotations → List Annotations**
32. **Annotations → Edit Own Annotation**
33. **Annotations → Annotation Revision History**
34. **Operations → Delivery Health**

Run **Delete Comment Attachment**, **Delete Annotation**, and **Delete Comment Thread** last, in that order.

For media upload, select a PNG, JPEG, GIF, WebP, MP4, QuickTime, or WebM file in the `file` form-data row. The request enables downloads by default for this manual flow. The server verifies its signature, records a SHA-256 checksum, and rejects a spoofed MIME declaration.

Do not run **Archive Custom Role**, **Archive Project**, **Remove Member**, or **Revoke Project Access** until those resources are no longer needed.

## 4. Test invitations and selected access

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

## 5. Test mentions and notifications

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

## 6. Correct payload formats

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

## 7. Expected responses

| Code | Meaning |
| --- | --- |
| `200` | Successful read or update |
| `201` | Successful creation or invitation acceptance |
| `204` | Successful logout, archival, or revocation |
| `400` | Invalid fields, conflict, duplicate, or expired token |
| `403` | Missing permission or CSRF token |
| `404` | Resource does not exist within the routed workspace/project |

## Limitations

- No administrator account is created automatically; use Register or `createsuperuser`.
- Invitation email delivery is not implemented; the raw token is returned once.
- Project and role deletion are lifecycle archival operations.
- Member removal uses `PATCH {"status":"REMOVED"}`.
- Access-grant detail supports `DELETE` only.
- Media signature validation and checksums do not replace malware scanning or deep decoder validation.
- Local media storage is development-only; production requires private durable object storage.
- Comment attachments, guest comments, pagination, and annotations are not implemented yet.
- HTML/localized email, push/WebSocket delivery, production metrics, and dead-letter alerting are not implemented yet.
- Attachment malware scanning, previews, physical cleanup, and guest-authored annotations are not implemented yet.
