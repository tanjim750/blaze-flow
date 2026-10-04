import re
import uuid
from urllib.parse import urlencode

from django.db import transaction
from django.utils import timezone

from app.models import (
    Notification,
    ClientTeamMember,
    ClientTeamMemberStatus,
    MediaVersion,
    NotificationKind,
    NotificationSetting,
    OutboxEvent,
    ProjectFile,
    ReviewComment,
    ReviewCommentContent,
    ReviewCommentMention,
    ReviewCommentVisibility,
    TaskAssignee,
    TaskAttachment,
    User,
    UserStatus,
    WorkspacePrincipalType,
)
from app.permissions import (
    MEDIA_READ,
    REVIEW_COMMENT_READ,
    TASK_READ,
    active_memberships_for_user,
    has_project_permission,
    has_workspace_permission,
)


class NotificationError(Exception):
    pass


# The kinds a person can switch off in-app, in the order Settings lists them.
CONFIGURABLE_KINDS = (
    (NotificationKind.REVIEW_COMMENT_MENTION, 'Mentions', 'Someone @mentions you in a review note.'),
    (NotificationKind.REVIEW_COMMENT_REPLY, 'Replies', 'Someone replies to one of your notes.'),
    (NotificationKind.REVIEW_COMMENT_NEW, 'Notes on your cuts', 'A new note on a cut you uploaded or are assigned to.'),
    (NotificationKind.MEDIA_VERSION_NEW, 'New versions', 'A new version of a file you commented on or are assigned to.'),
    (NotificationKind.MEDIA_APPROVED, 'Approvals', 'A cut you uploaded or are assigned to is approved.'),
    (NotificationKind.MEDIA_CHANGES_REQUESTED, 'Changes requested', 'Someone requests changes on a cut you uploaded or are assigned to.'),
    (NotificationKind.TASK_ASSIGNED, 'Task assignments', 'A task is assigned to you.'),
    (NotificationKind.TASK_CLIENT_READY, 'Ready for client review', 'A task moves to client review (client contacts only).'),
    (NotificationKind.CLIENT_UPLOAD_RECEIVED, 'Files from clients', 'A client sends files through an upload link or the client portal.'),
    (NotificationKind.PROJECT_REQUEST_NEW, 'Project requests', 'A client asks for a new project from the portal.'),
    (NotificationKind.PROJECT_REQUEST_DECIDED, 'Request answers', 'The studio accepts or declines a project you asked for.'),
    (NotificationKind.PROJECT_MESSAGE_NEW, 'Project messages', 'New messages in a project thread you follow. Bursts arrive as one entry.'),
    (NotificationKind.PROJECT_MESSAGE_MENTION, 'Message mentions', 'Someone @mentions you in a project thread.'),
)

SNIPPET_LENGTH = 240


def in_app_enabled(*, user_id, workspace_id, kind):
    """No row means on: a person only ever opts out."""
    setting = NotificationSetting.objects.filter(
        user_id=user_id, workspace_id=workspace_id, kind=kind,
    ).values_list('in_app_enabled', flat=True).first()
    return True if setting is None else setting


def in_app_settings(*, user, workspace):
    stored = dict(
        NotificationSetting.objects.filter(user=user, workspace=workspace).values_list('kind', 'in_app_enabled')
    )
    return {kind.value: stored.get(kind.value, True) for kind, _label, _help in CONFIGURABLE_KINDS}


@transaction.atomic
def update_in_app_settings(*, user, workspace, changes):
    allowed = {kind.value for kind, _label, _help in CONFIGURABLE_KINDS}
    unknown = set(changes) - allowed
    if unknown:
        raise NotificationError(f"Unknown notification kinds: {', '.join(sorted(unknown))}.")
    for kind, enabled in changes.items():
        NotificationSetting.objects.update_or_create(
            user=user, workspace=workspace, kind=kind,
            defaults={'in_app_enabled': bool(enabled)},
        )
    return in_app_settings(user=user, workspace=workspace)


def _snippet(text):
    text = ' '.join((text or '').split())
    return text if len(text) <= SNIPPET_LENGTH else f'{text[:SNIPPET_LENGTH - 1]}…'


def review_link(*, media_version, comment=None, time_ms=None):
    """The review route for one cut, addressed by the File id like every other entry point."""
    query = {'media': str(media_version.original_file_id)}
    if comment is not None:
        query['comment'] = str(comment.id)
    if time_ms is not None:
        query['t'] = str(int(time_ms))
    return f'/review?{urlencode(query)}'


def task_link(task):
    return f'/tasks?{urlencode({"task": str(task.id)})}'


