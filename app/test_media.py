import shutil
import tempfile
import hashlib
from pathlib import Path
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse

from .models import AuditLog, File, MediaVersion, MediaVersionStageEntry, Project, ProjectAccessMode, WorkflowStage
from .services import upload_media_version
from .test_access_projects import WorkspaceAccessSetupMixin


class MediaVersionApiTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='blazeflow-media-tests-')
        self.settings_override = override_settings(
            MEDIA_ROOT=self.media_root,
            MAX_MEDIA_UPLOAD_BYTES=1024 * 1024,
        )
        self.settings_override.enable()
        super().setUp()
        self.client.force_authenticate(self.owner)
        project_response = self.client.post(
            reverse('api-projects', args=[self.workspace.id]),
            {'name': 'Media Project'},
            format='json',
        )
        self.project = Project.objects.get(id=project_response.json()['id'])

    def tearDown(self):
        self.settings_override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)
        super().tearDown()

    def upload(self, name='frame.png', content=None, content_type='image/png', **data):
        if content is None:
            content = b'\xff\xd8\xff\xe0jpeg-data' if content_type == 'image/jpeg' else b'\x89PNG\r\n\x1a\npng-data'
        payload = {
            'file': SimpleUploadedFile(name, content, content_type=content_type),
            'title': data.pop('title', name),
            **data,
        }
        return self.client.post(
            reverse('api-media-versions', args=[self.workspace.id, self.project.id]),
            payload,
            format='multipart',
        )

    def test_upload_allocates_project_versions_and_initial_stage_history(self):
        first = self.upload(title='First version')
        second = self.upload(name='second.jpg', content_type='image/jpeg', title='Second version')

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertEqual(first.json()['version_number'], 1)
        self.assertEqual(second.json()['version_number'], 2)
        self.assertEqual(first.json()['current_stage']['slug'], 'queued')
        self.assertEqual(MediaVersion.objects.filter(project=self.project).count(), 2)
        self.assertEqual(MediaVersionStageEntry.objects.filter(exited_at__isnull=True).count(), 2)
        self.project.refresh_from_db()
        self.assertEqual(self.project.next_media_version_number, 3)
        self.assertTrue(all(Path(self.media_root).rglob('*.png')))

    def test_upload_rejects_unsupported_content_without_database_or_storage_rows(self):
        response = self.upload(name='notes.txt', content_type='text/plain', content=b'notes')

        self.assertEqual(response.status_code, 400)
        self.assertFalse(MediaVersion.objects.exists())
        self.assertFalse(File.objects.exists())
        self.assertEqual(list(Path(self.media_root).rglob('*.*')), [])

    def test_selected_member_needs_project_grant_before_media_upload(self):
        membership = self.invite_and_accept(project_access_mode=ProjectAccessMode.SELECTED)
        self.client.force_authenticate(self.member_user)
        denied = self.upload(title='Denied upload')
        self.assertEqual(denied.status_code, 403)

        self.client.force_authenticate(self.owner)
        grant = self.client.post(
            reverse('api-project-access', args=[self.workspace.id, self.project.id]),
            {'membership_id': str(membership.id)},
            format='json',
        )
        self.assertEqual(grant.status_code, 201)
        self.client.force_authenticate(self.member_user)
        allowed = self.upload(title='Allowed upload')
        self.assertEqual(allowed.status_code, 201)

    def test_database_failure_removes_stored_object_and_rolls_back_counter(self):
        upload = SimpleUploadedFile('rollback.png', b'\x89PNG\r\n\x1a\nrollback-image', content_type='image/png')
        with patch(
            'app.services.media.MediaVersion.objects.create',
            side_effect=RuntimeError('simulated database failure'),
        ):
            with self.assertRaises(RuntimeError):
                upload_media_version(
                    project=self.project,
                    user=self.owner,
                    upload=upload,
                    title='Rollback version',
                )

        self.project.refresh_from_db()
        self.assertEqual(self.project.next_media_version_number, 1)
        self.assertFalse(File.objects.exists())
        self.assertFalse(MediaVersion.objects.exists())
        self.assertEqual(list(Path(self.media_root).rglob('*.*')), [])

    def test_media_detail_is_workspace_and_project_scoped(self):
        response = self.upload(title='Scoped media')
        media_id = response.json()['id']
        outsider_model = type(self.owner)
        outsider = outsider_model.objects.create_user(
            email='media-outsider@example.com',
            password='a-secure-test-password',
            first_name='Media',
            last_name='Outsider',
        )
        self.client.force_authenticate(outsider)

        denied = self.client.get(
            reverse(
                'api-media-version-detail',
                args=[self.workspace.id, self.project.id, media_id],
            )
        )
        self.assertEqual(denied.status_code, 403)

    def test_upload_records_verified_mime_checksum_and_audit(self):
        content = b'\x89PNG\r\n\x1a\nverified-content'
        response = self.upload(content=content, title='Verified media')

        self.assertEqual(response.status_code, 201)
        file_record = File.objects.get()
        self.assertEqual(file_record.mime_type, 'image/png')
        self.assertEqual(file_record.checksum_algorithm, 'sha256')
        self.assertEqual(file_record.checksum, hashlib.sha256(content).hexdigest())
        self.assertTrue(AuditLog.objects.filter(action='media.uploaded').exists())

    def test_spoofed_content_type_is_rejected(self):
        response = self.upload(
            name='spoofed.png',
            content=b'not-really-an-image',
            content_type='image/png',
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(MediaVersion.objects.exists())

    def test_private_download_requires_flag_and_records_audit(self):
        disabled = self.upload(title='No download')
        disabled_url = reverse(
            'api-media-version-download',
            args=[self.workspace.id, self.project.id, disabled.json()['id']],
        )
        self.assertEqual(self.client.get(disabled_url).status_code, 403)

        enabled = self.upload(title='Downloadable', allow_download='true')
        enabled_url = reverse(
            'api-media-version-download',
            args=[self.workspace.id, self.project.id, enabled.json()['id']],
        )
        response = self.client.get(enabled_url)
        self.assertEqual(response.status_code, 200)
        body = b''.join(response.streaming_content)
        self.assertTrue(body.startswith(b'\x89PNG'))
        self.assertTrue(AuditLog.objects.filter(action='media.downloaded').exists())

    def test_workflow_transition_closes_current_entry_and_writes_history(self):
        uploaded = self.upload(title='Workflow media')
        media_id = uploaded.json()['id']
        target = WorkflowStage.objects.get(workspace=self.workspace, slug='in-review')
        workflow_url = reverse(
            'api-media-version-workflow',
            args=[self.workspace.id, self.project.id, media_id],
        )

        transitioned = self.client.post(
            workflow_url,
            {'workflow_stage_id': str(target.id)},
            format='json',
        )
        history = self.client.get(workflow_url)

        self.assertEqual(transitioned.status_code, 201)
        self.assertEqual(len(history.json()), 2)
        self.assertIsNotNone(history.json()[0]['exited_at'])
        self.assertIsNone(history.json()[1]['exited_at'])
        self.assertEqual(
            MediaVersionStageEntry.objects.filter(
                media_version_id=media_id,
                exited_at__isnull=True,
            ).count(),
            1,
        )
        self.assertTrue(AuditLog.objects.filter(action='media.workflow.transitioned').exists())

        duplicate = self.client.post(
            workflow_url,
            {'workflow_stage_id': str(target.id)},
            format='json',
        )
        self.assertEqual(duplicate.status_code, 400)

    def test_workspace_workflow_stages_are_discoverable_in_order(self):
        response = self.client.get(
            reverse('api-workflow-stages', args=[self.workspace.id])
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [stage['slug'] for stage in response.json()],
            ['queued', 'in-progress', 'in-review', 'revision', 'approval', 'approved'],
        )
        self.assertEqual(response.json()[0]['statuses'], [])
