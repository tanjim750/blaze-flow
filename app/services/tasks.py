import uuid
from pathlib import Path

from django.conf import settings
from django.core.files.storage import default_storage
from django.db import transaction
from django.utils import timezone

from app.models import (
    File,
    FileSecurityScan,
    FileStatus,
    FileVariant,
    Task,
    TaskAssignee,
    TaskAttachment,
    TaskStatus,
)

from . import billing
from .audit import record_user_audit
from .file_processing import SCAN_TOPIC, enqueue_file_event
from .notifications import notify_task_assigned
from .media import _storage_backend, detect_media_type, sha256_upload
from .review_assets import detect_attachment_type
from .subscriptions import enforce_workspace_storage_limit


class TaskError(Exception):
    pass


def stage_ref(stage):
    """A stage as stored in task history: id plus the name and kind it had at the time."""
    if stage is None:
        return None
    return {'id': str(stage.id), 'name': stage.name, 'kind': stage.kind}


def _iso(value):
    return value.isoformat() if value else None


def _task_audit(*, actor, task, action, at=None, **metadata):
    """Every task event carries the title it had then, so history reads right after a rename.

    ``task.created`` and ``task.stage.moved`` together are the task's stage history: each
    row's ``created_at`` is when the task entered ``to_stage`` (or ``stage`` on creation),
    and the next move is when it left, which is all time-in-stage needs.
    """
    return record_user_audit(
        user=actor, workspace=task.workspace, action=action, entity_type='task',
        entity_id=task.id, project=task.project_id, team_only=False, at=at,
        metadata={'task_title': task.title, **metadata},
    )


def record_task_stage_move(*, task, actor, from_stage, to_stage, reason=None, at=None):
    extra = {'reason': reason} if reason else {}
    return _task_audit(
        actor=actor, task=task, action='task.stage.moved', at=at,
        from_stage=stage_ref(from_stage), to_stage=stage_ref(to_stage), **extra,
    )


@transaction.atomic
def create_task(*, workspace, created_by_membership, project=None, actor=None, **fields):
    now = timezone.now()
    task = Task(
        id=uuid.uuid4(),
        workspace=workspace,
        project=project,
        created_by_workspace_membership=created_by_membership,
        created_at=now,
        updated_at=now,
        **fields,
    )
    task.full_clean()
    task.save()
    billing.on_task_stage_changed(task=task, from_stage=None)
    _task_audit(
        actor=actor, task=task, action='task.created', at=now,
        stage=stage_ref(task.task_stage), due_at=_iso(task.due_at),
    )
    return task


@transaction.atomic
def update_task(*, task, actor=None, **fields):
    before_stage = task.task_stage if task.task_stage_id else None
    before_due = task.due_at
    if 'task_stage' in fields and fields['task_stage'] is not None:
        is_completed = fields['task_stage'].is_done
        fields.setdefault('status', TaskStatus.APPROVED if is_completed else TaskStatus.TODO)
    else:
        is_completed = fields.get('status', task.status) in {TaskStatus.COMPLETED, TaskStatus.APPROVED}
    was_completed = bool(task.task_stage_id and task.task_stage.is_done) if task.task_stage_id else task.status in {TaskStatus.COMPLETED, TaskStatus.APPROVED}
    if is_completed and not was_completed:
        task.completed_at = timezone.now()
    elif not is_completed and was_completed:
        task.completed_at = None
    for field, value in fields.items():
        setattr(task, field, value)
    task.updated_at = timezone.now()
    task.full_clean()
    task.save()
    if task.task_stage_id != (before_stage.id if before_stage else None):
        # Entering the Approved stage kind freezes every assignee's pay as earned.
        billing.on_task_stage_changed(task=task, from_stage=before_stage)
        record_task_stage_move(task=task, actor=actor, from_stage=before_stage, to_stage=task.task_stage, at=task.updated_at)
    if task.due_at != before_due:
        _task_audit(actor=actor, task=task, action='task.due_date.changed', at=task.updated_at, before=_iso(before_due), after=_iso(task.due_at))
    return task


@transaction.atomic
def delete_task(*, task):
    locked = Task.objects.select_for_update().get(id=task.id)
    if locked.deleted_at is not None:
        raise TaskError('This task has already been deleted.')
    now = timezone.now()
    file_ids = list(TaskAttachment.objects.filter(task=locked).values_list('file_id', flat=True))
    File.objects.filter(id__in=file_ids, deleted_at__isnull=True).update(
        deleted_at=now, updated_at=now,
    )
    FileVariant.objects.filter(file_id__in=file_ids, deleted_at__isnull=True).update(
        deleted_at=now, updated_at=now,
    )
    locked.deleted_at = now
    locked.updated_at = now
    locked.save(update_fields=['deleted_at', 'updated_at'])
    return locked


