import uuid
import hashlib
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
from .audit import record_user_audit


class MediaUploadError(Exception):
    pass


def detect_media_type(header):
    if header.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'image/png'
    if header.startswith(b'\xff\xd8\xff'):
        return 'image/jpeg'
    if header.startswith((b'GIF87a', b'GIF89a')):
        return 'image/gif'
    if header.startswith(b'RIFF') and header[8:12] == b'WEBP':
        return 'image/webp'
    if len(header) >= 12 and header[4:8] == b'ftyp':
        brand = header[8:12]
        return 'video/quicktime' if brand == b'qt  ' else 'video/mp4'
    if header.startswith(b'\x1aE\xdf\xa3'):
        return 'video/webm'
    return None


def validate_media_upload(upload):
    content_type = (getattr(upload, 'content_type', None) or '').lower()
    if not (content_type.startswith('video/') or content_type.startswith('image/')):
        raise MediaUploadError('Only video and image uploads are supported.')
    if upload.size <= 0:
        raise MediaUploadError('The uploaded file is empty.')
    if upload.size > settings.MAX_MEDIA_UPLOAD_BYTES:
        raise MediaUploadError('The uploaded file exceeds the configured size limit.')
    header = upload.read(32)
    upload.seek(0)
    detected_type = detect_media_type(header)
    aliases = {'image/jpg': 'image/jpeg', 'video/quicktime': 'video/quicktime'}
    declared_type = aliases.get(content_type, content_type)
    if detected_type is None:
        raise MediaUploadError('The file signature is not a supported image or video format.')
    if declared_type != detected_type:
        raise MediaUploadError('The reported content type does not match the file signature.')
    return detected_type


def sha256_upload(upload):
    digest = hashlib.sha256()
    for chunk in upload.chunks():
        digest.update(chunk)
    upload.seek(0)
    return digest.hexdigest()


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
    detected_type = validate_media_upload(upload)
    checksum = sha256_upload(upload)
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
                mime_type=detected_type,
                size_bytes=upload.size,
                checksum=checksum,
                checksum_algorithm='sha256',
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
            record_user_audit(
                user=user,
                workspace=locked_project.workspace,
                action='media.uploaded',
                entity_type='media_version',
                entity_id=media_version.id,
                metadata={
                    'file_id': str(file_record.id),
                    'version_number': version_number,
                    'checksum_sha256': checksum,
                },
            )
            return media_version
    except Exception:
        default_storage.delete(stored_key)
        raise
