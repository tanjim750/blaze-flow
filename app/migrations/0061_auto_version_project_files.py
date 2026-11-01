"""Backfill: every reviewable file that sits in a project becomes a review version.

Uploads now become review versions automatically (``app.services.auto_version``). Files that
were uploaded into a project before that, and never published, get a ``MediaVersion`` on the
*same* ``File`` (no bytes are copied), entered into the workspace's first active review stage
and created by the person who uploaded the file (or the workspace's primary owner).

Additive and idempotent: nothing is deleted or moved, and a file that already has a media
version is left alone. Files with no project ("Unsorted") are untouched; they become review
versions when someone moves them into a project. Reverse is a no-op on purpose: the created
versions may already carry comments by then, and removing them would lose that feedback.
"""
import uuid

from django.db import migrations
from django.db.models import Q

REVIEWABLE = Q(file__mime_type__startswith='video/') | Q(file__mime_type__startswith='image/') | \
    Q(file__mime_type__startswith='audio/') | Q(file__mime_type='application/pdf')


def backfill(apps, schema_editor):
    MediaVersion = apps.get_model('app', 'MediaVersion')
    StageEntry = apps.get_model('app', 'MediaVersionStageEntry')
    ProjectFile = apps.get_model('app', 'ProjectFile')
    Project = apps.get_model('app', 'Project')
    WorkflowStage = apps.get_model('app', 'WorkflowStage')
    Membership = apps.get_model('app', 'WorkspaceMembership')
    versioned = set(MediaVersion.objects.values_list('original_file_id', flat=True))
    rows = (ProjectFile.objects.filter(project__isnull=False, deleted_at__isnull=True, file__deleted_at__isnull=True)
            .filter(REVIEWABLE).exclude(file_id__in=versioned)
            .select_related('file', 'added_by_workspace_membership').order_by('created_at'))
    stages, owners = {}, {}
    for row in rows:
        if row.file_id in versioned:
            continue
        ws = row.workspace_id
        if ws not in stages:
            stages[ws] = WorkflowStage.objects.filter(workspace_id=ws, status='ACTIVE').order_by('sort_order').first()
            owner = Membership.objects.filter(workspace_id=ws, principal_type='USER', user__isnull=False) \
                .order_by('-is_primary_owner', 'created_at').first()
            owners[ws] = owner.user_id if owner else None
        stage = stages[ws]
        member = row.added_by_workspace_membership
        actor_id = (member.user_id if member is not None and member.user_id else None) or owners[ws]
        if stage is None or actor_id is None:
            continue
        project = Project.objects.select_for_update().get(pk=row.project_id)
        number = project.next_media_version_number
        project.next_media_version_number = number + 1
        project.save(update_fields=['next_media_version_number'])
        when = row.created_at
        version = MediaVersion.objects.create(
            id=uuid.uuid4(), project_id=project.id, original_file_id=row.file_id, version_number=number,
            title=(row.file.original_name or 'Untitled')[:200], note='', created_by_user_id=actor_id,
            created_at=when, updated_at=when,
        )
        StageEntry.objects.create(
            id=uuid.uuid4(), media_version=version, workflow_stage=stage,
            snapshot={'workflow_stage_id': str(stage.id), 'workflow_stage_name': stage.name, 'workflow_stage_slug': stage.slug},
            entered_at=when, changed_by_user_id=actor_id, created_at=when,
        )
        versioned.add(row.file_id)


class Migration(migrations.Migration):
    dependencies = [('app', '0060_platform_workspace_view')]
    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
