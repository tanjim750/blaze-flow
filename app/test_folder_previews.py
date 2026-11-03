"""Folder cards' ``preview_thumbnails``: what a folder holds, at a glance, in one query."""
import io
import shutil
import tempfile
from datetime import timedelta

from PIL import Image
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone

from .models import Project, ProjectAccessMode, ProjectFile, ProjectFolder
from .services.outbox import process_outbox_events
from .test_access_projects import WorkspaceAccessSetupMixin


class FolderPreviewThumbnailTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='blazeflow-folder-previews-')
        self.settings_override = override_settings(MEDIA_ROOT=self.media_root, MAX_PROJECT_FILE_BYTES=1024 * 1024)
        self.settings_override.enable()
        super().setUp()
        self.client.force_authenticate(self.owner)
        self.base_time = timezone.now() - timedelta(days=1)
        self.tick = 0

    def tearDown(self):
        self.settings_override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)

    def folder(self, name, parent=None):
        payload = {'name': name}
        if parent:
            payload['parent_folder_id'] = parent
        response = self.client.post(reverse('api-asset-folders', args=[self.workspace.id]), payload, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()['id']

    def image(self, name, folder_id, *, process=True):
        buffer = io.BytesIO()
        Image.new('RGB', (48, 32), '#583be8').save(buffer, format='PNG')
        response = self.client.post(
            reverse('api-asset-files', args=[self.workspace.id]),
            {'file': SimpleUploadedFile(name, buffer.getvalue(), content_type='image/png'), 'folder_id': folder_id},
            format='multipart',
        )
        self.assertEqual(response.status_code, 201, response.content)
        asset_id = response.json()['id']
        # Distinct, increasing timestamps so "most recent" is deterministic.
        self.tick += 1
        ProjectFile.objects.filter(id=asset_id).update(created_at=self.base_time + timedelta(minutes=self.tick))
        if process:
            process_outbox_events()
            process_outbox_events()
        return asset_id

    def poster(self, asset_id):
        return reverse('api-asset-file-poster', args=[self.workspace.id, asset_id])

    def listed(self):
        response = self.client.get(reverse('api-asset-folders', args=[self.workspace.id]))
        self.assertEqual(response.status_code, 200)
        return {row['id']: row['preview_thumbnails'] for row in response.json()}

    def test_newest_three_direct_files_then_subfolders_and_empty_folders(self):
        footage = self.folder('Footage')
        ids = [self.image(f'shot-{n}.png', footage) for n in range(4)]
        nest = self.folder('Only subfolders')
        child = self.folder('Child', nest)
        grandchild = self.folder('Grandchild', child)
        deep = self.image('deep.png', grandchild)
        near = self.image('near.png', child)
        empty = self.folder('Empty')
        mixed = self.folder('Mixed')
        mixed_child = self.folder('Mixed child', mixed)
        nested_newer = self.image('nested-newer.png', mixed_child)
        own_older = self.image('own.png', mixed)
        ProjectFile.objects.filter(id=own_older).update(created_at=self.base_time)
        pending = self.folder('Still processing')
        self.image('pending.png', pending, process=False)

        previews = self.listed()
        self.assertEqual(previews[footage], [self.poster(i) for i in reversed(ids[1:])])
        self.assertEqual(previews[nest], [self.poster(near), self.poster(deep)])
        self.assertEqual(previews[empty], [])
        # Files directly in the folder come first even when a subfolder holds newer ones.
        self.assertEqual(previews[mixed], [self.poster(own_older), self.poster(nested_newer)])
        # No ready still yet: the card keeps its folder glyph.
        self.assertEqual(previews[pending], [])
        # Every URL is the same permission-checked route a file card uses, and it serves.
        self.assertEqual(self.client.get(previews[footage][0]).status_code, 200)

    def test_query_count_does_not_grow_with_folders(self):
        def count():
            with CaptureQueriesContext(connection) as ctx:
                self.listed()
            return len(ctx.captured_queries)

        first = self.folder('One')
        self.image('a.png', first)
        baseline = count()
        for n in range(6):
            folder = self.folder(f'More {n}', first if n % 2 else None)
            self.image(f'more-{n}.png', folder)
        self.assertEqual(count(), baseline)

    def test_previews_only_show_files_the_reader_can_open(self):
        restricted = Project.objects.get(id=self.client.post(
            reverse('api-projects', args=[self.workspace.id]), {'name': 'Secret'}, format='json',
        ).json()['id'])
        shared = self.folder('Shared root')
        hidden = self.image('secret.png', shared)
        visible = self.image('public.png', shared)
        ProjectFile.objects.filter(id=hidden).update(project=restricted)
        self.assertEqual(self.listed()[shared], [self.poster(visible), self.poster(hidden)])

        self.invite_and_accept(project_access_mode=ProjectAccessMode.SELECTED)
        self.client.force_authenticate(self.member_user)
        self.assertEqual(self.listed()[shared], [self.poster(visible)])

    def test_project_folder_list_carries_previews(self):
        project = Project.objects.get(id=self.client.post(
            reverse('api-projects', args=[self.workspace.id]), {'name': 'Campaign'}, format='json',
        ).json()['id'])
        folder = ProjectFolder.objects.get(id=self.folder('Edits'))
        asset = self.image('cut.png', str(folder.id))
        ProjectFolder.objects.filter(id=folder.id).update(project=project)
        ProjectFile.objects.filter(id=asset).update(project=project)
        response = self.client.get(reverse('api-project-folders', args=[self.workspace.id, project.id]))
        self.assertEqual(response.status_code, 200, response.content)
        row = next(item for item in response.json() if item['id'] == str(folder.id))
        self.assertEqual(row['preview_thumbnails'], [self.poster(asset)])