def _media_payload(media_version):
    project = media_version.project
    return {
        'project_id': str(project.id),
        'project_name': project.name,
        'media_version_id': str(media_version.id),
        'media_file_id': str(media_version.original_file_id),
        'media_title': media_version.title,
        'version_number': media_version.version_number,
    }


def _is_workspace_teammate(*, user, workspace):
    """Mirrors comments.can_see_team_notes: people in only through a client team are not."""
    return active_memberships_for_user(user=user, workspace=workspace).filter(
        principal_type=WorkspacePrincipalType.USER,
    ).exists()


def comment_is_team_only(comment):
    return comment.visibility == ReviewCommentVisibility.TEAM or bool(
        comment.parent_comment_id and comment.parent_comment.visibility == ReviewCommentVisibility.TEAM
    )


def can_receive_comment(*, user, comment):
    project = comment.media_version.project
    if not has_project_permission(user=user, project=project, permission_key=REVIEW_COMMENT_READ):
        return False
    if comment_is_team_only(comment) and not _is_workspace_teammate(user=user, workspace=project.workspace):
        return False
    return True


def _notify(*, recipient, workspace, actor, kind, entity_type, entity_id, payload, now=None, actor_name=None):
    """Creates one in-app notification unless the recipient caused it or switched the kind off.

    Returns the notification when one was created, else None. Only mentions also queue an
    outbox event, because the mention email is the only email channel that exists.
    """
    if recipient is None or recipient.status != UserStatus.ACTIVE:
        return None
    if actor is not None and recipient.id == actor.id:
        return None
    if not in_app_enabled(user_id=recipient.id, workspace_id=workspace.id, kind=kind):
        return None
    now = now or timezone.now()
    payload = dict(payload)
    if actor is None and actor_name:
        payload['actor_name'] = actor_name
    notification, created = Notification.objects.get_or_create(
        recipient_user=recipient,
        kind=kind,
        entity_type=entity_type,
        entity_id=str(entity_id),
        defaults={
            'id': uuid.uuid4(),
            'workspace': workspace,
            'actor_user': actor,
            'payload': payload,
            'created_at': now,
        },
    )
    return notification if created else None


def _assigned_user_ids(file_ids):
    """Users assigned to an open task that has one of these files attached."""
    task_ids = TaskAttachment.objects.filter(
        file_id__in=file_ids, task__deleted_at__isnull=True,
    ).values_list('task_id', flat=True)
    return set(
        TaskAssignee.objects.filter(
            task_id__in=task_ids,
            workspace_membership__principal_type=WorkspacePrincipalType.USER,
        ).values_list('workspace_membership__user_id', flat=True)
    )


def cut_follower_ids(media_version):
    """Who a cut is "theirs": the uploader and anyone assigned to it through a task."""
    ids = _assigned_user_ids([media_version.original_file_id])
    ids.add(media_version.created_by_user_id)
    return ids


def notify_comment_created(*, comment, actor=None, actor_name=None, already_notified=(), include_followers=True):
    """Reply and "note on your cut" notifications for a new comment.

    Each person gets at most one notification per comment: a mention (sent before this) wins
    over a reply, which wins over a note on their cut. Team-only notes never reach someone
    who is in the workspace only through a client team.
    """
    media_version = comment.media_version
    project = media_version.project
    workspace = project.workspace
    skip = set(already_notified)
    if actor is not None:
        skip.add(actor.id)
    text = ReviewCommentContent.objects.filter(review_comment=comment).order_by('sort_order').values_list(
        'text_content', flat=True,
    ).first()
    time_ms = comment.start_time_ms
    if time_ms is None and comment.parent_comment_id:
        time_ms = comment.parent_comment.start_time_ms
    payload = {
        **_media_payload(media_version),
        'review_comment_id': str(comment.id),
        'parent_comment_id': str(comment.parent_comment_id) if comment.parent_comment_id else None,
        'start_time_ms': time_ms,
        'excerpt': _snippet(text),
        'team_only': comment_is_team_only(comment),
        'link': review_link(media_version=media_version, comment=comment, time_ms=time_ms),
    }
    now = timezone.now()
    created = []

    parent = comment.parent_comment
    if parent is not None and parent.author_user_id and parent.author_user_id not in skip:
        recipient = parent.author_user
        if can_receive_comment(user=recipient, comment=comment):
            note = _notify(
                recipient=recipient, workspace=workspace, actor=actor, actor_name=actor_name,
                kind=NotificationKind.REVIEW_COMMENT_REPLY, entity_type='review_comment',
                entity_id=comment.id, payload=payload, now=now,
            )
            if note:
                created.append(note)
        skip.add(parent.author_user_id)

    if include_followers:
        for recipient in User.objects.filter(id__in=cut_follower_ids(media_version) - skip):
            if not can_receive_comment(user=recipient, comment=comment):
                continue
            note = _notify(
                recipient=recipient, workspace=workspace, actor=actor, actor_name=actor_name,
                kind=NotificationKind.REVIEW_COMMENT_NEW, entity_type='review_comment',
                entity_id=comment.id, payload=payload, now=now,
            )
            if note:
                created.append(note)
    return created


