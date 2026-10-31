"""Uploads become review versions automatically (Frame.io model): no separate publish step."""
import importlib
import shutil
import tempfile

from django.apps import apps as django_apps
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse

from .models import AuditLog, File, MediaVersion, MediaVersionStageEntry, Project, ProjectFile
from .services.auto_version import ensure_review_version
from .services.project_files import add_file_as_version
from .test_access_projects import WorkspaceAccessSetupMixin
from .test_publish_to_project import _png

backfill_migration = importlib.import_module('app.migrations.0061_auto_version_project_files')


class AutoVersionTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='blazeflow-autoversion-tests-')
        self.settings_override = override_settings(MEDIA_ROOT=self.media_root, MAX_PROJECT_FILE_BYTES=1024 * 1024)
        self.settings_override.enable()
        super().setUp()
        self.client.force_authenticate(self.owner)
        response = self.client.post(reverse('api-projects', args=[self.workspace.id]), {'name': 'Spring Launch'}, format='json')
        self.project = Project.objects.get(id=response.json()['id'])

    def tearDown(self):
        self.settings_override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)

    def upload(self, name='hero.png', project=True, content=None, content_type='image/png'):
        data = {'file': SimpleUploadedFile(name, content or _png(), content_type=content_type)}
        if project:
            data['project_id'] = str(self.project.id)
        response = self.client.post(reverse('api-asset-files', args=[self.workspace.id]), data, format='multipart')
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def test_upload_into_a_project_is_a_review_version(self):
        item = self.upload()
        version = MediaVersion.objects.get(original_file_id=item['file']['id'])
        self.assertEqual(version.project_id, self.project.id)
        self.assertEqual(item['review_version_id'], str(version.id))
        self.assertTrue(MediaVersionStageEntry.objects.filter(media_version=version, exited_at__isnull=True).exists())
        self.assertTrue(AuditLog.objects.filter(action='media.auto_versioned', entity_id=version.id).exists())

    def test_upload_into_project_files_endpoint_is_a_review_version(self):
        response = self.client.post(
            reverse('api-project-files', args=[self.workspace.id, self.project.id]),
            {'file': SimpleUploadedFile('still.png', _png(), content_type='image/png')}, format='multipart',
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertTrue(MediaVersion.objects.filter(original_file_id=response.json()['file']['id']).exists())

    def test_unsorted_upload_stays_a_plain_file_until_moved_into_a_project(self):
        item = self.upload(project=False)
        self.assertIsNone(item['review_version_id'])
        self.assertFalse(MediaVersion.objects.filter(original_file_id=item['file']['id']).exists())
        moved = self.client.patch(
            reverse('api-asset-file-detail', args=[self.workspace.id, item['id']]), {'project_id': str(self.project.id)}, format='json',
        )
        self.assertEqual(moved.status_code, 200, moved.content)
        self.assertEqual(MediaVersion.objects.filter(original_file_id=item['file']['id'], project=self.project).count(), 1)

    def test_stacking_an_upload_onto_an_asset_makes_v2_with_its_own_review_version(self):
        first = self.upload('hero.png')
        second = self.upload('hero v2.png', project=False, content=_png('#222222'))
        response = self.client.post(
            reverse('api-asset-file-versions', args=[self.workspace.id, first['id']]), {'file_id': second['id']}, format='json',
        )
        self.assertIn(response.status_code, (200, 201), response.content)
        row = ProjectFile.objects.get(id=second['id'])
        self.assertEqual(row.version_number, 2)
        self.assertEqual(row.project_id, self.project.id)
        self.assertEqual(MediaVersion.objects.filter(original_file_id=row.file_id).count(), 1)

    def test_idempotent_and_never_duplicates(self):
        item = self.upload()
        row = ProjectFile.objects.get(id=item['id'])
        first = ensure_review_version(project_file=row)
        again = ensure_review_version(project_file=row)
        self.assertEqual(first.id, again.id)
        self.assertEqual(MediaVersion.objects.filter(original_file_id=row.file_id).count(), 1)

    def test_documents_are_not_review_versions(self):
        item = self.upload()
        row = ProjectFile.objects.get(id=item['id'])
        MediaVersionStageEntry.objects.filter(media_version__original_file_id=row.file_id).delete()  # test-only reset
        MediaVersion.objects.filter(original_file_id=row.file_id).delete()
        File.objects.filter(id=row.file_id).update(mime_type='application/zip')
        self.assertIsNone(ensure_review_version(project_file=row))

    def test_backfill_turns_unpublished_project_files_into_versions_and_leaves_unsorted_alone(self):
        in_project = self.upload('legacy.png')
        unsorted = self.upload('loose.png', project=False)
        # Simulate a pre-auto-version row: a project file with no media version.
        legacy = ProjectFile.objects.get(id=in_project['id'])
        MediaVersionStageEntry.objects.filter(media_version__original_file_id=legacy.file_id).delete()
        MediaVersion.objects.filter(original_file_id=legacy.file_id).delete()
        files_before = File.objects.count()
        rows_before = ProjectFile.objects.count()

        backfill_migration.backfill(django_apps, None)
        backfill_migration.backfill(django_apps, None)  # idempotent

        self.assertEqual(MediaVersion.objects.filter(original_file_id=legacy.file_id).count(), 1)
        self.assertFalse(MediaVersion.objects.filter(original_file_id=unsorted['file']['id']).exists())
        self.assertEqual(File.objects.count(), files_before)
        self.assertEqual(ProjectFile.objects.count(), rows_before)

    def test_publish_endpoint_still_works_for_unsorted_files(self):
        item = self.upload(project=False)
        File.objects.filter(id=item['file']['id']).update(status='READY')
        response = self.client.post(
            reverse('api-asset-file-publish', args=[self.workspace.id, item['id']]), {'project_id': str(self.project.id)}, format='json',
        )
        self.assertIn(response.status_code, (200, 201), response.content)
        self.assertEqual(MediaVersion.objects.filter(original_file_id=item['file']['id']).count(), 1)
