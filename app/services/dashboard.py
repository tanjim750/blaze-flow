"""What the role-based dashboards read: the viewer's dashboard role, their own review work,
and the team's task load.

Roles come from permissions, never from role names, so a custom role behaves by what it can
do:

* ``owner``: a workspace user who is the primary owner, or whose active role holds one of
  the workspace-administration permissions (``OWNER_DASHBOARD_PERMISSIONS``);
* ``editor``: any other workspace user;
* ``client``: someone who reaches the workspace only through a client team.

Visibility follows the routes the dashboard links into: notes need ``review.comment.read``
on the project, cuts need ``media.read``, tasks need ``task.read``, and client-team members
never see team-only notes.
"""
from datetime import timedelta

from django.db.models import Count, Q
from django.urls import reverse

from app.models import (
    MediaVersion, MediaVersionStageEntry, MediaVersionStatus, ReviewComment, ReviewCommentContent,
    ReviewCommentContentType, RolePermission, RoleStatus, Task, TaskAssignee, TaskAttachment, TaskStatus,
    WorkspaceMembership, WorkspaceMembershipStatus, WorkspacePrincipalType,
)
from app.permissions import (
    CLIENT_TEAM_MANAGE, MEDIA_READ, REVIEW_COMMENT_READ, ROLE_MANAGE, TASK_READ, WORKSPACE_MANAGE,
    WORKSPACE_MEMBERS_MANAGE, accessible_projects, active_memberships_for_user,
)

from app.serializers.media import media_poster_variant

from .comments import can_see_team_notes, client_visible_comments

ROLE_OWNER = 'owner'
ROLE_EDITOR = 'editor'
ROLE_CLIENT = 'client'
DASHBOARD_ROLES = (ROLE_OWNER, ROLE_EDITOR, ROLE_CLIENT)

# Holding any one of these makes a workspace user an owner for dashboard purposes: they run
# the workspace (settings, people, roles, clients), so they get the oversight layout.
OWNER_DASHBOARD_PERMISSIONS = (WORKSPACE_MANAGE, WORKSPACE_MEMBERS_MANAGE, ROLE_MANAGE, CLIENT_TEAM_MANAGE)

CLOSED_TASK_STATUSES = (TaskStatus.COMPLETED, TaskStatus.APPROVED, TaskStatus.CANCELLED)


def dashboard_role(*, user, workspace):
    """``owner``, ``editor`` or ``client`` for this viewer in ``workspace``; None without access."""
    memberships = active_memberships_for_user(user=user, workspace=workspace)
    own = memberships.filter(principal_type=WorkspacePrincipalType.USER)
    if own.exists():
        if own.filter(is_primary_owner=True).exists():
            return ROLE_OWNER
        managing = RolePermission.objects.filter(
            role_id__in=own.exclude(role__isnull=True).values('role_id'),
            role__status=RoleStatus.ACTIVE,
            permission_key__in=OWNER_DASHBOARD_PERMISSIONS,
        )
        return ROLE_OWNER if managing.exists() else ROLE_EDITOR
    # Client-team memberships carry a role too, but a client stays a client whatever that
    # role allows: the client layout is about whose work it is, not what they may change.
    if memberships.exists():
        return ROLE_CLIENT
    return None


def own_membership(*, user, workspace):
    return WorkspaceMembership.objects.filter(
        workspace=workspace, user=user, principal_type=WorkspacePrincipalType.USER,
        status=WorkspaceMembershipStatus.ACTIVE,
    ).first()


def open_tasks(queryset):
    return queryset.filter(deleted_at__isnull=True).exclude(status__in=CLOSED_TASK_STATUSES).exclude(task_stage__is_done=True)


def visible_tasks(*, user, workspace):
    """The tasks the task list would show this viewer (task.read projects, plus project-less)."""
    project_ids = accessible_projects(user=user, workspace=workspace, permission_key=TASK_READ).values('id')
    return Task.objects.filter(workspace=workspace, deleted_at__isnull=True).filter(
        Q(project__isnull=True) | Q(project_id__in=project_ids)
    )


def my_task_ids(*, user, workspace):
    membership = own_membership(user=user, workspace=workspace)
    if membership is None:
        return []
    return list(TaskAssignee.objects.filter(
        workspace_membership=membership, task__workspace=workspace, task__deleted_at__isnull=True,
    ).values_list('task_id', flat=True))


