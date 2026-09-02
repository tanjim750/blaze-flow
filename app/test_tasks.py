import io
import shutil
import tempfile
import zipfile

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse

from .models import (
    ProjectAccessMode,
    Task,
    TaskAssignee,
    TaskAttachment,
    TaskStatus,
)
from .test_access_projects import WorkspaceAccessSetupMixin


PNG_BYTES = b'\x89PNG\r\n\x1a\n' + b'\x00' * 32


class WorkspaceTaskApiTests(WorkspaceAccessSetupMixin, TestCase):
    def test_owner_can_create_and_read_workspace_level_task(self):
        self.client.force_authenticate(self.owner)

        response = self.client.post(
            reverse('api-tasks', args=[self.workspace.id]),
            {'title': 'Draft the brief', 'priority': 'HIGH'},
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        task = Task.objects.get(id=response.json()['id'])
        self.assertIsNone(task.project_id)
        self.assertEqual(task.created_by_workspace_membership, self.owner_membership)
        self.assertEqual(task.status, TaskStatus.TODO)

    def test_member_can_create_read_and_update_but_not_delete_workspace_task(self):
        self.invite_and_accept()
        self.client.force_authenticate(self.owner)
        created = self.client.post(
            reverse('api-tasks', args=[self.workspace.id]),
            {'title': 'Owner task'},
            format='json',
        )
        task_id = created.json()['id']

        self.client.force_authenticate(self.member_user)
        own_create = self.client.post(
            reverse('api-tasks', args=[self.workspace.id]),
            {'title': 'Member task'},
            format='json',
        )
        read = self.client.get(reverse('api-task-detail', args=[self.workspace.id, task_id]))
        updated = self.client.patch(
            reverse('api-task-detail', args=[self.workspace.id, task_id]),
            {'title': 'Updated title'},
            format='json',
        )
        deleted = self.client.delete(reverse('api-task-detail', args=[self.workspace.id, task_id]))

        self.assertEqual(own_create.status_code, 201)
        self.assertEqual(read.status_code, 200)
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(deleted.status_code, 403)

    def test_owner_can_delete_task(self):
        self.client.force_authenticate(self.owner)
        created = self.client.post(
            reverse('api-tasks', args=[self.workspace.id]),
            {'title': 'Disposable task'},
            format='json',
        )
        task_id = created.json()['id']

        response = self.client.delete(reverse('api-task-detail', args=[self.workspace.id, task_id]))

        self.assertEqual(response.status_code, 204)
        task = Task.objects.get(id=task_id)
        self.assertIsNotNone(task.deleted_at)

    def test_deleted_task_is_not_found(self):
        self.client.force_authenticate(self.owner)
        created = self.client.post(
            reverse('api-tasks', args=[self.workspace.id]),
            {'title': 'Disposable task'},
            format='json',
        )
        task_id = created.json()['id']
        self.client.delete(reverse('api-task-detail', args=[self.workspace.id, task_id]))

        response = self.client.get(reverse('api-task-detail', args=[self.workspace.id, task_id]))
        listed = self.client.get(reverse('api-tasks', args=[self.workspace.id]))

        self.assertEqual(response.status_code, 404)
        self.assertEqual(listed.json(), [])

    def test_outsider_cannot_read_or_create_tasks(self):
        self.client.force_authenticate(self.owner)
        created = self.client.post(
            reverse('api-tasks', args=[self.workspace.id]),
            {'title': 'Private task'},
            format='json',
        )
        task_id = created.json()['id']

        outsider = self._make_user('task-outsider@example.com')
        self.client.force_authenticate(outsider)

        list_response = self.client.get(reverse('api-tasks', args=[self.workspace.id]))
        detail_response = self.client.get(reverse('api-task-detail', args=[self.workspace.id, task_id]))
        create_response = self.client.post(
            reverse('api-tasks', args=[self.workspace.id]),
            {'title': 'Should fail'},
            format='json',
        )

        self.assertEqual(list_response.status_code, 403)
        self.assertEqual(detail_response.status_code, 403)
        self.assertEqual(create_response.status_code, 403)

    def test_completing_a_task_sets_completed_at_and_reopening_clears_it(self):
        self.client.force_authenticate(self.owner)
        created = self.client.post(
            reverse('api-tasks', args=[self.workspace.id]),
            {'title': 'Finish edit'},
            format='json',
        )
        task_id = created.json()['id']

        completed = self.client.patch(
            reverse('api-task-detail', args=[self.workspace.id, task_id]),
            {'status': TaskStatus.COMPLETED},
            format='json',
        )
        self.assertIsNotNone(completed.json()['completed_at'])

        reopened = self.client.patch(
            reverse('api-task-detail', args=[self.workspace.id, task_id]),
            {'status': TaskStatus.TODO},
            format='json',
        )
        self.assertIsNone(reopened.json()['completed_at'])

    def test_due_before_start_is_rejected(self):
        self.client.force_authenticate(self.owner)

        response = self.client.post(
            reverse('api-tasks', args=[self.workspace.id]),
            {'title': 'Bad dates', 'start_at': '2026-02-01T00:00:00Z', 'due_at': '2026-01-01T00:00:00Z'},
            format='json',
        )

        self.assertEqual(response.status_code, 400)

    def _make_user(self, email):
        return get_user_model().objects.create_user(
            email=email, password='a-secure-test-password', first_name='Out', last_name='Sider',
        )


class ProjectTaskScopeApiTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.membership = self.invite_and_accept(project_access_mode=ProjectAccessMode.SELECTED)
        self.client.force_authenticate(self.owner)
        project_response = self.client.post(
            reverse('api-projects', args=[self.workspace.id]),
            {'name': 'Scoped Project'},
            format='json',
        )
        self.project = project_response.json()
        other_project_response = self.client.post(
            reverse('api-projects', args=[self.workspace.id]),
            {'name': 'Other Project'},
            format='json',
        )
        self.other_project = other_project_response.json()

    def test_project_scoped_task_requires_project_access(self):
        created = self.client.post(
            reverse('api-tasks', args=[self.workspace.id]),
            {'title': 'Scoped task', 'project_id': self.project['id']},
            format='json',
        )
        self.assertEqual(created.status_code, 201)
        task_id = created.json()['id']

        self.client.force_authenticate(self.member_user)
        denied = self.client.get(reverse('api-task-detail', args=[self.workspace.id, task_id]))
        self.assertEqual(denied.status_code, 403)

        self.client.force_authenticate(self.owner)
        self.client.post(
            reverse('api-project-access', args=[self.workspace.id, self.project['id']]),
            {'membership_id': str(self.membership.id)},
            format='json',
        )

        self.client.force_authenticate(self.member_user)
        allowed = self.client.get(reverse('api-task-detail', args=[self.workspace.id, task_id]))
        self.assertEqual(allowed.status_code, 200)

    def test_list_only_returns_workspace_tasks_and_accessible_project_tasks(self):
        self.client.post(
            reverse('api-tasks', args=[self.workspace.id]),
            {'title': 'Workspace task'},
            format='json',
        )
        self.client.post(
            reverse('api-tasks', args=[self.workspace.id]),
            {'title': 'Granted project task', 'project_id': self.project['id']},
            format='json',
        )
        self.client.post(
            reverse('api-tasks', args=[self.workspace.id]),
            {'title': 'Ungranted project task', 'project_id': self.other_project['id']},
            format='json',
        )
        self.client.post(
            reverse('api-project-access', args=[self.workspace.id, self.project['id']]),
            {'membership_id': str(self.membership.id)},
            format='json',
        )

        self.client.force_authenticate(self.member_user)
        response = self.client.get(reverse('api-tasks', args=[self.workspace.id]))

        titles = {item['title'] for item in response.json()}
        self.assertEqual(titles, {'Workspace task', 'Granted project task'})

    def test_creating_task_in_ungranted_project_is_rejected(self):
        self.client.force_authenticate(self.member_user)

        response = self.client.post(
            reverse('api-tasks', args=[self.workspace.id]),
            {'title': 'Should fail', 'project_id': self.other_project['id']},
            format='json',
        )

        self.assertEqual(response.status_code, 403)
        self.assertFalse(Task.objects.filter(title='Should fail').exists())


class TaskAssigneeApiTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.member_membership = self.invite_and_accept()
        self.client.force_authenticate(self.owner)
        created = self.client.post(
            reverse('api-tasks', args=[self.workspace.id]),
            {'title': 'Assignable task'},
            format='json',
        )
        self.task_id = created.json()['id']

    def test_owner_can_assign_and_unassign_a_member(self):
        response = self.client.post(
            reverse('api-task-assignees', args=[self.workspace.id, self.task_id]),
            {'membership_id': str(self.member_membership.id)},
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        assignee_id = response.json()['id']
        self.assertTrue(TaskAssignee.objects.filter(id=assignee_id).exists())

        listed = self.client.get(
            reverse('api-task-assignees', args=[self.workspace.id, self.task_id])
        )
        self.assertEqual(len(listed.json()), 1)

        removed = self.client.delete(
            reverse('api-task-assignee-detail', args=[self.workspace.id, self.task_id, assignee_id])
        )
        self.assertEqual(removed.status_code, 204)
        self.assertFalse(TaskAssignee.objects.filter(id=assignee_id).exists())

    def test_assigning_the_same_membership_twice_is_rejected(self):
        self.client.post(
            reverse('api-task-assignees', args=[self.workspace.id, self.task_id]),
            {'membership_id': str(self.member_membership.id)},
            format='json',
        )

        response = self.client.post(
            reverse('api-task-assignees', args=[self.workspace.id, self.task_id]),
            {'membership_id': str(self.member_membership.id)},
            format='json',
        )

        self.assertEqual(response.status_code, 400)


class TaskAttachmentApiTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='blazeflow-task-attachment-tests-')
        self.settings_override = override_settings(
            MEDIA_ROOT=self.media_root,
            MAX_TASK_ATTACHMENT_BYTES=1024 * 1024,
        )
        self.settings_override.enable()
        super().setUp()
        self.client.force_authenticate(self.owner)
        created = self.client.post(
            reverse('api-tasks', args=[self.workspace.id]),
            {'title': 'Task with files'},
            format='json',
        )
        self.task_id = created.json()['id']

    def tearDown(self):
        self.settings_override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)

    def _png_upload(self, name='reference.png'):
        return SimpleUploadedFile(name, PNG_BYTES, content_type='image/png')

    def test_owner_can_upload_list_and_delete_attachment(self):
        upload = self._png_upload()
        response = self.client.post(
            reverse('api-task-attachments', args=[self.workspace.id, self.task_id]),
            {'file': upload},
            format='multipart',
        )

        self.assertEqual(response.status_code, 201)
        attachment_id = response.json()['id']
        self.assertTrue(TaskAttachment.objects.filter(id=attachment_id).exists())

        listed = self.client.get(
            reverse('api-task-attachments', args=[self.workspace.id, self.task_id])
        )
        self.assertEqual(len(listed.json()), 1)

        removed = self.client.delete(
            reverse('api-task-attachment-detail', args=[self.workspace.id, self.task_id, attachment_id])
        )
        self.assertEqual(removed.status_code, 204)
        self.assertFalse(TaskAttachment.objects.filter(id=attachment_id).exists())

    def test_docx_attachment_is_accepted(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive:
            archive.writestr('word/document.xml', '<xml/>')
        upload = SimpleUploadedFile(
            'brief.docx',
            buffer.getvalue(),
            content_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        )

        response = self.client.post(
            reverse('api-task-attachments', args=[self.workspace.id, self.task_id]),
            {'file': upload},
            format='multipart',
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(
            response.json()['file']['mime_type'],
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        )

    def test_plain_zip_mislabeled_as_docx_is_rejected(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive:
            archive.writestr('readme.txt', 'hello')
        upload = SimpleUploadedFile(
            'fake.docx',
            buffer.getvalue(),
            content_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        )

        response = self.client.post(
            reverse('api-task-attachments', args=[self.workspace.id, self.task_id]),
            {'file': upload},
            format='multipart',
        )

        self.assertEqual(response.status_code, 400)

    def test_spoofed_attachment_is_rejected(self):
        upload = SimpleUploadedFile('fake.png', b'not-really-a-png', content_type='image/png')

        response = self.client.post(
            reverse('api-task-attachments', args=[self.workspace.id, self.task_id]),
            {'file': upload},
            format='multipart',
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(TaskAttachment.objects.exists())

    def test_member_without_task_access_cannot_upload(self):
        outsider = get_user_model().objects.create_user(
            email='attachment-outsider@example.com',
            password='a-secure-test-password',
            first_name='Out',
            last_name='Sider',
        )
        self.client.force_authenticate(outsider)

        response = self.client.post(
            reverse('api-task-attachments', args=[self.workspace.id, self.task_id]),
            {'file': self._png_upload()},
            format='multipart',
        )

        self.assertEqual(response.status_code, 403)
