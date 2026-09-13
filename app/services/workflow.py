import uuid

from django.db import transaction
from django.utils import timezone

from app.models import MediaVersion, MediaVersionStageEntry, WorkflowStageStatusState

from .audit import record_user_audit


class WorkflowTransitionError(Exception):
    pass


@transaction.atomic
def transition_media_version(*, media_version, stage, stage_status, user):
    locked_media = MediaVersion.objects.select_for_update().select_related('project__workspace').get(
        id=media_version.id
    )
    if stage.workspace_id != locked_media.project.workspace_id or stage.status != WorkflowStageStatusState.ACTIVE:
        raise WorkflowTransitionError('Select an active stage from the media workspace.')
    if stage_status and (
        stage_status.workflow_stage_id != stage.id
        or stage_status.status != WorkflowStageStatusState.ACTIVE
    ):
        raise WorkflowTransitionError('Select an active status from the target stage.')
    current = MediaVersionStageEntry.objects.select_for_update().filter(
        media_version=locked_media,
        exited_at__isnull=True,
    ).first()
    if current is None:
        raise WorkflowTransitionError('The media version has no current workflow stage.')
    if current.workflow_stage_id == stage.id and current.workflow_stage_status_id == (
        stage_status.id if stage_status else None
    ):
        raise WorkflowTransitionError('The media version is already in that workflow state.')
    now = timezone.now()
    current.exited_at = now
    current.save(update_fields=['exited_at'])
    entry = MediaVersionStageEntry.objects.create(
        id=uuid.uuid4(),
        media_version=locked_media,
        workflow_stage=stage,
        workflow_stage_status=stage_status,
        snapshot={
            'workflow_stage_id': str(stage.id),
            'workflow_stage_name': stage.name,
            'workflow_stage_slug': stage.slug,
            'workflow_stage_status_id': str(stage_status.id) if stage_status else None,
            'workflow_stage_status_name': stage_status.name if stage_status else None,
        },
        entered_at=now,
        changed_by_user=user,
        created_at=now,
    )
    record_user_audit(
        user=user,
        workspace=locked_media.project.workspace,
        action='media.workflow.transitioned',
        entity_type='media_version',
        entity_id=locked_media.id,
        metadata={'from_entry_id': str(current.id), 'to_entry_id': str(entry.id)},
    )
    return entry
