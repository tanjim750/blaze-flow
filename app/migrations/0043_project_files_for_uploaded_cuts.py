"""Backfill: list cuts uploaded straight to a project (``MediaVersion`` only) in its Files.

Before this fix, "Upload Asset" on the Projects page created a review version but no
``ProjectFile``, so the cut was missing from the project's Files tab, the library and the
folder tree. Each such cut gets a ``ProjectFile`` (and its own ``MediaAsset``), added by the
uploader's membership, or by the workspace's primary owner if the uploader has none.
Additive and idempotent: a file that already has a ``ProjectFile`` is left alone.
"""
import re
import uuid

from django.db import migrations


def version_key(title):
    # Frozen copy of app.services.notifications.version_key.
    title = (title or '').lower()
    title = re.sub(r'\.[a-z0-9]{1,5}$', '', title)
    title = re.sub(r'[\s._-]*(?:v|ver|version)[\s._-]*\d+$', '', title)
    return re.sub(r'[^a-z0-9]+', ' ', title).strip()


def backfill(apps, schema_editor):
    MediaVersion = apps.get_model('app', 'MediaVersion')
    ProjectFile = apps.get_model('app', 'ProjectFile')
    MediaAsset = apps.get_model('app', 'MediaAsset')
    Membership = apps.get_model('app', 'WorkspaceMembership')
    listed = set(ProjectFile.objects.values_list('file_id', flat=True))
    assets = {}  # (project_id, version key) -> [asset, next version number, folder_id]
    for version in MediaVersion.objects.select_related('project', 'original_file').order_by('created_at'):
        if version.original_file_id in listed:
            continue
        project = version.project
        members = Membership.objects.filter(workspace_id=project.workspace_id, principal_type='USER', status='ACTIVE')
        membership = (members.filter(user_id=version.created_by_user_id).order_by('created_at').first()
                      or members.filter(is_primary_owner=True).first() or members.order_by('created_at').first())
        if membership is None:
            continue
        group = (project.id, version_key(version.title))
        if group not in assets:
            asset = MediaAsset.objects.create(workspace_id=project.workspace_id, name=(version.title or 'Cut')[:255])
            assets[group] = [asset, 1, None]
        asset, number, folder_id = assets[group]
        assets[group][1] = number + 1
        ProjectFile.objects.create(
            id=uuid.uuid4(), workspace_id=project.workspace_id, client_team_id=project.client_team_id,
            project_id=project.id, folder_id=folder_id, file_id=version.original_file_id, media_asset=asset, version_number=number,
            added_by_workspace_membership=membership, created_at=version.created_at, updated_at=version.created_at,
        )
        listed.add(version.original_file_id)


class Migration(migrations.Migration):
    dependencies = [('app', '0042_ai_visual_qa')]
    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