def version_key(title):
    """Same rule as the review page's versionKey: strip a trailing V3/ver 3 and an extension."""
    title = (title or '').lower()
    title = re.sub(r'\.[a-z0-9]{1,5}$', '', title)
    title = re.sub(r'[\s._-]*(?:v|ver|version)[\s._-]*\d+$', '', title)
    return re.sub(r'[^a-z0-9]+', ' ', title).strip()


def _sibling_media_versions(media_version):
    """Earlier cuts of the same file: same library asset, or (for project uploads) same title."""
    file_ids = set()
    asset_id = ProjectFile.objects.filter(
        file_id=media_version.original_file_id, deleted_at__isnull=True,
    ).values_list('media_asset_id', flat=True).first()
    if asset_id:
        file_ids |= set(ProjectFile.objects.filter(
            media_asset_id=asset_id, deleted_at__isnull=True,
        ).values_list('file_id', flat=True))
    key = version_key(media_version.title)
    candidates = MediaVersion.objects.filter(project_id=media_version.project_id).exclude(id=media_version.id)
    return [
        item for item in candidates
        if item.original_file_id in file_ids or (key and version_key(item.title) == key)
    ]


def notify_new_media_version(*, media_version, actor, siblings=None):
    """Tells people who commented on, uploaded or are assigned to earlier cuts of this file."""
    project = media_version.project
    siblings = _sibling_media_versions(media_version) if siblings is None else siblings
    if not siblings:
        return []
    recipient_ids = set(
        ReviewComment.objects.filter(
            media_version__in=siblings, deleted_at__isnull=True, author_user__isnull=False,
        ).values_list('author_user_id', flat=True)
    )
    recipient_ids |= _assigned_user_ids([item.original_file_id for item in siblings] + [media_version.original_file_id])
    recipient_ids |= {item.created_by_user_id for item in siblings}
    if actor is not None:
        recipient_ids.discard(actor.id)
    previous = max(siblings, key=lambda item: item.version_number)
    payload = {
        **_media_payload(media_version),
        'previous_media_version_id': str(previous.id),
        'excerpt': _snippet(media_version.note or ''),
        'link': review_link(media_version=media_version),
    }
    now = timezone.now()
    created = []
    for recipient in User.objects.filter(id__in=recipient_ids):
        if not has_project_permission(user=recipient, project=project, permission_key=MEDIA_READ):
            continue
        note = _notify(
            recipient=recipient, workspace=project.workspace, actor=actor,
            kind=NotificationKind.MEDIA_VERSION_NEW, entity_type='media_version',
            entity_id=media_version.id, payload=payload, now=now,
        )
        if note:
            created.append(note)
    return created


def notify_library_version_added(*, project_file, actor):
    """A library file was made the next version of an asset (the drag-onto gesture).

    Review data lives on project media versions, so this looks for the media versions that
    share bytes with the asset's other versions.
    """
    if not project_file.media_asset_id:
        return []
    other_file_ids = list(ProjectFile.objects.filter(
        media_asset_id=project_file.media_asset_id, deleted_at__isnull=True,
    ).exclude(pk=project_file.pk).values_list('file_id', flat=True))
    new_media = MediaVersion.objects.select_related('project__workspace').filter(
        original_file_id=project_file.file_id,
    ).first()
    siblings = list(MediaVersion.objects.select_related('project__workspace').filter(original_file_id__in=other_file_ids))
    if new_media is not None:
        return notify_new_media_version(media_version=new_media, actor=actor, siblings=siblings)
    # Not published into a project yet: link to the library file, still a valid review URL.
    recipient_ids = set(
        ReviewComment.objects.filter(
            media_version__in=siblings, deleted_at__isnull=True, author_user__isnull=False,
        ).values_list('author_user_id', flat=True)
    ) | _assigned_user_ids(other_file_ids)
    if actor is not None:
        recipient_ids.discard(actor.id)
    workspace = project_file.workspace
    payload = {
        'project_id': str(project_file.project_id) if project_file.project_id else None,
        'project_name': project_file.project.name if project_file.project_id else None,
        'media_file_id': str(project_file.file_id),
        'media_title': project_file.file.original_name,
        'version_number': project_file.version_number,
        'excerpt': '',
        'link': f'/review?{urlencode({"media": str(project_file.file_id)})}',
    }
    created = []
    for recipient in User.objects.filter(id__in=recipient_ids):
        project = project_file.project
        if project is not None and not has_project_permission(user=recipient, project=project, permission_key=MEDIA_READ):
            continue
        note = _notify(
            recipient=recipient, workspace=workspace, actor=actor,
            kind=NotificationKind.MEDIA_VERSION_NEW, entity_type='project_file',
            entity_id=project_file.id, payload=payload,
        )
        if note:
            created.append(note)
    return created