def my_media(*, user, workspace, permission_key):
    """Cuts that are the viewer's work: ones they uploaded, or whose file is linked to a task
    assigned to them. Limited to projects where they hold ``permission_key``.

    Returns ``(queryset, reasons)`` where ``reasons`` maps a media version id to the list of
    ``uploaded`` / ``assigned`` explaining why it is theirs.
    """
    project_ids = accessible_projects(user=user, workspace=workspace, permission_key=permission_key).values('id')
    task_ids = my_task_ids(user=user, workspace=workspace)
    linked_file_ids = set(TaskAttachment.objects.filter(task_id__in=task_ids).values_list('file_id', flat=True))
    queryset = MediaVersion.objects.filter(
        project__workspace=workspace, project_id__in=project_ids, status=MediaVersionStatus.ACTIVE,
    ).filter(Q(created_by_user=user) | Q(original_file_id__in=linked_file_ids))
    reasons = {}
    for media_id, created_by, file_id in queryset.values_list('id', 'created_by_user_id', 'original_file_id'):
        why = []
        if created_by == user.id:
            why.append('uploaded')
        if file_id in linked_file_ids:
            why.append('assigned')
        reasons[media_id] = why
    return queryset, reasons


def visible_comments(*, user, workspace):
    queryset = ReviewComment.objects.filter(deleted_at__isnull=True)
    if can_see_team_notes(user=user, workspace=workspace):
        return queryset
    return client_visible_comments(queryset)


def review_href(media, comment=None):
    """The review route's canonical address (by File id), optionally at a note and its time."""
    href = f'/review?media={media.original_file_id}'
    if comment is not None:
        href += f'&comment={comment.id}'
        if comment.start_time_ms is not None:
            href += f'&t={comment.start_time_ms}'
    return href


def _initials(name):
    parts = [part for part in (name or '').split() if part]
    if not parts:
        return '?'
    return f'{parts[0][0]}{parts[-1][0] if len(parts) > 1 else ""}'.upper()


def _author(comment):
    if comment.author_user_id:
        user = comment.author_user
        name = user.get_full_name() or user.email
        return {'type': 'user', 'id': str(user.id), 'name': name, 'initials': _initials(name), 'avatar_url': user.avatar_url or None}
    name = (comment.author_guest_session.name if comment.author_guest_session_id else None) or 'A guest reviewer'
    return {'type': 'guest', 'id': None, 'name': name, 'initials': _initials(name), 'avatar_url': None}


def current_stages(media_ids):
    entries = MediaVersionStageEntry.objects.filter(
        media_version_id__in=media_ids, exited_at__isnull=True, workflow_stage__isnull=False,
    ).select_related('workflow_stage')
    return {
        entry.media_version_id: {
            'id': str(entry.workflow_stage.id), 'name': entry.workflow_stage.name,
            'slug': entry.workflow_stage.slug, 'entered_at': entry.entered_at,
        }
        for entry in entries
    }


def _media_summary(media, stages):
    return {
        'id': str(media.id),
        'title': media.title,
        'version_number': media.version_number,
        'file_id': str(media.original_file_id),
        'project': {'id': str(media.project_id), 'name': media.project.name},
        'stage': stages.get(media.id),
    }


def notes_to_address(*, user, workspace, limit=20):
    """Unresolved top-level notes from other people on the viewer's own cuts, oldest first.

    "Top-level" because a reply is part of a conversation, not a new note to act on; the
    reply count travels with each note instead. Team-only notes are left out for anyone who
    is in the workspace only through a client team.
    """
    media, reasons = my_media(user=user, workspace=workspace, permission_key=REVIEW_COMMENT_READ)
    visible = visible_comments(user=user, workspace=workspace)
    notes = visible.filter(
        media_version__in=media, parent_comment__isnull=True, resolved=False,
    ).exclude(author_user=user).select_related(
        'author_user', 'author_guest_session', 'media_version__project',
    ).order_by('created_at', 'id')
    total = notes.count()
    rows = list(notes[:limit])
    ids = [row.id for row in rows]
    replies = dict(
        visible.filter(parent_comment_id__in=ids).values('parent_comment_id').annotate(n=Count('id')).values_list('parent_comment_id', 'n')
    )
    texts = {}
    for content in ReviewCommentContent.objects.filter(
        review_comment_id__in=ids, content_type=ReviewCommentContentType.TEXT, deleted_at__isnull=True,
    ).order_by('sort_order'):
        texts.setdefault(content.review_comment_id, content.text_content)
    stages = current_stages({row.media_version_id for row in rows})
    results = []
    for row in rows:
        results.append({
            'id': str(row.id),
            'text': texts.get(row.id),
            'start_time_ms': row.start_time_ms,
            'end_time_ms': row.end_time_ms,
            'visibility': row.visibility,
            'author': _author(row),
            'reply_count': replies.get(row.id, 0),
            'created_at': row.created_at,
            'reasons': reasons.get(row.media_version_id, []),
            'media': _media_summary(row.media_version, stages),
            'href': review_href(row.media_version, row),
        })
    return {'results': results, 'count': total}


