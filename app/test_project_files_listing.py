"""A cut uploaded straight to a project ("Upload Asset") is listed in that project's Files."""
import importlib
import io
import shutil
import tempfile

from django.apps import apps as django_apps
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse
from PIL import Image

from .models import MediaVersion, ProjectFile
from .test_access_projects import WorkspaceAccessSetupMixin


def png():
    buffer = io.BytesIO()
    Image.new('RGB', (40, 30), (200, 40, 40)).save(buffer, format='PNG')
    return buffer.getvalue()


class UploadedCutsAreListedTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='blazeflow-files-listing-')
        self.override = override_settings(MEDIA_ROOT=self.media_root)
        self.override.enable()
        super().setUp()
        self.client.force_authenticate(self.owner)
        self.project_id = self.client.post(reverse('api-projects', args=[self.workspace.id]), {'name': 'Menu'}, format='json').json()['id']

    def tearDown(self):
        self.override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)
        super().tearDown()

    def upload(self, title='Summer sale poster'):
        response = self.client.post(
            reverse('api-media-versions', args=[self.workspace.id, self.project_id]),
            {'file': SimpleUploadedFile('poster.png', png(), content_type='image/png'), 'title': title}, format='multipart',
        )
        self.assertEqual(response.status_code, 201, response.content)
        return MediaVersion.objects.get(id=response.json()['id'])

    def project_files(self):
        response = self.client.get(reverse('api-project-files', args=[self.workspace.id, self.project_id]))
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        return body['results'] if isinstance(body, dict) else body

    def test_an_uploaded_cut_appears_in_the_project_files_tab(self):
        version = self.upload()
        row = ProjectFile.objects.get(file_id=version.original_file_id)
        self.assertEqual(str(row.project_id), self.project_id)
        self.assertIsNotNone(row.media_asset_id)
        self.assertEqual(row.version_number, 1)
        listed = self.project_files()
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]['id'], str(row.id))
        library = self.client.get(reverse('api-asset-files', args=[self.workspace.id])).json()
        self.assertTrue(any(item['id'] == str(row.id) for item in (library['results'] if isinstance(library, dict) else library)))

    def test_backfill_lists_older_cuts_once(self):
        version = self.upload()
        ProjectFile.objects.filter(file_id=version.original_file_id).delete()  # as uploads were before the fix
        self.assertEqual(self.project_files(), [])
        migration = importlib.import_module('app.migrations.0044_project_files_for_uploaded_cuts')
        migration.backfill(django_apps, None)
        migration.backfill(django_apps, None)  # idempotent
        self.assertEqual(ProjectFile.objects.filter(file_id=version.original_file_id).count(), 1)
        self.assertEqual(len(self.project_files()), 1)

    def test_a_new_version_of_a_cut_joins_its_asset(self):
        first, second, other = self.upload('Hero 30s'), self.upload('Hero 30s v2'), self.upload('Teaser')
        rows = {r.file_id: r for r in ProjectFile.objects.all()}
        a, b, c = rows[first.original_file_id], rows[second.original_file_id], rows[other.original_file_id]
        self.assertEqual(a.media_asset_id, b.media_asset_id)
        self.assertEqual((a.version_number, b.version_number), (1, 2))
        self.assertNotEqual(c.media_asset_id, a.media_asset_id)
        ProjectFile.objects.all().delete()
        importlib.import_module('app.migrations.0044_project_files_for_uploaded_cuts').backfill(django_apps, None)
        rows = {r.file_id: r for r in ProjectFile.objects.all()}
        self.assertEqual(rows[first.original_file_id].media_asset_id, rows[second.original_file_id].media_asset_id)
        self.assertEqual(rows[second.original_file_id].version_number, 2)
