from importlib import import_module
from types import SimpleNamespace
import uuid
from django.apps import apps
from django.db import connection
from django.test import TestCase, TransactionTestCase
from django.utils import timezone
from .models import Project, ProjectFile, ProjectFolder, File, Workspace, StorageBackend, ClientTeam
from .test_access_projects import WorkspaceAccessSetupMixin

migration = import_module('app.migrations.0067_unsorted_projects')


class UnsortedMigrationTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.schema = SimpleNamespace(connection=connection)
        self.now = timezone.now()

    def folder(self, name, parent=None):
        return ProjectFolder.objects.create(id=uuid.uuid4(), workspace=self.workspace, name=name, parent_folder=parent,
            created_by_workspace_membership=self.owner_membership, created_at=self.now, updated_at=self.now)

    def test_empty_studios_are_safe_idempotent_and_reverse_removes_only_created_projects(self):
        before = set(Project.objects.values_list('id', flat=True))
        migration.forwards(apps, self.schema)
        ids = set(Project.objects.filter(is_unsorted=True).values_list('id', flat=True))
        self.assertEqual(len(ids), Workspace.objects.count())
        migration.forwards(apps, self.schema)
        self.assertEqual(set(Project.objects.filter(is_unsorted=True).values_list('id', flat=True)), ids)
        migration.backwards(apps, self.schema)
        self.assertEqual(set(Project.objects.values_list('id', flat=True)), before)

    def test_hierarchy_colliding_names_and_client_assignments_round_trip(self):
        root = self.folder('Source')
        duplicate = self.folder('Source')
        child = self.folder('Nested', root)
        team = ClientTeam.objects.create(id=uuid.uuid4(), workspace=self.workspace, name='Acme', created_at=self.now, updated_at=self.now)
        ProjectFolder.objects.filter(id__in=[root.id, child.id]).update(client_team=team)
        from .models import FileStatus
        f = File.objects.create(id=uuid.uuid4(), workspace=self.workspace, original_name='a.txt', storage_backend=StorageBackend.objects.create(id=uuid.uuid4(), name='Test', provider='LOCAL', created_at=self.now, updated_at=self.now),
            object_key='not-read', mime_type='text/plain', size_bytes=1, status=FileStatus.READY, created_at=self.now, updated_at=self.now)
        item = ProjectFile.objects.create(id=uuid.uuid4(), workspace=self.workspace, file=f, folder=child,
            added_by_workspace_membership=self.owner_membership, client_team=team, created_at=self.now, updated_at=self.now)
        migration.forwards(apps, self.schema)
        project = Project.objects.get(workspace=self.workspace, is_unsorted=True)
        item.refresh_from_db(); root.refresh_from_db(); duplicate.refresh_from_db(); child.refresh_from_db()
        self.assertEqual(item.project_id, project.id)
        self.assertIsNone(item.client_team_id)
        self.assertEqual(child.parent_folder_id, root.id)
        self.assertNotEqual(root.name, duplicate.name)
        migration.backwards(apps, self.schema)
        item.refresh_from_db(); root.refresh_from_db(); duplicate.refresh_from_db(); child.refresh_from_db()
        self.assertIsNone(item.project_id)
        self.assertEqual(item.client_team_id, team.id)
        self.assertEqual(child.client_team_id, team.id)
        self.assertEqual(item.folder_id, child.id)
        self.assertEqual(child.parent_folder_id, root.id)
        self.assertEqual(root.name, duplicate.name)
        self.assertFalse(Project.objects.filter(id=project.id).exists())

    def test_generated_collision_name_is_also_checked(self):
        ids = [uuid.UUID(int=i) for i in (1, 2, 3)]
        names = ['Source', f'Source ({ids[2]})', 'Source']
        for fid, name in zip(ids, names):
            ProjectFolder.objects.create(id=fid, workspace=self.workspace, name=name,
                created_by_workspace_membership=self.owner_membership, created_at=self.now, updated_at=self.now)
        migration.forwards(apps, self.schema)
        self.assertEqual(len(set(ProjectFolder.objects.filter(id__in=ids).values_list('name', flat=True))), 3)
        migration.backwards(apps, self.schema)
        self.assertEqual(list(ProjectFolder.objects.filter(id__in=ids).order_by('id').values_list('name', flat=True)), names)

    def test_reverse_preserves_new_work(self):
        migration.forwards(apps, self.schema)
        project = Project.objects.get(workspace=self.workspace, is_unsorted=True)
        folder = self.folder('Created later')
        ProjectFolder.objects.filter(id=folder.id).update(project=project)
        migration.backwards(apps, self.schema)
        folder.refresh_from_db(); project.refresh_from_db()
        self.assertEqual(folder.project_id, project.id)
        self.assertFalse(project.is_unsorted)


class HistoricalUnsortedMigrationTests(WorkspaceAccessSetupMixin, TransactionTestCase):
    def test_actual_migration_executor_forward_reverse_and_reapply(self):
        from django.db.migrations.executor import MigrationExecutor
        before = [('app', '0066_option_b_scope_and_unsorted')]
        after = [('app', '0067_unsorted_projects')]
        executor = MigrationExecutor(connection)
        executor.migrate(before)
        try:
            executor = MigrationExecutor(connection)
            executor.migrate(after)
            state = executor.loader.project_state(after).apps
            HistoricalProject = state.get_model('app', 'Project')
            self.assertTrue(HistoricalProject.objects.filter(workspace_id=self.workspace.id, is_unsorted=True).exists())
            MigrationExecutor(connection).migrate(before)
            self.assertFalse(Project.objects.filter(workspace_id=self.workspace.id, is_unsorted=True).exists())
            MigrationExecutor(connection).migrate(after)
            self.assertEqual(Project.objects.filter(workspace_id=self.workspace.id, is_unsorted=True).count(), 1)
        finally:
            MigrationExecutor(connection).migrate(after)
