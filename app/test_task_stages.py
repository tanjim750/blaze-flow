"""Built-in task stages: kinds, the six defaults, the data migration, moves and linked files."""
import importlib
import shutil
import tempfile

from django.apps import apps as django_apps
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse

from .models import (
    File,
    Notification,
    NotificationKind,
    ProjectFile,
    Task,
    TaskAttachment,
    TaskStage,
    TaskStageKind,
    TaskStatus,
)
from .services.task_stages import is_client_review_stage, stage_for_status
from .services.workspaces import create_workspace
from .test_access_projects import WorkspaceAccessSetupMixin


PNG_BYTES = b'\x89PNG\r\n\x1a\n' + b'\x00' * 32
migration = importlib.import_module('app.migrations.0030_task_stage_kind')


def stage_rows(workspace):
    return list(TaskStage.objects.filter(workspace=workspace).order_by('sort_order').values_list('name', 'kind', 'is_done'))


class DefaultTaskStageTests(WorkspaceAccessSetupMixin, TestCase):
    def test_new_workspace_gets_the_six_built_in_stages_in_order(self):
        self.assertEqual(stage_rows(self.workspace), [
            ('To Do', TaskStageKind.TODO, False),
            ('In Progress', TaskStageKind.IN_PROGRESS, False),
            ('Review', TaskStageKind.REVIEW, False),
            ('Client Review', TaskStageKind.CLIENT_REVIEW, False),
            ('Revisions', TaskStageKind.REVISIONS, False),
            ('Approved', TaskStageKind.APPROVED, True),
        ])

    def test_stage_list_exposes_kind(self):
        self.client.force_authenticate(self.owner)
        response = self.client.get(reverse('api-task-stages', args=[self.workspace.id]))
        self.assertEqual([row['kind'] for row in response.json()['stages']], [
            'todo', 'in_progress', 'review', 'client_review', 'revisions', 'approved',
        ])

    def test_stages_created_through_the_api_are_custom(self):
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            reverse('api-task-stages', args=[self.workspace.id]),
            {'name': 'Colour grade', 'color': '#123456'}, format='json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['kind'], 'custom')

    def test_legacy_status_resolves_to_the_stage_of_the_same_meaning(self):
        self.assertEqual(stage_for_status(self.workspace, TaskStatus.CLIENT).name, 'Client Review')
        self.assertEqual(stage_for_status(self.workspace, TaskStatus.INTERNAL_QA).name, 'Review')
        self.assertEqual(stage_for_status(self.workspace, TaskStatus.IN_PROGRESS).name, 'In Progress')
        self.assertEqual(stage_for_status(self.workspace, TaskStatus.COMPLETED).name, 'Approved')

        self.client.force_authenticate(self.owner)
        created = self.client.post(
            reverse('api-tasks', args=[self.workspace.id]), {'title': 'Old client', 'status': 'CLIENT'}, format='json',
        )
        self.assertEqual(created.json()['task_stage_id'], str(TaskStage.objects.get(workspace=self.workspace, name='Client Review').id))

    def test_kind_wins_over_name_and_the_name_rule_is_kept_as_a_fallback(self):
        client_review = TaskStage.objects.get(workspace=self.workspace, kind=TaskStageKind.CLIENT_REVIEW)
        review = TaskStage.objects.get(workspace=self.workspace, kind=TaskStageKind.REVIEW)
        self.assertTrue(is_client_review_stage(client_review))
        self.assertFalse(is_client_review_stage(review))
        client_review.name = 'With the brand team'
        self.assertTrue(is_client_review_stage(client_review))
        custom = TaskStage(workspace=self.workspace, name='Client sign-off', kind=TaskStageKind.CUSTOM)
        self.assertTrue(is_client_review_stage(custom))


class ClientReadyAutomationTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.owner)
        self.client_user = get_user_model().objects.create_user(
            email='client-contact@example.com', password='a-secure-test-password', first_name='Cli', last_name='Ent',
        )
        team_id = self.client.post(
            reverse('api-client-teams', args=[self.workspace.id]), {'name': 'Acme'}, format='json',
        ).json()['id']
        self.client.post(
            reverse('api-client-team-members', args=[self.workspace.id, team_id]),
            {'email': self.client_user.email}, format='json',
        )
        self.task_id = self.client.post(
            reverse('api-tasks', args=[self.workspace.id]), {'title': 'Hero cut', 'client_team_id': team_id}, format='json',
        ).json()['id']

    def _move(self, stage, **extra):
        return self.client.post(
            reverse('api-task-move', args=[self.workspace.id, self.task_id]),
            {'task_stage_id': str(stage.id), **extra}, format='json',
        )

    def _notified(self):
        return Notification.objects.filter(recipient_user=self.client_user, kind=NotificationKind.TASK_CLIENT_READY).count()

    def test_internal_review_does_not_notify_the_client(self):
        self._move(TaskStage.objects.get(workspace=self.workspace, name='Review'))
        self.assertEqual(self._notified(), 0)

    def test_moving_into_client_review_notifies_and_reports_the_side_effect(self):
        response = self._move(TaskStage.objects.get(workspace=self.workspace, name='Client Review'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['side_effects'], ['client_notified'])
        self.assertEqual(self._notified(), 1)

    def test_a_renamed_client_review_stage_still_notifies(self):
        stage = TaskStage.objects.get(workspace=self.workspace, kind=TaskStageKind.CLIENT_REVIEW)
        stage.name = 'With the brand team'
        stage.save()
        self.client.patch(
            reverse('api-task-detail', args=[self.workspace.id, self.task_id]),
            {'task_stage_id': str(stage.id)}, format='json',
        )
        self.assertEqual(self._notified(), 1)

    def test_workspace_switch_and_stage_automation_still_gate_the_notification(self):
        stage = TaskStage.objects.get(workspace=self.workspace, kind=TaskStageKind.CLIENT_REVIEW)
        stage.automation_enabled = False
        stage.save()
        self.assertEqual(self._move(stage).json()['side_effects'], [])
        self.assertEqual(self._notified(), 0)


class TaskMoveApiTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.owner)
        self.stages = {stage.kind: stage for stage in TaskStage.objects.filter(workspace=self.workspace)}
        self.ids = [self._create(f'Task {index}', self.stages['todo']) for index in range(3)]
        self.mover = self._create('Mover', self.stages['in_progress'])

    def _create(self, title, stage):
        return self.client.post(
            reverse('api-tasks', args=[self.workspace.id]),
            {'title': title, 'task_stage_id': str(stage.id)}, format='json',
        ).json()['id']

    def _move(self, task_id, stage, position=None):
        body = {'task_stage_id': str(stage.id)}
        if position is not None:
            body['position'] = position
        return self.client.post(reverse('api-task-move', args=[self.workspace.id, task_id]), body, format='json')

    def _column(self, stage):
        return [str(pk) for pk in Task.objects.filter(task_stage=stage).order_by('sort_order').values_list('id', flat=True)]

    def test_drop_lands_at_the_given_position_and_renumbers_the_column(self):
        response = self._move(self.mover, self.stages['todo'], position=1)

        self.assertEqual(response.status_code, 200)
        expected = [self.ids[0], self.mover, self.ids[1], self.ids[2]]
        self.assertEqual(self._column(self.stages['todo']), expected)
        self.assertEqual([row['id'] for row in response.json()['order']], expected)
        self.assertEqual(response.json()['task']['task_stage_id'], str(self.stages['todo'].id))

    def test_without_a_position_the_task_goes_to_the_end_and_reorders_within_a_column(self):
        self._move(self.mover, self.stages['todo'])
        self.assertEqual(self._column(self.stages['todo'])[-1], self.mover)
        self._move(self.ids[2], self.stages['todo'], position=0)
        self.assertEqual(self._column(self.stages['todo'])[0], self.ids[2])

    def test_moving_into_and_out_of_the_done_stage_ignores_the_edit_lock(self):
        approved = self._move(self.mover, self.stages['approved'])
        self.assertEqual(approved.json()['task']['status'], TaskStatus.APPROVED)
        self.assertIsNotNone(approved.json()['task']['completed_at'])

        reopened = self._move(self.mover, self.stages['in_progress'])
        self.assertEqual(reopened.status_code, 200)
        self.assertIsNone(reopened.json()['task']['completed_at'])

    def test_stage_from_another_workspace_is_rejected(self):
        other_owner = get_user_model().objects.create_user(email='other@example.com', password='a-secure-test-password', first_name='Some', last_name='One')
        other_workspace, _ = create_workspace(owner=other_owner, name='Other', slug='other-ws', workspace_timezone='UTC')
        foreign = TaskStage.objects.filter(workspace=other_workspace).first()
        self.assertEqual(self._move(self.mover, foreign).status_code, 404)

    def test_member_without_task_update_cannot_move(self):
        self.client.logout()
        self.client.force_authenticate(get_user_model().objects.create_user(email='stranger@example.com', password='a-secure-test-password', first_name='Some', last_name='One'))
        self.assertEqual(self._move(self.mover, self.stages['todo']).status_code, 403)


class LinkedAttachmentTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='blazeflow-task-stage-tests-')
        self.settings_override = override_settings(MEDIA_ROOT=self.media_root, MAX_TASK_ATTACHMENT_BYTES=1024 * 1024)
        self.settings_override.enable()
        super().setUp()
        self.client.force_authenticate(self.owner)
        self.first, self.second = (
            self.client.post(reverse('api-tasks', args=[self.workspace.id]), {'title': title}, format='json').json()['id']
            for title in ('First', 'Second')
        )
        uploaded = self.client.post(
            reverse('api-task-attachments', args=[self.workspace.id, self.first]),
            {'file': SimpleUploadedFile('frame.png', PNG_BYTES, content_type='image/png')}, format='multipart',
        )
        self.file_id = uploaded.json()['file']['id']

    def tearDown(self):
        self.settings_override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)

    def _link(self, task_id, file_id):
        return self.client.post(
            reverse('api-task-attachments', args=[self.workspace.id, task_id]), {'file_id': file_id}, format='json',
        )

    def test_an_existing_file_can_be_linked_without_copying_it(self):
        response = self._link(self.second, self.file_id)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['file']['id'], self.file_id)
        self.assertEqual(TaskAttachment.objects.filter(file_id=self.file_id).count(), 2)

    def test_task_payload_lists_attached_file_ids(self):
        self._link(self.second, self.file_id)
        listed = {row['id']: row for row in self.client.get(reverse('api-tasks', args=[self.workspace.id])).json()}
        self.assertEqual(listed[self.second]['attachment_file_ids'], [self.file_id])
        detail = self.client.get(reverse('api-task-detail', args=[self.workspace.id, self.first])).json()
        self.assertEqual(detail['attachment_file_ids'], [self.file_id])

    def test_linking_twice_or_sending_nothing_is_rejected(self):
        self._link(self.second, self.file_id)
        self.assertEqual(self._link(self.second, self.file_id).status_code, 400)
        empty = self.client.post(reverse('api-task-attachments', args=[self.workspace.id, self.second]), {}, format='json')
        self.assertEqual(empty.status_code, 400)

    def test_a_file_from_another_workspace_cannot_be_linked(self):
        other_owner = get_user_model().objects.create_user(email='other2@example.com', password='a-secure-test-password', first_name='Some', last_name='One')
        other_workspace, _ = create_workspace(owner=other_owner, name='Other', slug='other-ws-2', workspace_timezone='UTC')
        File.objects.filter(id=self.file_id).update(workspace_id=other_workspace.id)
        self.assertEqual(self._link(self.second, self.file_id).status_code, 404)


