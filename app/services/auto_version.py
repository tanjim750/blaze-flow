"""Every reviewable file in a project is a review version (the Frame.io model).

A ``ProjectFile`` holds the bytes and where they live; review data (comments, drawings,
decisions, guest links) hangs off a ``MediaVersion`` on the *same* ``File``. There used to be
a separate "Publish to project" step between the two. Now the media version is created as
soon as a reviewable file sits in a project: on upload, when it is moved into a project and
when it is stacked onto an asset as its next version. No bytes are copied.

Files with no project (the "Unsorted" drive area) stay plain files until they are moved into
a project, because a media version needs a project to belong to.

Idempotent: a file that already has a media version is left alone.
"""
import logging
import uuid

from django.db import transaction
from django.utils import timezone

from app.models import (
    File, MediaVersion, MediaVersionStageEntry, Project, WorkflowStage, WorkflowStageStatusState,
    WorkspaceMembership, WorkspacePrincipalType,
)

logger = logging.getLogger(__name__)

REVIEWABLE_PREFIXES = ('video/', 'image/', 'audio/')
REVIEWABLE_TYPES = {'application/pdf'}


def is_reviewable(mime_type):
    mime_type = (mime_type or '').lower()
    return mime_type.startswith(REVIEWABLE_PREFIXES) or mime_type in REVIEWABLE_TYPES


def review_version_for(file_id):
    return MediaVersion.objects.filter(original_file_id=file_id).order_by('created_at').first()


def _actor_for(project_file, user=None):
    if user is not None and getattr(user, 'is_authenticated', False):
        return user
    membership = project_file.added_by_workspace_membership
    if membership is not None and membership.user_id:
        return membership.user
    owner = WorkspaceMembership.objects.filter(
        workspace_id=project_file.workspace_id, principal_type=WorkspacePrincipalType.USER, user__isnull=False,
    ).order_by('-is_primary_owner', 'created_at').select_related('user').first()
    return owner.user if owner else None


def ensure_review_version(*, project_file, user=None, title=None, notify=True):
    """Returns the media version reviewing ``project_file``, creating it when the file is in a project.

    Returns ``None`` (and creates nothing) for a file with no project, a non-reviewable type, a
    removed row, or a workspace with no active review stage.
    """
    from .notifications import notify_library_version_added

    if project_file.deleted_at is not None or not project_file.project_id:
        return None
    file_record = File.objects.get(pk=project_file.file_id)
    existing = review_version_for(file_record.id)
    if existing is not None:
        return existing
    if not is_reviewable(file_record.mime_type):
        return None
    stage = WorkflowStage.objects.filter(
        workspace_id=project_file.workspace_id, status=WorkflowStageStatusState.ACTIVE,
    ).order_by('sort_order').first()
    actor = _actor_for(project_file, user)
    if stage is None or actor is None:
        logger.warning('auto-version skipped for project file %s: no active stage or actor', project_file.id)
        return None
    now = timezone.now()
    with transaction.atomic():
        project = Project.objects.select_for_update().get(pk=project_file.project_id)
        # Re-check under the project lock so two racing moves cannot both create one.
        existing = review_version_for(file_record.id)
        if existing is not None:
            return existing
        number = project.next_media_version_number
        project.next_media_version_number = number + 1
        project.updated_at = now
        project.save(update_fields=['next_media_version_number', 'updated_at'])
        media_version = MediaVersion.objects.create(
            id=uuid.uuid4(), project=project, original_file=file_record, version_number=number,
            title=(title or file_record.original_name)[:200], note='', created_by_user=actor,
            created_at=now, updated_at=now,
        )
        MediaVersionStageEntry.objects.create(
            id=uuid.uuid4(), media_version=media_version, workflow_stage=stage,
            snapshot={'workflow_stage_id': str(stage.id), 'workflow_stage_name': stage.name, 'workflow_stage_slug': stage.slug},
            entered_at=now, changed_by_user=actor, created_at=now,
        )
        from .audit import record_user_audit
        record_user_audit(
            user=actor, workspace=project.workspace, action='media.auto_versioned', entity_type='media_version',
            entity_id=media_version.id,
            metadata={'file_id': str(file_record.id), 'project_file_id': str(project_file.id), 'version_number': number},
        )
    if notify and project_file.version_number and project_file.version_number > 1:
        # V2+ of an asset: tell the people on the earlier cuts.
        notify_library_version_added(project_file=project_file, actor=actor)
    return media_version