def stage_outcome(stage):
    """APPROVED / CHANGES_REQUESTED for the two stages people are told about, else None."""
    slug = (stage.slug or '').lower()
    name = (stage.name or '').strip().lower()
    if slug == 'approved' or name == 'approved':
        return NotificationKind.MEDIA_APPROVED
    if slug in ('revision', 'revisions', 'changes-requested') or name in ('revision', 'revisions', 'changes requested'):
        return NotificationKind.MEDIA_CHANGES_REQUESTED
    return None


def notify_stage_outcome(*, media_version, entry, stage, actor, comment=None):
    kind = stage_outcome(stage)
    if kind is None:
        return []
    project = media_version.project
    recipient_ids = cut_follower_ids(media_version)
    if actor is not None:
        recipient_ids.discard(actor.id)
    excerpt = ''
    if comment is not None:
        excerpt = ReviewCommentContent.objects.filter(review_comment=comment).order_by('sort_order').values_list(
            'text_content', flat=True,
        ).first() or ''
    payload = {
        **_media_payload(media_version),
        'stage_name': stage.name,
        'review_comment_id': str(comment.id) if comment is not None else None,
        'start_time_ms': comment.start_time_ms if comment is not None else None,
        'excerpt': _snippet(excerpt),
        'link': review_link(
            media_version=media_version, comment=comment,
            time_ms=comment.start_time_ms if comment is not None else None,
        ),
    }
    now = timezone.now()
    created = []
    for recipient in User.objects.filter(id__in=recipient_ids):
        if not has_project_permission(user=recipient, project=project, permission_key=MEDIA_READ):
            continue
        if comment is not None and not can_receive_comment(user=recipient, comment=comment):
            # Still say it happened, but without quoting a note they may not read.
            note_payload = {**payload, 'review_comment_id': None, 'excerpt': '', 'link': review_link(media_version=media_version)}
        else:
            note_payload = payload
        note = _notify(
            recipient=recipient, workspace=project.workspace, actor=actor, kind=kind,
            entity_type='media_stage_entry', entity_id=entry.id, payload=note_payload, now=now,
        )
        if note:
            created.append(note)
    return created


def notify_task_assigned(*, assignee, actor):
    membership = assignee.workspace_membership
    if membership.principal_type != WorkspacePrincipalType.USER or membership.user_id is None:
        return None
    task = assignee.task
    if not has_workspace_permission(user=membership.user, workspace=task.workspace, permission_key=TASK_READ):
        return None
    return _notify(
        recipient=membership.user, workspace=task.workspace, actor=actor,
        kind=NotificationKind.TASK_ASSIGNED, entity_type='task_assignee', entity_id=assignee.id,
        payload={
            'task_id': str(task.id),
            'title': task.title,
            'project_id': str(task.project_id) if task.project_id else None,
            'project_name': task.project.name if task.project_id else None,
            'due_at': task.due_at.isoformat() if task.due_at else None,
            'excerpt': _snippet(task.description or ''),
            'link': task_link(task),
        },
    )


