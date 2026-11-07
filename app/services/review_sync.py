"""Keep the board and the Files tab in step with a cut's review outcome.

When a cut is approved or sent back for changes (by the team's review bar or a client
decision), the tasks that cut is attached to move to the matching board column, and the
library rows for the same file carry the same stage, so Tasks and Files agree with Review.
"""
from app.models import NotificationKind, ProjectFile, Task, TaskAttachment, TaskStage, TaskStageKind

from .notifications import stage_outcome

OUTCOME_KIND = {
    NotificationKind.MEDIA_APPROVED: TaskStageKind.APPROVED,
    NotificationKind.MEDIA_CHANGES_REQUESTED: TaskStageKind.REVISIONS,
}
CLIENT_REVIEW_NAMES = {'client review', 'client-review', 'client_review', 'in client review'}


def task_kind_for(stage):
    """The board column kind a workflow stage maps to, or None (the board is left alone)."""
    outcome = stage_outcome(stage)
    if outcome in OUTCOME_KIND:
        return OUTCOME_KIND[outcome]
    if (stage.slug or '').lower() in CLIENT_REVIEW_NAMES or (stage.name or '').strip().lower() in CLIENT_REVIEW_NAMES:
        return TaskStageKind.CLIENT_REVIEW
    return None


def sync_review_outcome(*, media_version, stage, user=None):
    kind = task_kind_for(stage)
    if kind is None:
        return []
    project = media_version.project
    target = TaskStage.objects.filter(workspace_id=project.workspace_id, kind=kind).order_by('sort_order').first()
    if target is None:
        return []
    ProjectFile.objects.filter(file_id=media_version.original_file_id, deleted_at__isnull=True).exclude(task_stage=target).update(task_stage=target)
    from .tasks import update_task  # tasks imports billing, which imports this module's callers

    task_ids = TaskAttachment.objects.filter(file_id=media_version.original_file_id).values_list('task_id', flat=True)
    moved = []
    for task in Task.objects.select_related('task_stage').filter(id__in=task_ids, project_id=project.id, deleted_at__isnull=True).exclude(task_stage=target):
        moved.append(update_task(task=task, task_stage=target, actor=user))
    return moved


# Moving a file on the Files tab into one of these columns moves its tasks too, the same way
# a review outcome does. Other columns (To do, In progress, custom) only move the file.
FILE_SYNC_KINDS = {TaskStageKind.CLIENT_REVIEW, TaskStageKind.REVISIONS, TaskStageKind.APPROVED}


def sync_file_stage(*, project_file, stage, user=None):
    """Tasks attached to this file, and other library rows of the same file, follow it into ``stage``.

    Called only when a person actually changes the file's stage. Returns the moved tasks.
    """
    if stage is None or stage.kind not in FILE_SYNC_KINDS:
        return []
    ProjectFile.objects.filter(file_id=project_file.file_id, deleted_at__isnull=True).exclude(id=project_file.id).exclude(task_stage=stage).update(task_stage=stage)
    from .tasks import update_task

    task_ids = TaskAttachment.objects.filter(file_id=project_file.file_id).values_list('task_id', flat=True)
    tasks = Task.objects.select_related('task_stage').filter(id__in=task_ids, workspace_id=project_file.workspace_id, deleted_at__isnull=True).exclude(task_stage=stage)
    if project_file.project_id:
        tasks = tasks.filter(project_id=project_file.project_id)
    return [update_task(task=task, task_stage=stage, actor=user) for task in tasks]
