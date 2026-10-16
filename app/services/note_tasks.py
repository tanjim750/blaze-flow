"""Review notes ↔ tasks: "Make task" from a note, the two-way link, and carrying a version's
open notes over to the next one as a checklist.

Team only throughout. A client never sees a task, so every entry point checks
``can_see_team_notes`` (a workspace user, not someone in through a client team) as well as the
task/comment permission the equivalent page already requires.
"""
from django.db import IntegrityError, transaction

from app.models import (
    MediaVersion, MediaVersionStatus, ReviewComment, ReviewCommentContent, ReviewCommentContentType,
    ReviewCommentVisibility, Task, TaskStage, TaskStatus, WorkspaceMembership, WorkspaceMembershipStatus,
    WorkspacePrincipalType,
)
from app.permissions import TASK_CREATE, has_project_permission, memberships_with_permission

from .comments import can_see_team_notes, set_review_comment_resolution
from .tasks import add_task_assignee, create_task, update_task

TITLE_MAX = 120


class NoteTaskError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def timecode(ms):
    if ms is None:
        return None
    seconds = ms // 1000
    return f'{seconds // 60}:{seconds % 60:02d}'


def note_text(comment):
    rows = ReviewCommentContent.objects.filter(
        review_comment=comment, content_type=ReviewCommentContentType.TEXT, deleted_at__isnull=True,
    ).order_by('sort_order').values_list('text_content', flat=True)
    return '\n'.join(text for text in rows if text).strip()


def note_href(comment):
    version = comment.media_version
    href = f'/review?project={version.project_id}&version={version.id}&comment={comment.id}'
    if comment.start_time_ms is not None:
        href += f'&t={comment.start_time_ms}'
    return href


def _title(text):
    first = (text.splitlines() or [''])[0].strip() or 'Review note'
    return first if len(first) <= TITLE_MAX else first[:TITLE_MAX - 1].rstrip() + '…'


def _editor_membership(version):
    """The cut's editor for the default assignee: whoever uploaded it, if still a teammate."""
    if not version.created_by_user_id:
        return None
    return WorkspaceMembership.objects.filter(
        workspace=version.project.workspace, user_id=version.created_by_user_id,
        principal_type=WorkspacePrincipalType.USER, status=WorkspaceMembershipStatus.ACTIVE,
    ).first()


def _default_stage(workspace):
    stages = TaskStage.objects.filter(workspace=workspace).order_by('sort_order', 'created_at')
    return stages.filter(kind='revisions').first() or stages.filter(is_done=False).first() or stages.first()


def _require_team(user, workspace):
    if not can_see_team_notes(user=user, workspace=workspace):
        raise NoteTaskError('Tasks are for the studio team.', status=403)


def _note_for(user, workspace, comment_id):
    comment = (ReviewComment.objects.select_related('media_version__project__workspace', 'media_version__original_file')
               .filter(id=comment_id, deleted_at__isnull=True, parent_comment__isnull=True,
                       media_version__project__workspace=workspace).first())
    if comment is None:
        raise NoteTaskError('That note no longer exists.', status=404)
    if not has_project_permission(user=user, project=comment.media_version.project, permission_key=TASK_CREATE):
        raise NoteTaskError('You cannot create tasks in this project.', status=403)
    return comment


def task_for_note(comment_id):
    return Task.objects.filter(source_review_comment_id=comment_id, deleted_at__isnull=True).select_related('task_stage').first()


def link_data(task):
    if task is None:
        return None
    return {
        'id': str(task.id), 'title': task.title,
        'stage': task.task_stage.name if task.task_stage_id else None,
        'done': bool(task.task_stage_id and task.task_stage.is_done) or task.status in (TaskStatus.COMPLETED, TaskStatus.APPROVED),
        'href': f'/tasks?task={task.id}',
    }