class TaskStageKindMigrationTests(WorkspaceAccessSetupMixin, TestCase):
    """Runs the 0030 data step against workspaces rebuilt with the old five stages."""

    OLD = (('To Do', '#89909d', False), ('Revisions', '#ff5865', False), ('Internal QA', '#4ba3ff', False),
           ('Client', '#f4a742', False), ('Approved', '#36d399', True))

    def _legacy_workspace(self, names=None):
        Task.objects.filter(workspace=self.workspace).delete()
        TaskStage.objects.filter(workspace=self.workspace).delete()
        stages = {}
        for order, (name, color, done) in enumerate(self.OLD):
            name = (names or {}).get(name, name)
            stages[name] = TaskStage.objects.create(
                workspace=self.workspace, name=name, color=color, sort_order=order, is_done=done, kind=TaskStageKind.CUSTOM,
            )
        return stages

    def _task(self, title, stage):
        self.client.force_authenticate(self.owner)
        return self.client.post(
            reverse('api-tasks', args=[self.workspace.id]), {'title': title, 'task_stage_id': str(stage.id)}, format='json',
        ).json()['id']

    def test_untouched_defaults_become_the_six_stages_keeping_ids_and_tasks(self):
        stages = self._legacy_workspace()
        tasks = {name: self._task(f'In {name}', stage) for name, stage in stages.items()}
        ids = {name: stage.id for name, stage in stages.items()}

        migration.forwards(django_apps, None)

        self.assertEqual(stage_rows(self.workspace), [
            ('To Do', 'todo', False), ('In Progress', 'in_progress', False), ('Review', 'review', False),
            ('Client Review', 'client_review', False), ('Revisions', 'revisions', False), ('Approved', 'approved', True),
        ])
        self.assertEqual(TaskStage.objects.get(id=ids['Internal QA']).name, 'Review')
        self.assertEqual(TaskStage.objects.get(id=ids['Client']).name, 'Client Review')
        self.assertEqual(TaskStage.objects.get(id=ids['Client']).color, '#67b0f9')
        for name, task_id in tasks.items():
            self.assertEqual(Task.objects.get(id=task_id).task_stage_id, ids[name])

    def test_customised_workflows_only_gain_kinds_and_in_progress_after_to_do(self):
        stages = self._legacy_workspace(names={'Client': 'With client'})
        TaskStage.objects.create(workspace=self.workspace, name='Review', color='#000000', sort_order=10)
        stages['Internal QA'].color = '#abcdef'
        stages['Internal QA'].save()

        migration.forwards(django_apps, None)

        rows = list(TaskStage.objects.filter(workspace=self.workspace).order_by('sort_order').values_list('name', 'kind', 'color'))
        self.assertEqual([row[0] for row in rows], ['To Do', 'In Progress', 'Revisions', 'Internal QA', 'With client', 'Approved', 'Review'])
        by_name = {row[0]: row for row in rows}
        # "Review" was already taken, so Internal QA keeps its name but still gains the kind.
        self.assertEqual(by_name['Internal QA'][1:], ('review', '#abcdef'))
        self.assertEqual(by_name['Review'][1], 'custom')
        # A renamed Client stage is left alone and keeps notifying through the name rule.
        self.assertEqual(by_name['With client'][1], 'custom')
        self.assertTrue(is_client_review_stage(TaskStage.objects.get(workspace=self.workspace, name='With client')))

    def test_running_it_again_changes_nothing(self):
        self._legacy_workspace()
        migration.forwards(django_apps, None)
        before = stage_rows(self.workspace)
        migration.forwards(django_apps, None)
        self.assertEqual(stage_rows(self.workspace), before)

    def test_backwards_restores_the_old_names_and_drops_an_empty_in_progress(self):
        self._legacy_workspace()
        migration.forwards(django_apps, None)
        migration.backwards(django_apps, None)
        self.assertEqual(
            list(TaskStage.objects.filter(workspace=self.workspace).order_by('sort_order').values_list('name', flat=True)),
            ['To Do', 'Revisions', 'Internal QA', 'Client', 'Approved'],
        )
        self.assertFalse(ProjectFile.objects.exists())
