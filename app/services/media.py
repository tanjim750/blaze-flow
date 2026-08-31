import uuid
from pathlib import Path

from django.conf import settings
from django.core.files.storage import default_storage
from django.db import transaction
from django.utils import timezone

from app.models import (
    File,
    FileStatus,
    MediaVersion,
    MediaVersionStageEntry,
    Project,
    StorageBackend,
    WorkflowStage,
    WorkflowStageStatusState,
)


class MediaUploadError(Exception):
    pass


def validate_media_upload(upload):
    content_type = (getattr(upload, 'content_type', None) or '').lower()
    if not (content_type.startswith('video/') or content_type.startswith('image/')):
        raise MediaUploadError('Only video and image uploads are supported.')
    if upload.size <= 0:
        raise MediaUploadError('The uploaded file is empty.')
    if upload.size > settings.MAX_MEDIA_UPLOAD_BYTES:
        raise MediaUploadError('The uploaded file exceeds the configured size limit.')


def _storage_backend(now):
    backend = StorageBackend.objects.filter(provider='django-default').first()
    if backend:
        return backend
    return StorageBackend.objects.create(
        id=uuid.uuid4(),
        name='Django default storage',
        provider='django-default',
        config={},
        created_at=now,
        updated_at=now,
    )


def upload_media_version(*, project, user, upload, title, note='', priority='MEDIUM', allow_download=False, initial_stage=None):
    validate_media_upload(upload)
    if initial_stage is None:
        initial_stage = WorkflowStage.objects.filter(
            workspace=project.workspace,
            status=WorkflowStageStatusState.ACTIVE,
        ).order_by('sort_order').first()
    if (
        initial_stage is None
        or initial_stage.workspace_id != project.workspace_id
        or initial_stage.status != WorkflowStageStatusState.ACTIVE
    ):
        raise MediaUploadError('Select an active workflow stage from this workspace.')

    clean_name = Path(upload.name).name or 'upload'
    object_key = (
        f'workspaces/{project.workspace_id}/projects/{project.id}/media/'
        f'{uuid.uuid4()}/{clean_name}'
    )
    stored_key = default_storage.save(object_key, upload)
    now = timezone.now()
    try:
        with transaction.atomic():
            locked_project = Project.objects.select_for_update().get(id=project.id)
            version_number = locked_project.next_media_version_number
            locked_project.next_media_version_number = version_number + 1
            locked_project.updated_at = now
            locked_project.save(update_fields=['next_media_version_number', 'updated_at'])
            backend = _storage_backend(now)
            file_record = File.objects.create(
                id=uuid.uuid4(),
                storage_backend=backend,
                object_key=stored_key,
                original_name=clean_name,
                mime_type=upload.content_type,
                size_bytes=upload.size,
                metadata={},
                status=FileStatus.READY,
                created_at=now,
                updated_at=now,
            )
            media_version = MediaVersion.objects.create(
                id=uuid.uuid4(),
                project=locked_project,
                original_file=file_record,
                version_number=version_number,
                title=title,
                note=note,
                priority=priority,
                allow_download=allow_download,
                created_by_user=user,
                created_at=now,
                updated_at=now,
            )
            MediaVersionStageEntry.objects.create(
                id=uuid.uuid4(),
                media_version=media_version,
                workflow_stage=initial_stage,
                snapshot={
                    'workflow_stage_id': str(initial_stage.id),
                    'workflow_stage_name': initial_stage.name,
                    'workflow_stage_slug': initial_stage.slug,
                },
                entered_at=now,
                changed_by_user=user,
                created_at=now,
            )
            return media_version
    except Exception:
        default_storage.delete(stored_key)
        raise