def source_note_data(task):
    """For the task side of the link: what the note said and how to jump back to it."""
    comment = task.source_review_comment if task.source_review_comment_id else None
    if comment is None or comment.deleted_at is not None:
        return None
    version = comment.media_version
    return {
        'comment_id': str(comment.id), 'text': note_text(comment)[:280], 'timecode': timecode(comment.start_time_ms),
        'start_time_ms': comment.start_time_ms, 'version_number': version.version_number,
        'version_title': version.title or (version.original_file.original_name if version.original_file_id else ''),
        'resolved': comment.resolved, 'href': note_href(comment),
        'poster': f'/api/workspaces/{version.project.workspace_id}/projects/{version.project_id}/media-versions/{version.id}/poster/',
    }


def defaults(*, user, workspace, comment_id):
    _require_team(user, workspace)
    comment = _note_for(user, workspace, comment_id)
    version = comment.media_version
    text = note_text(comment)
    editor = _editor_membership(version)
    stage = _default_stage(workspace)
    stamp = timecode(comment.start_time_ms)
    label = version.title or (version.original_file.original_name if version.original_file_id else 'cut')
    description = f'{text}\n\nFrom a review note on {label} v{version.version_number}' + (f' at {stamp}' if stamp else '') + f'.\nOpen the note: {note_href(comment)}'
    return {
        'comment_id': str(comment.id), 'title': _title(text), 'description': description,
        'assignee_id': str(editor.id) if editor else None, 'task_stage_id': str(stage.id) if stage else None,
        'project_id': str(version.project_id), 'existing': link_data(task_for_note(comment.id)),
        'source': source_note_data(Task(source_review_comment=comment)),
    }


def create_tasks_from_notes(*, user, workspace, comment_ids, title=None, description=None, assignee_id=None,
                            due_at=None, task_stage_id=None, sync_note_resolution=True):
    """One task per note. A note that already has a live task gets that task back, not a second one."""
    _require_team(user, workspace)
    if not comment_ids:
        raise NoteTaskError('Pick at least one note.')
    single = len(comment_ids) == 1
    creator = memberships_with_permission(user=user, workspace=workspace, permission_key=TASK_CREATE).filter(
        principal_type=WorkspacePrincipalType.USER,
    ).first()
    if creator is None:
        raise NoteTaskError('You cannot create tasks in this workspace.', status=403)
    stage = TaskStage.objects.filter(id=task_stage_id, workspace=workspace).first() if task_stage_id else _default_stage(workspace)
    if stage is None:
        raise NoteTaskError('This workspace has no task stages.', status=409)
    chosen = WorkspaceMembership.objects.filter(id=assignee_id, workspace=workspace, status=WorkspaceMembershipStatus.ACTIVE).first() if assignee_id else None
    if assignee_id and chosen is None:
        raise NoteTaskError('That assignee is not in this workspace.')
    results = []
    for comment_id in dict.fromkeys(str(c) for c in comment_ids):
        comment = _note_for(user, workspace, comment_id)
        existing = task_for_note(comment.id)
        if existing:
            results.append({'comment_id': str(comment.id), 'task': link_data(existing), 'created': False})
            continue
        prefill = defaults(user=user, workspace=workspace, comment_id=comment.id)
        project = comment.media_version.project
        try:
            with transaction.atomic():
                task = create_task(
                    workspace=workspace, project=project, client_team=project.client_team, task_stage=stage,
                    status=TaskStatus.APPROVED if stage.is_done else TaskStatus.TODO,
                    created_by_membership=creator, actor=user,
                    title=(title if single and title else prefill['title'])[:255],
                    description=description if single and description is not None else prefill['description'],
                    due_at=due_at, source_review_comment=comment, sync_note_resolution=sync_note_resolution,
                )
                assignee = chosen or (WorkspaceMembership.objects.filter(id=prefill['assignee_id']).first() if prefill['assignee_id'] else None)
                if assignee:
                    add_task_assignee(task=task, membership=assignee, actor=user)
        except IntegrityError:
            # Someone made one a moment ago (double click, two tabs): hand that one back.
            results.append({'comment_id': str(comment.id), 'task': link_data(task_for_note(comment.id)), 'created': False})
            continue
        results.append({'comment_id': str(comment.id), 'task': link_data(task), 'created': True})
    return results


def links_for_version(*, user, version):
    """Note id → its task, for the review page's chips. Empty for clients."""
    if not can_see_team_notes(user=user, workspace=version.project.workspace):
        return {}
    tasks = Task.objects.filter(source_review_comment__media_version=version, deleted_at__isnull=True).select_related('task_stage')
    return {str(task.source_review_comment_id): link_data(task) for task in tasks}


