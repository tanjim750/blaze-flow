import uuid
from pathlib import Path

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.files.storage import default_storage
from django.db import IntegrityError, transaction
from django.utils import timezone

from app.models import (
    File,
    FileSecurityScan,
    FileStatus,
    ProjectFile,
    ProjectFolder,
)

from .file_processing import SCAN_TOPIC, enqueue_file_event
from .media import _storage_backend, detect_media_type, sha256_upload
from .review_assets import detect_attachment_type


class ProjectFileError(Exception):
    pass


def create_project_folder(*, project, created_by_membership, name, parent_folder=None):
    now = timezone.now()
    folder = ProjectFolder(
        id=uuid.uuid4(),
        project=project,
        parent_folder=parent_folder,
        name=name,
        created_by_workspace_membership=created_by_membership,
        created_at=now,
        updated_at=now,
    )
    try:
        folder.full_clean()
        folder.save()
    except (IntegrityError, ValidationError) as exc:
        raise ProjectFileError('A folder with this name already exists in this location.') from exc
    return folder


def rename_project_folder(*, folder, name):
    folder.name = name
    folder.updated_at = timezone.now()
    try:
        folder.full_clean()
        folder.save()
    except (IntegrityError, ValidationError) as exc:
        raise ProjectFileError('A folder with this name already exists in this location.') from exc
    return folder


def _descendant_folder_ids(folder):
    ids = {folder.id}
    frontier = [folder.id]
    while frontier:
        children = list(
            ProjectFolder.objects.filter(
                parent_folder_id__in=frontier, deleted_at__isnull=True
            ).values_list('id', flat=True)
        )
        frontier = [child_id for child_id in children if child_id not in ids]
        ids.update(frontier)
    return ids


@transaction.atomic
def delete_project_folder(*, folder):
    if folder.deleted_at is not None:
        raise ProjectFileError('This folder has already been deleted.')
    now = timezone.now()
    folder_ids = _descendant_folder_ids(folder)
    ProjectFolder.objects.filter(id__in=folder_ids, deleted_at__isnull=True).update(
        deleted_at=now, updated_at=now
    )
    ProjectFile.objects.filter(folder_id__in=folder_ids, deleted_at__isnull=True).update(
        deleted_at=now, updated_at=now
    )
    folder.deleted_at = now
    return folder


def _validate_project_file(upload):
    if upload.size <= 0:
        raise ProjectFileError('The file is empty.')
    if upload.size > settings.MAX_PROJECT_FILE_BYTES:
        raise ProjectFileError('The file exceeds the configured size limit.')
    header = upload.read(32)
    upload.seek(0)
    detected = detect_attachment_type(header, upload) or detect_media_type(header)
    declared = (getattr(upload, 'content_type', '') or '').lower()
    aliases = {'image/jpg': 'image/jpeg', 'audio/x-wav': 'audio/wav', 'text/rtf': 'application/rtf'}
    if detected is None or aliases.get(declared, declared) != detected:
        raise ProjectFileError('The file signature does not match a supported type.')
    return detected


def upload_project_file(*, project, upload, membership, folder=None):
    mime_type = _validate_project_file(upload)
    checksum = sha256_upload(upload)
    clean_name = Path(upload.name).name or 'file'
    object_key = (
        f'workspaces/{project.workspace_id}/projects/{project.id}/files/{uuid.uuid4()}/{clean_name}'
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
            project_file = ProjectFile(
                id=uuid.uuid4(),
                project=project,
                folder=folder,
                file=file_record,
                added_by_workspace_membership=membership,
                created_at=now,
                updated_at=now,
            )
            project_file.full_clean()
            project_file.save()
            enqueue_file_event(file=file_record, topic=SCAN_TOPIC)
            return project_file
    except Exception:
        default_storage.delete(stored_key)
        raise


def delete_project_file(*, project_file):
    if project_file.deleted_at is not None:
        raise ProjectFileError('This file has already been removed.')
    project_file.deleted_at = timezone.now()
    project_file.updated_at = timezone.now()
    project_file.save(update_fields=['deleted_at', 'updated_at'])
    return project_file
