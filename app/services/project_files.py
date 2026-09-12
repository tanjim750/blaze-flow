import uuid
from pathlib import Path

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.files.storage import default_storage
from django.db import IntegrityError, models, transaction
from django.utils import timezone

from app.models import (
    MediaAsset,
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
def add_file_as_version(*, source, target):
    """Makes `source` the next version of whatever asset `target` belongs to.

    This is the drag-one-video-onto-another gesture. Nothing is overwritten and nothing is
    renumbered: the newcomer takes the next number after the highest already in the asset,
    so V1's review data is untouched and stays addressable.

    The source's relationships are aligned with the target's, because versions of one asset
    living in two different folders would be incoherent — and it is the asset, not the
    version, that a person thinks of as being somewhere.
    """
    if source.pk == target.pk:
        raise ProjectFileError('A file cannot be a version of itself.')
    if source.workspace_id != target.workspace_id:
        raise ProjectFileError('Both files must belong to the same workspace.')

    source_kind = (source.file.mime_type or '').split('/')[0]
    target_kind = (target.file.mime_type or '').split('/')[0]
    if source_kind != target_kind:
        raise ProjectFileError('A version has to be the same kind of media as the asset.')

    with transaction.atomic():
        source = ProjectFile.objects.select_for_update().get(pk=source.pk, deleted_at__isnull=True)
        target = ProjectFile.objects.select_for_update().get(pk=target.pk, deleted_at__isnull=True)

        if source.media_asset_id and source.media_asset_id == target.media_asset_id:
            raise ProjectFileError('That file is already a version of this asset.')
        if source.media_asset_id and source.media_asset.versions.filter(deleted_at__isnull=True).exclude(pk=source.pk).exists():
            raise ProjectFileError(
                'That file already has versions of its own. Move it out of its asset before adding it to another.'
            )

        asset = target.media_asset
        if asset is None:
            asset = MediaAsset.objects.create(workspace=target.workspace, name=Path(target.file.original_name).stem)
            target.media_asset = asset
            target.version_number = 1
            target.updated_at = timezone.now()
            target.save(update_fields=['media_asset', 'version_number', 'updated_at'])

        emptied = source.media_asset
        highest = asset.versions.aggregate(models.Max('version_number'))['version_number__max'] or 0
        source.media_asset = asset
        source.version_number = highest + 1
        source.client_team = target.client_team
        source.project = target.project
        source.folder = target.folder
        source.updated_at = timezone.now()
        source.full_clean()
        source.save(update_fields=['media_asset', 'version_number', 'client_team', 'project', 'folder', 'updated_at'])

        # The asset the newcomer came from is now empty; leaving it would litter the library
        # with assets that have no versions.
        if emptied and emptied.pk != asset.pk and not emptied.versions.exists():
            emptied.delete()

        asset.updated_at = timezone.now()
        asset.save(update_fields=['updated_at'])
        return source


def duplicate_project_file(*, project_file, membership):
    """Copies an asset, bytes and all.

    `project_files_workspace_file_uniq` means a workspace cannot hold two rows against the
    same `File`, so a duplicate has to be a real copy rather than a second pointer at the
    original. The copy therefore counts against the storage limit, and is checked against
    it before anything is written.

    It goes through the normal scan-then-preview pipeline rather than inheriting the
    original's READY status and variants. That re-does work on identical bytes, but the
    alternative is a second path into `FileStatus.READY` that never passes a scanner, and
    a cheaper duplicate is not worth that.
    """
    source = project_file.file
    workspace = project_file.workspace
    enforce_workspace_storage_limit(workspace=workspace, additional_bytes=source.size_bytes)

    clean_name = _copy_name(source.original_name)
    object_key = f'workspaces/{workspace.id}/assets/{uuid.uuid4()}/{clean_name}'
    with default_storage.open(source.object_key, 'rb') as stream:
        stored_key = default_storage.save(object_key, stream)

    now = timezone.now()
    try:
        with transaction.atomic():
            enforce_workspace_storage_limit(
                workspace=workspace, additional_bytes=source.size_bytes, lock=True,
            )
            file_record = File.objects.create(
                id=uuid.uuid4(), workspace=workspace, storage_backend=_storage_backend(now),
                object_key=stored_key, original_name=clean_name, mime_type=source.mime_type,
                size_bytes=source.size_bytes, checksum=source.checksum,
                checksum_algorithm=source.checksum_algorithm, metadata=dict(source.metadata or {}),
                status=FileStatus.PENDING, created_at=now, updated_at=now,
            )
            FileSecurityScan.objects.create(file=file_record, engine=settings.FILE_SECURITY_SCANNER)
            copy = ProjectFile(
                id=uuid.uuid4(), workspace=workspace, client_team=project_file.client_team,
                project=project_file.project, folder=project_file.folder, file=file_record,
                # A copy is a new asset, not another cut of the original: duplicating is for
                # branching off, and versioning is the gesture for adding to a history.
                media_asset=MediaAsset.objects.create(workspace=workspace, name=Path(clean_name).stem or clean_name),
                version_number=1,
                task_stage=project_file.task_stage, added_by_workspace_membership=membership,
                created_at=now, updated_at=now,
            )
            copy.full_clean()
            copy.save()
            enqueue_file_event(file=file_record, topic=SCAN_TOPIC)
            return copy
    except Exception:
        default_storage.delete(stored_key)
        raise


def _copy_name(name):
    """`daily life.mov` -> `daily life (copy).mov`, so the suffix stays off the extension."""
    stem = Path(name).stem or name
    suffix = Path(name).suffix
    return f'{stem} (copy){suffix}'[:512]


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
        limit_mb = settings.MAX_PROJECT_FILE_BYTES / (1024 * 1024)
        raise ProjectFileError(
            f'The file is {upload.size / (1024 * 1024):.0f} MB, over the {limit_mb:.0f} MB upload limit.'
        )
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
            # Every upload starts as its own asset at V1. Dragging one onto another is what
            # later merges two of these into one history.
            asset = MediaAsset.objects.create(workspace=workspace, name=Path(clean_name).stem or clean_name)
            project_file = ProjectFile(
                id=uuid.uuid4(), workspace=workspace, client_team=client_team,
                project=project,
                folder=folder,
                file=file_record,
                media_asset=asset,
                version_number=1,
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
