import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse

from .models import File, Project, ProjectAccessMode, ProjectFile, ProjectFolder, TaskStage, Workspace
from .test_access_projects import WorkspaceAccessSetupMixin


PNG_BYTES = b'\x89PNG\r\n\x1a\n' + b'\x00' * 32


class ProjectFolderApiTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.owner)
        project_response = self.client.post(
            reverse('api-projects', args=[self.workspace.id]),
            {'name': 'Assets Project'},
            format='json',
        )
        self.project = Project.objects.get(id=project_response.json()['id'])

    def test_owner_can_create_list_and_read_root_folder(self):
        response = self.client.post(
            reverse('api-project-folders', args=[self.workspace.id, self.project.id]),
            {'name': 'References'},
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        folder = ProjectFolder.objects.get(id=response.json()['id'])
        self.assertIsNone(folder.parent_folder_id)

        listed = self.client.get(
            reverse('api-project-folders', args=[self.workspace.id, self.project.id])
        )
        self.assertEqual(len(listed.json()), 1)

    def test_nested_folder_can_be_created(self):
        root = self.client.post(
            reverse('api-project-folders', args=[self.workspace.id, self.project.id]),
            {'name': 'References'},
            format='json',
        ).json()

        nested = self.client.post(
            reverse('api-project-folders', args=[self.workspace.id, self.project.id]),
            {'name': 'Client Logos', 'parent_folder_id': root['id']},
            format='json',
        )

        self.assertEqual(nested.status_code, 201)
        self.assertEqual(nested.json()['parent_folder_id'], root['id'])

    def test_duplicate_root_folder_name_is_rejected(self):
        self.client.post(
            reverse('api-project-folders', args=[self.workspace.id, self.project.id]),
            {'name': 'References'},
            format='json',
        )

        response = self.client.post(
            reverse('api-project-folders', args=[self.workspace.id, self.project.id]),
            {'name': 'References'},
            format='json',
        )

        self.assertEqual(response.status_code, 400)

    def test_duplicate_sibling_folder_name_is_rejected(self):
        root = self.client.post(
            reverse('api-project-folders', args=[self.workspace.id, self.project.id]),
            {'name': 'References'},
            format='json',
        ).json()
        self.client.post(
            reverse('api-project-folders', args=[self.workspace.id, self.project.id]),
            {'name': 'Logos', 'parent_folder_id': root['id']},
            format='json',
        )

        response = self.client.post(
            reverse('api-project-folders', args=[self.workspace.id, self.project.id]),
            {'name': 'Logos', 'parent_folder_id': root['id']},
            format='json',
        )

        self.assertEqual(response.status_code, 400)

    def test_same_name_allowed_in_different_parents(self):
        root_a = self.client.post(
            reverse('api-project-folders', args=[self.workspace.id, self.project.id]),
            {'name': 'Campaign A'},
            format='json',
        ).json()
        root_b = self.client.post(
            reverse('api-project-folders', args=[self.workspace.id, self.project.id]),
            {'name': 'Campaign B'},
            format='json',
        ).json()

        first = self.client.post(
            reverse('api-project-folders', args=[self.workspace.id, self.project.id]),
            {'name': 'Assets', 'parent_folder_id': root_a['id']},
            format='json',
        )
        second = self.client.post(
            reverse('api-project-folders', args=[self.workspace.id, self.project.id]),
            {'name': 'Assets', 'parent_folder_id': root_b['id']},
            format='json',
        )

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)

    def test_owner_can_rename_folder(self):
        folder = self.client.post(
            reverse('api-project-folders', args=[self.workspace.id, self.project.id]),
            {'name': 'Old Name'},
            format='json',
        ).json()

        response = self.client.patch(
            reverse('api-project-folder-detail', args=[self.workspace.id, self.project.id, folder['id']]),
            {'name': 'New Name'},
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['name'], 'New Name')

    def test_deleting_folder_cascades_to_descendants_and_files(self):
        root = self.client.post(
            reverse('api-project-folders', args=[self.workspace.id, self.project.id]),
            {'name': 'Root'},
            format='json',
        ).json()
        child = self.client.post(
            reverse('api-project-folders', args=[self.workspace.id, self.project.id]),
            {'name': 'Child', 'parent_folder_id': root['id']},
            format='json',
        ).json()
        upload = self.client.post(
            reverse('api-project-files', args=[self.workspace.id, self.project.id]),
            {'file': SimpleUploadedFile('root-file.png', PNG_BYTES, content_type='image/png'), 'folder_id': root['id']},
            format='multipart',
        ).json()

        response = self.client.delete(
            reverse('api-project-folder-detail', args=[self.workspace.id, self.project.id, root['id']])
        )

        self.assertEqual(response.status_code, 204)
        self.assertIsNotNone(ProjectFolder.objects.get(id=root['id']).deleted_at)
        self.assertIsNotNone(ProjectFolder.objects.get(id=child['id']).deleted_at)
        deleted_project_file = ProjectFile.objects.get(id=upload['id'])
        self.assertIsNotNone(deleted_project_file.deleted_at)
        self.assertIsNotNone(File.objects.get(id=deleted_project_file.file_id).deleted_at)

        listed_folders = self.client.get(
            reverse('api-project-folders', args=[self.workspace.id, self.project.id])
        )
        self.assertEqual(listed_folders.json(), [])

    def test_deleting_an_already_deleted_folder_is_not_found(self):
        folder = self.client.post(
            reverse('api-project-folders', args=[self.workspace.id, self.project.id]),
            {'name': 'Temp'},
            format='json',
        ).json()
        self.client.delete(
            reverse('api-project-folder-detail', args=[self.workspace.id, self.project.id, folder['id']])
        )

        response = self.client.delete(
            reverse('api-project-folder-detail', args=[self.workspace.id, self.project.id, folder['id']])
        )

        self.assertEqual(response.status_code, 404)

    def test_member_without_project_access_is_denied(self):
        self.invite_and_accept(project_access_mode=ProjectAccessMode.SELECTED)
        self.client.force_authenticate(self.member_user)

        response = self.client.get(
            reverse('api-project-folders', args=[self.workspace.id, self.project.id])
        )

        self.assertEqual(response.status_code, 403)


class ProjectFileApiTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='blazeflow-project-file-tests-')
        self.settings_override = override_settings(
            MEDIA_ROOT=self.media_root,
            MAX_PROJECT_FILE_BYTES=1024 * 1024,
        )
        self.settings_override.enable()
        super().setUp()
        self.client.force_authenticate(self.owner)
        project_response = self.client.post(
            reverse('api-projects', args=[self.workspace.id]),
            {'name': 'Assets Project'},
            format='json',
        )
        self.project = Project.objects.get(id=project_response.json()['id'])

    def tearDown(self):
        self.settings_override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)

    def _png_upload(self, name='reference.png'):
        return SimpleUploadedFile(name, PNG_BYTES, content_type='image/png')

    def test_owner_can_upload_list_and_delete_a_root_file(self):
        response = self.client.post(
            reverse('api-project-files', args=[self.workspace.id, self.project.id]),
            {'file': self._png_upload()},
            format='multipart',
        )

        self.assertEqual(response.status_code, 201)
        file_id = response.json()['id']
        self.assertIsNone(response.json()['folder_id'])
        self.assertEqual(response.json()['file']['name'], 'reference.png')

        listed = self.client.get(
            reverse('api-project-files', args=[self.workspace.id, self.project.id])
        )
        self.assertEqual(len(listed.json()), 1)

        removed = self.client.delete(
            reverse('api-project-file-detail', args=[self.workspace.id, self.project.id, file_id])
        )
        self.assertEqual(removed.status_code, 204)
        deleted_project_file = ProjectFile.objects.get(id=file_id)
        self.assertIsNotNone(deleted_project_file.deleted_at)
        self.assertIsNotNone(File.objects.get(id=deleted_project_file.file_id).deleted_at)

    def test_file_can_be_placed_in_a_folder(self):
        folder = self.client.post(
            reverse('api-project-folders', args=[self.workspace.id, self.project.id]),
            {'name': 'References'},
            format='json',
        ).json()

        response = self.client.post(
            reverse('api-project-files', args=[self.workspace.id, self.project.id]),
            {'file': self._png_upload(), 'folder_id': folder['id']},
            format='multipart',
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['folder_id'], folder['id'])

    def test_spoofed_file_is_rejected(self):
        upload = SimpleUploadedFile('fake.png', b'not-really-a-png', content_type='image/png')

        response = self.client.post(
            reverse('api-project-files', args=[self.workspace.id, self.project.id]),
            {'file': upload},
            format='multipart',
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(ProjectFile.objects.exists())

    def test_deleted_file_is_not_found(self):
        created = self.client.post(
            reverse('api-project-files', args=[self.workspace.id, self.project.id]),
            {'file': self._png_upload()},
            format='multipart',
        ).json()
        self.client.delete(
            reverse('api-project-file-detail', args=[self.workspace.id, self.project.id, created['id']])
        )

        response = self.client.get(
            reverse('api-project-file-detail', args=[self.workspace.id, self.project.id, created['id']])
        )

        self.assertEqual(response.status_code, 404)

    def test_ready_file_can_be_downloaded(self):
        created = self.client.post(
            reverse('api-project-files', args=[self.workspace.id, self.project.id]),
            {'file': self._png_upload()}, format='multipart',
        ).json()
        project_file = ProjectFile.objects.select_related('file').get(id=created['id'])
        project_file.file.status = 'READY'
        project_file.file.save(update_fields=['status'])

        response = self.client.get(
            reverse('api-project-file-download', args=[self.workspace.id, self.project.id, created['id']])
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(b''.join(response.streaming_content), PNG_BYTES)
        self.assertIn('attachment;', response['Content-Disposition'])

    def test_pending_file_download_is_rejected(self):
        created = self.client.post(
            reverse('api-project-files', args=[self.workspace.id, self.project.id]),
            {'file': self._png_upload()}, format='multipart',
        ).json()

        response = self.client.get(
            reverse('api-project-file-download', args=[self.workspace.id, self.project.id, created['id']])
        )

        self.assertEqual(response.status_code, 409)

    def test_member_cannot_delete_without_access(self):
        created = self.client.post(
            reverse('api-project-files', args=[self.workspace.id, self.project.id]),
            {'file': self._png_upload()},
            format='multipart',
        ).json()
        self.invite_and_accept(project_access_mode=ProjectAccessMode.SELECTED)
        self.client.force_authenticate(self.member_user)

        response = self.client.delete(
            reverse('api-project-file-detail', args=[self.workspace.id, self.project.id, created['id']])
        )

        self.assertEqual(response.status_code, 403)


class WorkspaceAssetApiTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='blazeflow-asset-library-tests-')
        self.settings_override = override_settings(MEDIA_ROOT=self.media_root, MAX_PROJECT_FILE_BYTES=1024 * 1024)
        self.settings_override.enable()
        super().setUp()
        self.client.force_authenticate(self.owner)
        self.project = Project.objects.get(id=self.client.post(
            reverse('api-projects', args=[self.workspace.id]), {'name': 'Shared Assets'}, format='json',
        ).json()['id'])

    def tearDown(self):
        self.settings_override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)

    def test_files_and_folders_can_exist_without_a_project(self):
        folder = self.client.post(
            reverse('api-asset-folders', args=[self.workspace.id]), {'name': 'General'}, format='json',
        )
        upload = self.client.post(
            reverse('api-asset-files', args=[self.workspace.id]),
            {'file': SimpleUploadedFile('standalone.png', PNG_BYTES, content_type='image/png')}, format='multipart',
        )

        self.assertEqual(folder.status_code, 201)
        self.assertIsNone(folder.json()['project_id'])
        self.assertIsNone(folder.json()['client_team_id'])
        self.assertEqual(upload.status_code, 201)
        self.assertIsNone(upload.json()['folder_id'])
        self.assertIsNone(upload.json()['project_id'])

    def test_project_view_returns_the_same_workspace_asset_records(self):
        folder = self.client.post(
            reverse('api-asset-folders', args=[self.workspace.id]),
            {'name': 'Footage', 'project_id': str(self.project.id)}, format='json',
        ).json()
        upload = self.client.post(
            reverse('api-asset-files', args=[self.workspace.id]),
            {'file': SimpleUploadedFile('take.png', PNG_BYTES, content_type='image/png'), 'project_id': str(self.project.id), 'folder_id': folder['id']},
            format='multipart',
        ).json()

        project_folders = self.client.get(reverse('api-project-folders', args=[self.workspace.id, self.project.id])).json()
        project_files = self.client.get(reverse('api-project-files', args=[self.workspace.id, self.project.id])).json()
        self.assertEqual(project_folders[0]['id'], folder['id'])
        self.assertEqual(project_files[0]['id'], upload['id'])

    def test_asset_can_be_assigned_to_and_removed_from_a_project(self):
        folder = self.client.post(
            reverse('api-asset-folders', args=[self.workspace.id]), {'name': 'Movable'}, format='json',
        ).json()
        assigned = self.client.patch(
            reverse('api-asset-folder-detail', args=[self.workspace.id, folder['id']]),
            {'project_id': str(self.project.id)}, format='json',
        )
        unassigned = self.client.patch(
            reverse('api-asset-folder-detail', args=[self.workspace.id, folder['id']]),
            {'project_id': None, 'client_team_id': None}, format='json',
        )

        self.assertEqual(assigned.status_code, 200)
        self.assertEqual(assigned.json()['project_id'], str(self.project.id))
        self.assertEqual(unassigned.status_code, 200)
        self.assertIsNone(unassigned.json()['project_id'])

    def _stage(self, name):
        stages = self.client.get(reverse('api-task-stages', args=[self.workspace.id])).json()
        rows = stages['stages'] if isinstance(stages, dict) else stages
        return next(row for row in rows if row['name'] == name)

    def test_upload_links_a_file_to_a_client_project_and_stage(self):
        stage = self._stage('Internal QA')
        upload = self.client.post(
            reverse('api-asset-files', args=[self.workspace.id]),
            {
                'file': SimpleUploadedFile('promo.png', PNG_BYTES, content_type='image/png'),
                'project_id': str(self.project.id),
                'task_stage_id': stage['id'],
            },
            format='multipart',
        )

        self.assertEqual(upload.status_code, 201)
        self.assertEqual(upload.json()['project_id'], str(self.project.id))
        self.assertEqual(upload.json()['task_stage_id'], stage['id'])

    def test_upload_without_a_stage_has_none(self):
        upload = self.client.post(
            reverse('api-asset-files', args=[self.workspace.id]),
            {'file': SimpleUploadedFile('rough.png', PNG_BYTES, content_type='image/png')}, format='multipart',
        )

        self.assertEqual(upload.status_code, 201)
        self.assertIsNone(upload.json()['task_stage_id'])

    def test_stage_can_be_changed_and_cleared_without_disturbing_relationships(self):
        upload = self.client.post(
            reverse('api-asset-files', args=[self.workspace.id]),
            {'file': SimpleUploadedFile('cut.png', PNG_BYTES, content_type='image/png'), 'project_id': str(self.project.id)},
            format='multipart',
        ).json()
        stage = self._stage('Approved')

        moved = self.client.patch(
            reverse('api-asset-file-detail', args=[self.workspace.id, upload['id']]),
            {'task_stage_id': stage['id']}, format='json',
        )
        cleared = self.client.patch(
            reverse('api-asset-file-detail', args=[self.workspace.id, upload['id']]),
            {'task_stage_id': None}, format='json',
        )

        self.assertEqual(moved.status_code, 200)
        self.assertEqual(moved.json()['task_stage_id'], stage['id'])
        self.assertEqual(moved.json()['project_id'], str(self.project.id))
        self.assertEqual(cleared.status_code, 200)
        self.assertIsNone(cleared.json()['task_stage_id'])
        self.assertEqual(cleared.json()['project_id'], str(self.project.id))

    def test_a_stage_from_another_workspace_is_rejected(self):
        import uuid
        from django.utils import timezone
        now = timezone.now()
        other_workspace = Workspace.objects.create(
            id=uuid.uuid4(), name='Other Studio', slug='other-studio', timezone='UTC',
            created_by_user=self.workspace.created_by_user, created_at=now, updated_at=now,
        )
        foreign_stage = TaskStage.objects.create(workspace=other_workspace, name='Elsewhere')

        response = self.client.post(
            reverse('api-asset-files', args=[self.workspace.id]),
            {'file': SimpleUploadedFile('bad.png', PNG_BYTES, content_type='image/png'), 'task_stage_id': str(foreign_stage.id)},
            format='multipart',
        )

        self.assertEqual(response.status_code, 404)

    def test_file_can_be_assigned_to_a_client_without_a_project(self):
        upload = self.client.post(
            reverse('api-asset-files', args=[self.workspace.id]),
            {'file': SimpleUploadedFile('loose.png', PNG_BYTES, content_type='image/png')}, format='multipart',
        ).json()
        team = self.client.post(
            reverse('api-client-teams', args=[self.workspace.id]), {'name': 'Shamim'}, format='json',
        ).json()

        assigned = self.client.patch(
            reverse('api-asset-file-detail', args=[self.workspace.id, upload['id']]),
            {'client_team_id': team['id'], 'project_id': None, 'folder_id': None}, format='json',
        )

        self.assertEqual(assigned.status_code, 200)
        self.assertEqual(assigned.json()['client_team_id'], team['id'])
        self.assertIsNone(assigned.json()['project_id'])

        listed = self.client.get(reverse('api-asset-files', args=[self.workspace.id])).json()
        self.assertEqual(listed[0]['client_team_id'], team['id'])

    def test_folder_can_be_assigned_to_a_client_without_a_project(self):
        folder = self.client.post(
            reverse('api-asset-folders', args=[self.workspace.id]), {'name': 'Sound Effects'}, format='json',
        ).json()
        team = self.client.post(
            reverse('api-client-teams', args=[self.workspace.id]), {'name': 'Shamim'}, format='json',
        ).json()

        assigned = self.client.patch(
            reverse('api-asset-folder-detail', args=[self.workspace.id, folder['id']]),
            {'client_team_id': team['id'], 'project_id': None, 'parent_folder_id': None}, format='json',
        )

        self.assertEqual(assigned.status_code, 200)
        self.assertEqual(assigned.json()['client_team_id'], team['id'])

        listed = self.client.get(reverse('api-asset-folders', args=[self.workspace.id])).json()
        self.assertEqual(listed[0]['client_team_id'], team['id'])
