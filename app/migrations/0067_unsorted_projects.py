"""Give unassigned files a real home, retaining an exact rollback journal.

Run on historical models only; no storage operations, notifications or runtime services.
"""
import uuid
from django.db import migrations
from django.utils import timezone


def forwards(apps, schema_editor):
    db = schema_editor.connection.alias
    Project = apps.get_model('app', 'Project')
    Folder = apps.get_model('app', 'ProjectFolder')
    File = apps.get_model('app', 'ProjectFile')
    Workspace = apps.get_model('app', 'Workspace')
    for workspace in Workspace.objects.using(db).iterator():
        # The journal and assignments are in the same migration transaction. A retry is a no-op.
        if Project.objects.using(db).filter(workspace_id=workspace.id, is_unsorted=True).exists():
            continue
        folders = list(Folder.objects.using(db).filter(workspace_id=workspace.id, project_id=None))
        files = list(File.objects.using(db).filter(workspace_id=workspace.id, project_id=None))
        journal = {
            'folders': [{'id': str(f.id), 'name': f.name, 'client_team_id': str(f.client_team_id) if f.client_team_id else None,
                         'parent_folder_id': str(f.parent_folder_id) if f.parent_folder_id else None} for f in folders],
            'files': [{'id': str(f.id), 'client_team_id': str(f.client_team_id) if f.client_team_id else None,
                       'folder_id': str(f.folder_id) if f.folder_id else None} for f in files],
        }
        now = timezone.now()
        project = Project.objects.using(db).create(
            id=uuid.uuid4(),
            workspace_id=workspace.id, created_by_user_id=workspace.created_by_user_id,
            name='Unsorted', description='Files that did not have a project. Move them when you are ready.',
            status='ACTIVE', priority='MEDIUM', is_unsorted=True, unsorted_migration_state=journal,
            created_at=now, updated_at=now,
        )
        folder_ids = {f.id for f in folders}
        # Null-project root names were not unique. Rename collisions without losing their originals.
        used = set()
        for folder in sorted(folders, key=lambda f: str(f.id)):
            parent = folder.parent_folder_id if folder.parent_folder_id in folder_ids else None
            name = folder.name
            if (parent, name) in used:
                name = f'{name[:215]} ({folder.id})'
            used.add((parent, name))
            Folder.objects.using(db).filter(id=folder.id).update(project_id=project.id, client_team_id=None, parent_folder_id=parent, name=name)
        for file in files:
            File.objects.using(db).filter(id=file.id).update(
                project_id=project.id, client_team_id=None,
                folder_id=file.folder_id if file.folder_id in folder_ids else None,
            )


def backwards(apps, schema_editor):
    db = schema_editor.connection.alias
    Project = apps.get_model('app', 'Project')
    Folder = apps.get_model('app', 'ProjectFolder')
    File = apps.get_model('app', 'ProjectFile')
    for project in Project.objects.using(db).filter(is_unsorted=True):
        journal = project.unsorted_migration_state
        # Do not undo an explicit subsequent move to another project.
        for row in journal.get('files', []):
            values = {key: value for key, value in row.items() if key != 'id'}
            File.objects.using(db).filter(id=row['id'], project_id=project.id).update(project_id=None, **values)
        for row in journal.get('folders', []):
            values = {key: value for key, value in row.items() if key != 'id'}
            Folder.objects.using(db).filter(id=row['id'], project_id=project.id).update(project_id=None, **values)
        # Preserve later uploads, tasks, reviews or links, rather than deleting user work.
        referenced = any(
            model.objects.using(db).filter(**{field.attname: project.id}).exists()
            for model in apps.get_models() for field in model._meta.fields
            if field.is_relation and field.related_model == Project
        )
        if referenced:
            Project.objects.using(db).filter(id=project.id).update(is_unsorted=False, unsorted_migration_state={})
        else:
            Project.objects.using(db).filter(id=project.id).delete()


class Migration(migrations.Migration):
    dependencies = [('app', '0066_option_b_scope_and_unsorted')]
    operations = [migrations.RunPython(forwards, backwards)]