def add_task_assignee(*, task, membership, actor=None):
    if membership.workspace_id != task.workspace_id:
        raise TaskError('The assignee must belong to the task workspace.')
    if TaskAssignee.objects.filter(task=task, workspace_membership=membership).exists():
        raise TaskError('This membership is already assigned to the task.')
    assignee = TaskAssignee(
        id=uuid.uuid4(),
        task=task,
        workspace_membership=membership,
        assigned_at=timezone.now(),
    )
    assignee.full_clean()
    assignee.save()
    billing.ensure_assignee_pay(task=task, membership=membership)
    notify_task_assigned(assignee=assignee, actor=actor)
    _task_audit(
        actor=actor, task=task, action='task.assigned', at=assignee.assigned_at,
        assignee=_membership_ref(membership),
    )
    return assignee


def _membership_ref(membership):
    user = membership.user
    name = (user.get_full_name() or user.email) if user else (membership.client_team.name if membership.client_team_id else 'Someone')
    return {'membership_id': str(membership.id), 'user_id': str(user.id) if user else None, 'name': name}


def remove_task_assignee(*, assignee, actor=None):
    task = assignee.task
    membership = assignee.workspace_membership
    assignee.delete()
    billing.drop_pending_pay(task=task, membership=membership)
    _task_audit(actor=actor, task=task, action='task.unassigned', assignee=_membership_ref(membership))


def _validate_task_attachment(upload):
    if upload.size <= 0:
        raise TaskError('The attachment is empty.')
    if upload.size > settings.MAX_TASK_ATTACHMENT_BYTES:
        raise TaskError('The attachment exceeds the configured size limit.')
    header = upload.read(32)
    upload.seek(0)
    detected = detect_attachment_type(header, upload) or detect_media_type(header)
    declared = (getattr(upload, 'content_type', '') or '').lower()
    aliases = {'image/jpg': 'image/jpeg', 'audio/x-wav': 'audio/wav', 'text/rtf': 'application/rtf'}
    if detected is None or aliases.get(declared, declared) != detected:
        raise TaskError('The attachment signature does not match a supported type.')
    return detected


def link_task_attachment(*, task, file, membership):
    """Attach a file that already exists in the workspace (a library asset or a cut).

    Nothing is copied: the attachment points at the same ``File`` row, so the task opens the
    very same review the Files library does.
    """
    if file.workspace_id != task.workspace_id:
        raise TaskError('The file must belong to the task workspace.')
    if TaskAttachment.objects.filter(task=task, file=file).exists():
        raise TaskError('This file is already attached to the task.')
    attachment = TaskAttachment(
        id=uuid.uuid4(), task=task, file=file,
        attached_by_workspace_membership=membership, attached_at=timezone.now(),
    )
    attachment.full_clean()
    attachment.save()
    return attachment


def upload_task_attachment(*, task, upload, membership):
    mime_type = _validate_task_attachment(upload)
    enforce_workspace_storage_limit(workspace=task.workspace, additional_bytes=upload.size)
    checksum = sha256_upload(upload)
    clean_name = Path(upload.name).name or 'attachment'
    object_key = (
        f'workspaces/{task.workspace_id}/tasks/{task.id}/{uuid.uuid4()}/{clean_name}'
    )
    stored_key = default_storage.save(object_key, upload)
    now = timezone.now()
    try:
        with transaction.atomic():
            enforce_workspace_storage_limit(
                workspace=task.workspace,
                additional_bytes=upload.size,
                lock=True,
            )
            file_record = File.objects.create(
                id=uuid.uuid4(), workspace_id=task.workspace_id, storage_backend=_storage_backend(now), object_key=stored_key,
                original_name=clean_name, mime_type=mime_type, size_bytes=upload.size,
                checksum=checksum, checksum_algorithm='sha256', metadata={},
                status=FileStatus.PENDING, created_at=now, updated_at=now,
            )
            FileSecurityScan.objects.create(
                file=file_record, engine=settings.FILE_SECURITY_SCANNER,
            )
            attachment = TaskAttachment(
                id=uuid.uuid4(),
                task=task,
                file=file_record,
                attached_by_workspace_membership=membership,
                attached_at=now,
            )
            attachment.full_clean()
            attachment.save()
            enqueue_file_event(file=file_record, topic=SCAN_TOPIC)
            return attachment
    except Exception:
        default_storage.delete(stored_key)
        raise


@transaction.atomic
def delete_task_attachment(*, attachment):
    locked = TaskAttachment.objects.select_for_update().get(id=attachment.id)
    now = timezone.now()
    File.objects.filter(id=locked.file_id, deleted_at__isnull=True).update(
        deleted_at=now, updated_at=now,
    )
    FileVariant.objects.filter(file_id=locked.file_id, deleted_at__isnull=True).update(
        deleted_at=now, updated_at=now,
    )
    locked.delete()