@transaction.atomic
def notify_client_task_ready(*, task, actor):
    """Create one in-app handoff notification per active client contact and task."""
    if not task.client_team_id:
        return 0
    now = timezone.now()
    recipients = User.objects.filter(
        id__in=ClientTeamMember.objects.filter(
            client_team_id=task.client_team_id,
            status=ClientTeamMemberStatus.ACTIVE,
        ).values('user_id'),
        status=UserStatus.ACTIVE,
    ).exclude(id=actor.id)
    created_count = 0
    for recipient in recipients:
        if not in_app_enabled(user_id=recipient.id, workspace_id=task.workspace_id, kind=NotificationKind.TASK_CLIENT_READY):
            continue
        notification, created = Notification.objects.get_or_create(
            recipient_user=recipient,
            kind=NotificationKind.TASK_CLIENT_READY,
            entity_type='task',
            entity_id=str(task.id),
            defaults={
                'id': uuid.uuid4(),
                'workspace_id': task.workspace_id,
                'actor_user': actor,
                'payload': {
                    'task_id': str(task.id),
                    'project_id': str(task.project_id) if task.project_id else None,
                    'title': task.title,
                    'link': task_link(task),
                },
                'created_at': now,
            },
        )
        if not created:
            continue
        OutboxEvent.objects.create(
            id=uuid.uuid4(), topic='notification.created', aggregate_type='notification',
            aggregate_id=str(notification.id),
            deduplication_key=f'notification:{notification.id}:created',
            payload={
                'notification_id': str(notification.id),
                'recipient_user_id': str(recipient.id),
                'kind': notification.kind,
            },
            available_at=now, created_at=now, updated_at=now,
        )
        created_count += 1
    return created_count


def resolve_mention_users(*, project, actor, user_ids):
    requested_ids = {user_id for user_id in user_ids if user_id != actor.id}
    if not requested_ids:
        return []
    users = list(User.objects.filter(id__in=requested_ids, status=UserStatus.ACTIVE))
    if {user.id for user in users} != requested_ids:
        raise NotificationError('Every mentioned user must be an active project collaborator.')
    if any(
        not has_project_permission(
            user=user,
            project=project,
            permission_key=REVIEW_COMMENT_READ,
        )
        for user in users
    ):
        raise NotificationError('Every mentioned user must have permission to read this project.')
    return users


def _create_mention_notification(*, comment, actor, recipient, excerpt, now):
    workspace = comment.media_version.project.workspace
    if not in_app_enabled(user_id=recipient.id, workspace_id=workspace.id, kind=NotificationKind.REVIEW_COMMENT_MENTION):
        # The mention email is sent from this notification, so switching mentions off
        # in-app stops the email too. Settings says so next to the switch.
        return None, False
    time_ms = comment.start_time_ms
    if time_ms is None and comment.parent_comment_id:
        time_ms = comment.parent_comment.start_time_ms
    notification, created = Notification.objects.get_or_create(
        recipient_user=recipient,
        kind=NotificationKind.REVIEW_COMMENT_MENTION,
        entity_type='review_comment',
        entity_id=str(comment.id),
        defaults={
            'id': uuid.uuid4(),
            'workspace': comment.media_version.project.workspace,
            'actor_user': actor,
            'payload': {
                **_media_payload(comment.media_version),
                'review_comment_id': str(comment.id),
                'start_time_ms': time_ms,
                'excerpt': excerpt[:240],
                'link': review_link(media_version=comment.media_version, comment=comment, time_ms=time_ms),
            },
            'created_at': now,
        },
    )
    if created:
        OutboxEvent.objects.create(
            id=uuid.uuid4(),
            topic='notification.created',
            aggregate_type='notification',
            aggregate_id=str(notification.id),
            deduplication_key=f'notification:{notification.id}:created',
            payload={
                'notification_id': str(notification.id),
                'recipient_user_id': str(recipient.id),
                'kind': notification.kind,
            },
            available_at=now,
            created_at=now,
            updated_at=now,
        )
    return notification, created


def set_comment_mentions(*, comment, actor, users, excerpt):
    now = timezone.now()
    desired_ids = {user.id for user in users}
    existing_ids = set(
        ReviewCommentMention.objects.filter(review_comment=comment).values_list(
            'user_id', flat=True
        )
    )
    ReviewCommentMention.objects.filter(
        review_comment=comment,
        user_id__in=existing_ids - desired_ids,
    ).delete()
    for user in users:
        if user.id in existing_ids:
            continue
        ReviewCommentMention.objects.create(
            id=uuid.uuid4(),
            review_comment=comment,
            user=user,
            created_at=now,
        )
        _create_mention_notification(
            comment=comment,
            actor=actor,
            recipient=user,
            excerpt=excerpt,
            now=now,
        )
    return desired_ids


@transaction.atomic
def mark_notification_read(*, notification):
    locked = Notification.objects.select_for_update().get(id=notification.id)
    if locked.read_at is None:
        locked.read_at = timezone.now()
        locked.save(update_fields=['read_at'])
    return locked


@transaction.atomic
def mark_all_notifications_read(*, user, workspace_id=None):
    now = timezone.now()
    queryset = Notification.objects.filter(recipient_user=user, read_at__isnull=True)
    if workspace_id is not None:
        queryset = queryset.filter(workspace_id=workspace_id)
    return queryset.update(read_at=now)