# -- keeping both sides in step ---------------------------------------------------------

def _task_done(task):
    return bool(task.task_stage_id and task.task_stage.is_done) or task.status in (TaskStatus.COMPLETED, TaskStatus.APPROVED)


def after_task_saved(*, task, actor, was_done):
    """Finishing a linked task resolves its note (and reopening the task reopens it)."""
    if not task.source_review_comment_id or not task.sync_note_resolution or actor is None:
        return
    done = _task_done(task)
    if done == was_done:
        return
    comment = ReviewComment.objects.filter(id=task.source_review_comment_id, deleted_at__isnull=True).first()
    if comment is None or comment.resolved == done:
        return
    set_review_comment_resolution(comment=comment, user=actor, resolved=done, sync_task=False)


def after_note_resolution(*, comment, user, resolved):
    """Resolving a note finishes its linked task (moved to the first done stage); reopening reopens it."""
    task = Task.objects.filter(source_review_comment_id=comment.id, deleted_at__isnull=True, sync_note_resolution=True).select_related('task_stage').first()
    if task is None or _task_done(task) == resolved:
        return
    stages = TaskStage.objects.filter(workspace=task.workspace).order_by('sort_order', 'created_at')
    target = stages.filter(is_done=True).first() if resolved else (stages.filter(kind='revisions').first() or stages.filter(is_done=False).first())
    if target is None:
        return
    update_task(task=task, actor=user, task_stage=target, sync_note=False)


# -- last round's notes as a checklist ---------------------------------------------------

def previous_version(version):
    """The cut this one replaces: same title in the project if there is one, else the version before."""
    earlier = MediaVersion.objects.filter(project=version.project, status=MediaVersionStatus.ACTIVE, version_number__lt=version.version_number)
    if version.title:
        same = earlier.filter(title=version.title).order_by('-version_number').first()
        if same:
            return same
    return earlier.order_by('-version_number').first()


def _open_notes(version):
    return ReviewComment.objects.filter(media_version=version, parent_comment__isnull=True, deleted_at__isnull=True, resolved=False).order_by('start_time_ms', 'created_at')


def carry_over_status(*, user, version):
    if not can_see_team_notes(user=user, workspace=version.project.workspace):
        return {'available': 0, 'previous': None, 'done': False}
    previous = previous_version(version)
    if previous is None:
        return {'available': 0, 'previous': None, 'done': False}
    carried = set(ReviewComment.objects.filter(media_version=version, carried_from__isnull=False, deleted_at__isnull=True).values_list('carried_from_id', flat=True))
    pending = [c for c in _open_notes(previous) if c.id not in carried]
    return {'available': len(pending), 'previous': {'id': str(previous.id), 'version_number': previous.version_number}, 'done': bool(carried) and not pending}


@transaction.atomic
def carry_over_notes(*, user, version):
    """Copies the previous version's open notes onto this one as team-only checklist notes."""
    from .comments import create_review_comment

    _require_team(user, version.project.workspace)
    previous = previous_version(version)
    if previous is None:
        raise NoteTaskError('There is no earlier version to carry notes from.', status=404)
    carried = set(ReviewComment.objects.filter(media_version=version, carried_from__isnull=False, deleted_at__isnull=True).values_list('carried_from_id', flat=True))
    created = 0
    for note in _open_notes(previous):
        if note.id in carried:
            continue
        text = note_text(note)
        if not text:
            continue
        stamp = timecode(note.start_time_ms)
        copy = create_review_comment(
            media_version=version, user=user, text=f'☐ From v{previous.version_number}' + (f' @ {stamp}' if stamp else '') + f': {text}',
            start_time_ms=note.start_time_ms, end_time_ms=note.end_time_ms, visibility=ReviewCommentVisibility.TEAM,
            notify_followers=False,
        )
        ReviewComment.objects.filter(id=copy.id).update(carried_from=note, source='carried')
        created += 1
    return {'created': created, **carry_over_status(user=user, version=version)}

