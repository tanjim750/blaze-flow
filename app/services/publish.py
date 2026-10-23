"""Publishing a library file into a project as a review version.

A file uploaded through Files is a ``ProjectFile``: bytes plus where it lives. Review data —
comments, annotations, decisions, guest links — hangs off a ``MediaVersion``, so until a
library file has one, the review page can only keep notes on the device. Publishing gives
it one *without copying the bytes*: the new media version points at the same ``File`` row,
which is exactly how the review page already recognises "this library file is that cut".

Two shapes, both one transaction:

- **New asset.** The library row moves into the chosen project (and folder) and a media
  version is created for it.
- **New version of an existing asset.** The library row joins that asset as its next
  version (``add_file_as_version``, the drag-onto gesture), which also aligns its project
  and folder with the asset's, and a media version is created for it.

The notes someone wrote while the file was unpublished come along as real comments
(with their drawings, replies and resolved state), written as the person publishing.
Nothing is half-done: if any note is rejected, the publish is rolled back.
"""
import uuid

from django.db import transaction
from django.utils import timezone

from app.models import (
    File, FileStatus, FileVariant, MediaVersion, MediaVersionStageEntry, Project, ProjectFile,
    ReviewCommentVisibility, WorkflowStage, WorkflowStageStatusState,
)

from .annotations import create_annotation
from .audit import record_user_audit
from .comments import ReviewCommentError, create_review_comment, set_review_comment_resolution
from .file_processing import PREVIEW_TOPIC, PREVIEW_VARIANT_TYPES, enqueue_file_event
from .project_files import ProjectFileError, add_file_as_version, update_project_file


class PublishError(Exception):
    pass


def published_version_for(file_id):
    """The media version already reviewing these bytes, if any."""
    return MediaVersion.objects.select_related('project').filter(original_file_id=file_id).order_by('created_at').first()


def _initial_stage(workspace):
    stage = WorkflowStage.objects.filter(
        workspace=workspace, status=WorkflowStageStatusState.ACTIVE,
    ).order_by('sort_order').first()
    if stage is None:
        raise PublishError('This workspace has no active review stage to publish into.')
    return stage


@transaction.atomic
def publish_library_file(*, project_file, project, user, folder=None, version_of=None, title=None, notes=(), annotations=()):
    """Creates the media version for a library file and saves its session notes as comments.

    ``notes`` are dicts: ``key`` (the client's id for the note, echoed back), ``text``,
    ``start_time_ms``, ``end_time_ms`` (a range note's out point), ``resolved``,
    ``mentioned_user_ids``, ``elements`` (a drawing saved with the note),
    ``annotation_end_time_ms`` (how long that drawing stays on screen) and ``replies``
    (``key``, ``text``, ``mentioned_user_ids``).
    ``annotations`` are free-standing drawings: ``elements``, ``start_time_ms`` and ``end_time_ms``.

    Returns ``(media_version, project_file, comment_ids)`` where ``comment_ids`` maps each
    note's and reply's ``key`` to the comment created for it.
    """
    project_file = ProjectFile.objects.select_for_update().select_related('file').get(pk=project_file.pk, deleted_at__isnull=True)
    if project.workspace_id != project_file.workspace_id:
        raise PublishError('Pick a project in this workspace.')
    if project_file.file.status != FileStatus.READY:
        raise PublishError('This file is still being processed. Publish it once it is ready.')
    existing = published_version_for(project_file.file_id)
    if existing:
        raise PublishError(f'This file is already published to {existing.project.name}.')
    if folder is not None and (folder.workspace_id != project.workspace_id or folder.project_id != project.id):
        raise PublishError('Pick a folder inside the chosen project.')
    if version_of is not None:
        if version_of.pk == project_file.pk:
            raise PublishError('A file cannot be a new version of itself.')
        if version_of.workspace_id != project.workspace_id or version_of.project_id != project.id:
            raise PublishError('Pick an asset that lives in the chosen project.')

    stage = _initial_stage(project.workspace)
    try:
        if version_of is not None:
            project_file = add_file_as_version(source=project_file, target=version_of, actor=user)
        else:
            project_file = update_project_file(
                project_file=project_file, workspace=project.workspace, client_team=project.client_team,
                project=project, folder=folder,
            )
    except ProjectFileError as exc:
        raise PublishError(str(exc)) from exc

    now = timezone.now()
    locked_project = Project.objects.select_for_update().get(pk=project.pk)
    number = locked_project.next_media_version_number
    locked_project.next_media_version_number = number + 1
    locked_project.updated_at = now
    locked_project.save(update_fields=['next_media_version_number', 'updated_at'])
    file_record = File.objects.get(pk=project_file.file_id)
    media_version = MediaVersion.objects.create(
        id=uuid.uuid4(), project=locked_project, original_file=file_record, version_number=number,
        title=(title or file_record.original_name)[:200], note='', created_by_user=user,
        created_at=now, updated_at=now,
    )
    MediaVersionStageEntry.objects.create(
        id=uuid.uuid4(), media_version=media_version, workflow_stage=stage,
        snapshot={'workflow_stage_id': str(stage.id), 'workflow_stage_name': stage.name, 'workflow_stage_slug': stage.slug},
        entered_at=now, changed_by_user=user, created_at=now,
    )
    record_user_audit(
        user=user, workspace=locked_project.workspace, action='media.published', entity_type='media_version',
        entity_id=media_version.id,
        metadata={
            'file_id': str(file_record.id), 'project_file_id': str(project_file.id), 'version_number': number,
            'as_version_of': str(version_of.id) if version_of else None, 'note_count': len(notes),
        },
    )
    # The library already asked the worker for a proxy; only ask again if it never made one.
    if file_record.mime_type.startswith('video/') and not FileVariant.objects.filter(
        file=file_record, deleted_at__isnull=True, metadata__variant_type__in=PREVIEW_VARIANT_TYPES,
    ).exists():
        enqueue_file_event(file=file_record, topic=PREVIEW_TOPIC)

    comment_ids = {}
    try:
        for note in notes:
            comment = create_review_comment(
                media_version=media_version, user=user, text=note['text'],
                start_time_ms=note.get('start_time_ms'), end_time_ms=note.get('end_time_ms'),
                mentioned_user_ids=note.get('mentioned_user_ids') or (),
                visibility=ReviewCommentVisibility.CLIENT, notify_followers=False,
            )
            comment_ids[note['key']] = str(comment.id)
            if note.get('elements'):
                create_annotation(
                    media_version=media_version, user=user, elements=note['elements'],
                    review_comment=comment, start_time_ms=note.get('start_time_ms'),
                    end_time_ms=note.get('annotation_end_time_ms'),
                )
            for reply in note.get('replies') or ():
                child = create_review_comment(
                    media_version=media_version, user=user, text=reply['text'], parent_comment=comment,
                    mentioned_user_ids=reply.get('mentioned_user_ids') or (),
                    visibility=ReviewCommentVisibility.CLIENT, notify_followers=False,
                )
                comment_ids[reply['key']] = str(child.id)
            if note.get('resolved'):
                set_review_comment_resolution(comment=comment, user=user, resolved=True)
        for drawing in annotations:
            create_annotation(
                media_version=media_version, user=user, elements=drawing['elements'],
                start_time_ms=drawing.get('start_time_ms'), end_time_ms=drawing.get('end_time_ms'),
            )
    except ReviewCommentError as exc:
        raise PublishError(f'A note could not be saved: {exc}') from exc
    project_file.refresh_from_db()
    return media_version, project_file, comment_ids
