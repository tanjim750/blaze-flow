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
    Task,
    TaskAssignee,
    TaskAttachment,
    TaskStatus,
)

from .file_processing import SCAN_TOPIC, enqueue_file_event
from .media import _storage_backend, detect_media_type, sha256_upload
from .review_assets import detect_attachment_type


class TaskError(Exception):
    pass


@transaction.atomic
def create_task(*, workspace, created_by_membership, project=None, **fields):
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
    return task


def update_task(*, task, **fields):
    if 'status' in fields:
        new_status = fields['status']
        if new_status == TaskStatus.COMPLETED and task.status != TaskStatus.COMPLETED:
            task.completed_at = timezone.now()
        elif new_status != TaskStatus.COMPLETED and task.status == TaskStatus.COMPLETED:
            task.completed_at = None
    for field, value in fields.items():
        setattr(task, field, value)
    task.updated_at = timezone.now()
    task.full_clean()
    task.save()
    return task


def delete_task(*, task):
    if task.deleted_at is not None:
        raise TaskError('This task has already been deleted.')
    task.deleted_at = timezone.now()
    task.updated_at = timezone.now()
    task.save(update_fields=['deleted_at', 'updated_at'])
    return task


def add_task_assignee(*, task, membership):
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
    return assignee


def remove_task_assignee(*, assignee):
    assignee.delete()


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


def upload_task_attachment(*, task, upload, membership):
    mime_type = _validate_task_attachment(upload)
    checksum = sha256_upload(upload)
    clean_name = Path(upload.name).name or 'attachment'
    object_key = (
        f'workspaces/{task.workspace_id}/tasks/{task.id}/{uuid.uuid4()}/{clean_name}'
    )
    stored_key = default_storage.save(object_key, upload)
    now = timezone.now()
    try:
        with transaction.atomic():
            file_record = File.objects.create(
                id=uuid.uuid4(), storage_backend=_storage_backend(now), object_key=stored_key,
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


def delete_task_attachment(*, attachment):
    attachment.delete()
