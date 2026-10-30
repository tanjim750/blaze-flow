from django.test import TestCase
from django.urls import reverse

from .models import ProjectFile, Task, TaskStage, TaskStageKind
from .test_guest_decisions import DecisionBase


class FileStageSyncTests(DecisionBase, TestCase):
    """A4: moving a file to Approval (or Revisions / Client review) moves its tasks, like a review outcome."""

    def setUp(self):
        super().setUp()
        self.row = ProjectFile.objects.filter(file_id=self.v2['file']['id'], deleted_at__isnull=True).first()
        self.task = Task.objects.get(title='Hero cut')
        self.as_user(self.owner)

    def stage(self, kind):
        return TaskStage.objects.filter(workspace=self.workspace, kind=kind).order_by('sort_order').first()

    def move(self, stage, **extra):
        response = self.client.patch(reverse('api-asset-file-detail', args=[self.workspace.id, self.row.id]), {'task_stage_id': str(stage.id), **extra}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_moving_to_approved_moves_attached_task(self):
        data = self.move(self.stage(TaskStageKind.APPROVED))
        self.task.refresh_from_db()
        self.assertEqual(self.task.task_stage.kind, TaskStageKind.APPROVED)
        self.assertEqual(self.task.status, 'APPROVED')
        self.assertEqual([t['title'] for t in data['synced_tasks']], ['Hero cut'])

    def test_revisions_and_client_review_sync_too(self):
        for kind in (TaskStageKind.REVISIONS, TaskStageKind.CLIENT_REVIEW):
            self.move(self.stage(kind))
            self.task.refresh_from_db()
            self.assertEqual(self.task.task_stage.kind, kind)

    def test_working_columns_leave_tasks_alone(self):
        before = self.task.task_stage_id
        data = self.move(self.stage(TaskStageKind.IN_PROGRESS))
        self.task.refresh_from_db()
        self.assertEqual(self.task.task_stage_id, before)
        self.assertEqual(data['synced_tasks'], [])

    def test_unchanged_stage_does_not_resync(self):
        approved = self.stage(TaskStageKind.APPROVED)
        self.move(approved)
        self.task.task_stage = self.stage(TaskStageKind.IN_PROGRESS)
        self.task.save(update_fields=['task_stage'])
        data = self.move(approved, name=self.row.file.original_name)  # e.g. a rename that re-sends the stage
        self.task.refresh_from_db()
        self.assertEqual(self.task.task_stage.kind, TaskStageKind.IN_PROGRESS)
        self.assertEqual(data['synced_tasks'], [])