def my_cuts(*, user, workspace, limit=20):
    """The viewer's own cuts, newest first, each with its workflow stage and open-note count."""
    media, reasons = my_media(user=user, workspace=workspace, permission_key=MEDIA_READ)
    rows = list(media.select_related('project').order_by('-created_at', '-id')[:limit])
    ids = [row.id for row in rows]
    stages = current_stages(ids)
    open_notes = dict(
        visible_comments(user=user, workspace=workspace).filter(
            media_version_id__in=ids, parent_comment__isnull=True, resolved=False,
        ).values('media_version_id').annotate(n=Count('id')).values_list('media_version_id', 'n')
    )
    results = []
    for row in rows:
        poster = media_poster_variant(row)
        metadata = (poster.metadata or {}) if poster else {}
        results.append({
            **_media_summary(row, stages),
            'created_at': row.created_at,
            'reasons': reasons.get(row.id, []),
            'open_notes': open_notes.get(row.id, 0),
            'poster': {
                'url': reverse('api-media-version-poster', args=[workspace.id, row.project_id, row.id]),
                'width': metadata.get('width') or None,
                'height': metadata.get('height') or None,
            } if poster else None,
            'href': review_href(row),
        })
    return {'results': results, 'count': media.count()}


def team_workload(*, user, workspace, now):
    """Open tasks per team member: open, overdue and due in the next 7 days.

    Counts only tasks the viewer could see in the task list. Every active workspace user is
    listed, idle ones too, so the chart shows who has room; client teams are not people who
    take tasks and are left out. Tasks with nobody on them are counted separately.
    """
    week_end = now + timedelta(days=7)
    tasks = open_tasks(visible_tasks(user=user, workspace=workspace))
    members = list(WorkspaceMembership.objects.filter(
        workspace=workspace, principal_type=WorkspacePrincipalType.USER, status=WorkspaceMembershipStatus.ACTIVE,
    ).select_related('user'))
    counts = {
        row['workspace_membership_id']: row
        for row in TaskAssignee.objects.filter(task__in=tasks, workspace_membership__in=members).values('workspace_membership_id').annotate(
            open=Count('task_id', distinct=True),
            overdue=Count('task_id', filter=Q(task__due_at__lt=now), distinct=True),
            due_this_week=Count('task_id', filter=Q(task__due_at__gte=now, task__due_at__lt=week_end), distinct=True),
        )
    }
    results = []
    for membership in members:
        row = counts.get(membership.id, {})
        name = membership.user.get_full_name() or membership.user.email
        results.append({
            'membership_id': str(membership.id),
            'user': {'id': str(membership.user_id), 'name': name, 'initials': _initials(name), 'avatar_url': membership.user.avatar_url or None},
            'open': row.get('open', 0),
            'overdue': row.get('overdue', 0),
            'due_this_week': row.get('due_this_week', 0),
        })
    results.sort(key=lambda item: (-item['open'], -item['overdue'], item['user']['name'].lower()))
    unassigned = tasks.exclude(id__in=TaskAssignee.objects.values('task_id'))
    return {
        'results': results,
        'unassigned': {
            'open': unassigned.count(),
            'overdue': unassigned.filter(due_at__lt=now).count(),
        },
        'total_open': tasks.count(),
        'generated_at': now,
    }


def my_work_activity(rows, *, user, workspace):
    """Narrows feed rows to events on the viewer's tasks and cuts, done by someone else."""
    task_ids = [str(value) for value in my_task_ids(user=user, workspace=workspace)]
    media, _ = my_media(user=user, workspace=workspace, permission_key=MEDIA_READ)
    media_ids = list(media.values_list('id', flat=True))
    comment_ids = [str(value) for value in ReviewComment.objects.filter(media_version_id__in=media_ids).values_list('id', flat=True)]
    return rows.filter(
        Q(entity_type='task', entity_id__in=task_ids)
        | Q(entity_type='media_version', entity_id__in=[str(value) for value in media_ids])
        | Q(entity_type='review_comment', entity_id__in=comment_ids)
    ).exclude(actor_user=user)
