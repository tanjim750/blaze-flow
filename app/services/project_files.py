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
    FileVariant,
    ProjectFile,
    ProjectFolder,
)

from .file_processing import SCAN_TOPIC, enqueue_file_event
from .media import _storage_backend, detect_media_type, sha256_upload
from .review_assets import detect_attachment_type
from .subscriptions import enforce_workspace_storage_limit


class ProjectFileError(Exception):
    pass


def create_project_folder(*, project, created_by_membership, name, parent_folder=None, workspace=None, client_team=None):
    workspace = workspace or project.workspace
    if project is not None and client_team is None:
        client_team = project.client_team
    if ProjectFolder.objects.filter(
        workspace=workspace, parent_folder=parent_folder, name=name, deleted_at__isnull=True,
    ).exists():
        raise ProjectFileError('A folder with this name already exists in this location.')
    now = timezone.now()
    folder = ProjectFolder(
        id=uuid.uuid4(),
        workspace=workspace,
        client_team=client_team,
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
    if ProjectFolder.objects.filter(
        workspace=folder.workspace, parent_folder=folder.parent_folder, name=name,
        deleted_at__isnull=True,
    ).exclude(id=folder.id).exists():
        raise ProjectFileError('A folder with this name already exists in this location.')
    folder.name = name
    folder.updated_at = timezone.now()
    try:
        folder.full_clean()
        folder.save()
    except (IntegrityError, ValidationError) as exc:
        raise ProjectFileError('A folder with this name already exists in this location.') from exc
    return folder


@transaction.atomic
def move_project_folder(*, folder, workspace, client_team=None, project=None, parent_folder=None):
    descendant_ids = _descendant_folder_ids(folder)
    if parent_folder and parent_folder.id in descendant_ids:
        raise ProjectFileError('A folder cannot be moved inside itself.')
    if parent_folder and (
        parent_folder.workspace_id != workspace.id
        or parent_folder.client_team_id != getattr(client_team, 'id', None)
        or parent_folder.project_id != getattr(project, 'id', None)
    ):
        raise ProjectFileError('The destination folder must have the same relationships.')
    now = timezone.now()
    ProjectFolder.objects.filter(id__in=descendant_ids).update(
        workspace=workspace, client_team=client_team, project=project, updated_at=now,
    )
    ProjectFile.objects.filter(folder_id__in=descendant_ids, deleted_at__isnull=True).update(
        workspace=workspace, client_team=client_team, project=project, updated_at=now,
    )
    folder.workspace = workspace
    folder.client_team = client_team
    folder.project = project
    folder.parent_folder = parent_folder
    folder.updated_at = now
    try:
        folder.full_clean()
        folder.save(update_fields=['workspace', 'client_team', 'project', 'parent_folder', 'updated_at'])
    except (IntegrityError, ValidationError) as exc:
        raise ProjectFileError('The folder cannot be moved to that location.') from exc
    return folder


@transaction.atomic
def update_project_file(*, project_file, name=None, workspace=None, client_team=None, project=None, folder=None, task_stage=None, clear_stage=False):
    workspace = workspace or project_file.workspace
    project_file.workspace = workspace
    project_file.client_team = client_team
    project_file.project = project
    project_file.folder = folder
    # `clear_stage` distinguishes "leave the stage alone" from "move it back to no stage".
    if task_stage is not None or clear_stage:
        project_file.task_stage = task_stage
    project_file.updated_at = timezone.now()
    if name is not None:
        project_file.file.original_name = Path(name).name
        project_file.file.updated_at = project_file.updated_at
        project_file.file.save(update_fields=['original_name', 'updated_at'])
    try:
        project_file.full_clean()
        project_file.save(update_fields=['workspace', 'client_team', 'project', 'folder', 'task_stage', 'updated_at'])
    except ValidationError as exc:
        raise ProjectFileError('The file cannot be moved to that location.') from exc
    return project_file


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
    project_files = ProjectFile.objects.filter(
        folder_id__in=folder_ids, deleted_at__isnull=True,
    )
    file_ids = list(project_files.values_list('file_id', flat=True))
    project_files.update(
        deleted_at=now, updated_at=now
    )
    File.objects.filter(id__in=file_ids, deleted_at__isnull=True).update(
        deleted_at=now, updated_at=now,
    )
    FileVariant.objects.filter(file_id__in=file_ids, deleted_at__isnull=True).update(
        deleted_at=now, updated_at=now,
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


def upload_project_file(*, project, upload, membership, folder=None, workspace=None, client_team=None, task_stage=None):
    workspace = workspace or project.workspace
    if project is not None and client_team is None:
        client_team = project.client_team
    mime_type = _validate_project_file(upload)
    enforce_workspace_storage_limit(workspace=workspace, additional_bytes=upload.size)
    checksum = sha256_upload(upload)
    clean_name = Path(upload.name).name or 'file'
    object_key = (
        f'workspaces/{workspace.id}/assets/{uuid.uuid4()}/{clean_name}'
    )
    stored_key = default_storage.save(object_key, upload)
    now = timezone.now()
    try:
        with transaction.atomic():
            enforce_workspace_storage_limit(
                workspace=workspace,
                additional_bytes=upload.size,
                lock=True,
            )
            file_record = File.objects.create(
                id=uuid.uuid4(), workspace=workspace, storage_backend=_storage_backend(now), object_key=stored_key,
                original_name=clean_name, mime_type=mime_type, size_bytes=upload.size,
                checksum=checksum, checksum_algorithm='sha256', metadata={},
                status=FileStatus.PENDING, created_at=now, updated_at=now,
            )
            FileSecurityScan.objects.create(
                file=file_record, engine=settings.FILE_SECURITY_SCANNER,
            )
            project_file = ProjectFile(
                id=uuid.uuid4(), workspace=workspace, client_team=client_team,
                project=project,
                folder=folder,
                file=file_record,
                task_stage=task_stage,
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


@transaction.atomic
def delete_project_file(*, project_file):
    locked = ProjectFile.objects.select_for_update().get(id=project_file.id)
    if locked.deleted_at is not None:
        raise ProjectFileError('This file has already been removed.')
    now = timezone.now()
    locked.deleted_at = now
    locked.updated_at = now
    locked.save(update_fields=['deleted_at', 'updated_at'])
    File.objects.filter(id=locked.file_id, deleted_at__isnull=True).update(
        deleted_at=now, updated_at=now,
    )
    FileVariant.objects.filter(file_id=locked.file_id, deleted_at__isnull=True).update(
        deleted_at=now, updated_at=now,
    )
    return locked
