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
    MediaAsset,
    MediaVersion,
    MediaVersionStageEntry,
    Project,
    ProjectFile,
    StorageBackend,
    WorkflowStage,
    WorkflowStageStatusState,
    WorkspacePrincipalType,
)
from app.permissions import active_memberships_for_user

from .audit import record_user_audit
from .file_processing import PREVIEW_TOPIC, enqueue_file_event
from .notifications import notify_new_media_version
from .subscriptions import enforce_workspace_storage_limit


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
    provider = settings.STORAGE_PROVIDER
    backend = StorageBackend.objects.filter(provider=provider).first()
    if backend:
        return backend
    return StorageBackend.objects.create(
        id=uuid.uuid4(),
        name='S3-compatible private storage' if provider == 's3-compatible' else 'Django default storage',
        provider=provider,
        config=settings.STORAGE_PUBLIC_METADATA,
        created_at=now,
        updated_at=now,
    )


def _add_to_project_files(*, project, file_record, title, user, now):
    """Lists an uploaded cut in the project's Files, as a publish does for a library file.

    The project's Files tab, the Files library and the folder tree all read ``ProjectFile``;
    a cut that only has a ``MediaVersion`` is reachable from its review link and nowhere
    else. A cut whose title matches an earlier cut in the project (the review page's
    version rule, "Hero 30s" / "Hero 30s v2") joins that asset as its next version, in the
    same folder; anything else is a new asset at V1, like a Files upload.
    """
    from django.db.models import Max

    from .notifications import version_key
    membership = active_memberships_for_user(user=user, workspace=project.workspace).filter(
        principal_type=WorkspacePrincipalType.USER,
    ).order_by('created_at').first()
    if membership is None:
        return None
    key = version_key(title)
    sibling_files = [
        mv.original_file_id for mv in MediaVersion.objects.filter(project=project).exclude(original_file=file_record).only('title', 'original_file_id')
        if version_key(mv.title) == key
    ]
    sibling = ProjectFile.objects.filter(
        file_id__in=sibling_files, project=project, deleted_at__isnull=True, media_asset__isnull=False,
    ).order_by('-version_number').first() if key else None
    if sibling:
        asset, folder = sibling.media_asset, sibling.folder
        number = (ProjectFile.objects.filter(media_asset=asset).aggregate(n=Max('version_number'))['n'] or 0) + 1
    else:
        asset = MediaAsset.objects.create(workspace=project.workspace, name=(title or Path(file_record.original_name).stem)[:255])
        folder, number = None, 1
    return ProjectFile.objects.create(
        id=uuid.uuid4(), workspace=project.workspace, client_team=project.client_team, project=project,
        folder=folder, file=file_record, media_asset=asset, version_number=number,
        added_by_workspace_membership=membership, created_at=now, updated_at=now,
    )


def upload_media_version(*, project, user, upload, title, note='', priority='MEDIUM', allow_download=False, initial_stage=None):
    detected_type = validate_media_upload(upload)
    enforce_workspace_storage_limit(workspace=project.workspace, additional_bytes=upload.size)
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
            enforce_workspace_storage_limit(
                workspace=locked_project.workspace,
                additional_bytes=upload.size,
                lock=True,
            )
            version_number = locked_project.next_media_version_number
            locked_project.next_media_version_number = version_number + 1
            locked_project.updated_at = now
            locked_project.save(update_fields=['next_media_version_number', 'updated_at'])
            backend = _storage_backend(now)
            file_record = File.objects.create(
                id=uuid.uuid4(),
                workspace=locked_project.workspace,
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
            _add_to_project_files(project=locked_project, file_record=file_record, title=title, user=user, now=now)
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
            if detected_type.startswith('video/'):
                enqueue_file_event(file=file_record, topic=PREVIEW_TOPIC)
            notify_new_media_version(media_version=media_version, actor=user)
            return media_version
    except Exception:
        default_storage.delete(stored_key)
        raise
