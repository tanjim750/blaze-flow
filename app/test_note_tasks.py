"""Review note → task: prefill, no duplicates, team only, two-way resolution, carry-over checklist."""
from django.test import TestCase
from django.urls import reverse

from .models import ReviewComment, Task, TaskStage
from .test_role_dashboards import DashboardBase


class NoteTaskTests(DashboardBase, TestCase):
    def setUp(self):
        super().setUp()
        self.editor, self.editor_membership = self.add_member('ed@studio.example', first='Eddie', last='Cutter')
        self.media = self.upload(self.editor, title='Hero 30s')
        self.comment = self.note(self.owner, self.media['id'], 'Logo pops too early\nsecond line', start_time_ms=12500)

    def make(self, user, ids, **extra):
        self.as_user(user)
        return self.client.post(reverse('api-note-tasks', args=[self.workspace.id]), {'comment_ids': ids, **extra}, format='json')

    def links(self, user, media=None):
        self.as_user(user)
        response = self.client.get(reverse('api-version-note-tasks', args=[self.workspace.id, self.project_id, (media or self.media)['id']]))
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_defaults_prefill_from_the_note_and_assign_the_cuts_editor(self):
        self.as_user(self.owner)
        data = self.client.get(reverse('api-note-task-defaults', args=[self.workspace.id]), {'comment': self.comment['id']}).json()
        self.assertEqual(data['title'], 'Logo pops too early')
        self.assertIn('at 0:12', data['description'])
        self.assertIn(f"comment={self.comment['id']}", data['description'])
        self.assertEqual(data['assignee_id'], str(self.editor_membership.id))
        self.assertIsNone(data['existing'])

    def test_one_task_per_note_and_the_link_shows_both_ways(self):
        first = self.make(self.owner, [self.comment['id']], title='Fix logo timing')
        self.assertEqual(first.status_code, 201, first.content)
        again = self.make(self.owner, [self.comment['id']])
        self.assertEqual(again.status_code, 200)
        self.assertFalse(again.json()['results'][0]['created'])
        self.assertEqual(Task.objects.filter(source_review_comment_id=self.comment['id']).count(), 1)
        task_id = first.json()['results'][0]['task']['id']
        self.assertEqual(self.links(self.owner)['links'][self.comment['id']]['title'], 'Fix logo timing')
        self.as_user(self.owner)
        task = self.client.get(reverse('api-task-detail', args=[self.workspace.id, task_id])).json()
        self.assertEqual(task['source_note']['timecode'], '0:12')
        self.assertIn('&t=12500', task['source_note']['href'])
        self.assertEqual([a['id'] for a in task['assignees']], [str(self.editor_membership.id)])

    def test_bulk_creates_one_task_per_note(self):
        other = self.note(self.owner, self.media['id'], 'Grade is too warm', start_time_ms=3000)
        response = self.make(self.owner, [self.comment['id'], other['id']])
        self.assertEqual(response.status_code, 201)
        titles = sorted(Task.objects.filter(source_review_comment__isnull=False).values_list('title', flat=True))
        self.assertEqual(titles, ['Grade is too warm', 'Logo pops too early'])

    def test_finishing_the_task_resolves_the_note_and_resolving_the_note_finishes_the_task(self):
        task_id = self.make(self.owner, [self.comment['id']]).json()['results'][0]['task']['id']
        done = TaskStage.objects.filter(workspace=self.workspace, is_done=True).first()
        self.as_user(self.owner)
        moved = self.client.patch(reverse('api-task-detail', args=[self.workspace.id, task_id]), {'task_stage_id': str(done.id)}, format='json')
        self.assertEqual(moved.status_code, 200, moved.content)
        self.assertTrue(ReviewComment.objects.get(id=self.comment['id']).resolved)
        # And back: reopening the note reopens the task.
        reopened = self.client.post(reverse('api-review-comment-resolution', args=[self.workspace.id, self.project_id, self.media['id'], self.comment['id']]), {'resolved': False}, format='json')
        self.assertIn(reopened.status_code, (200, 201), reopened.content)
        self.assertFalse(Task.objects.get(id=task_id).task_stage.is_done)
        resolved = self.client.post(reverse('api-review-comment-resolution', args=[self.workspace.id, self.project_id, self.media['id'], self.comment['id']]), {'resolved': True}, format='json')
        self.assertIn(resolved.status_code, (200, 201), resolved.content)
        self.assertTrue(Task.objects.get(id=task_id).task_stage.is_done)

    def test_sync_can_be_turned_off(self):
        task_id = self.make(self.owner, [self.comment['id']], sync_note_resolution=False).json()['results'][0]['task']['id']
        done = TaskStage.objects.filter(workspace=self.workspace, is_done=True).first()
        self.as_user(self.owner)
        self.client.patch(reverse('api-task-detail', args=[self.workspace.id, task_id]), {'task_stage_id': str(done.id)}, format='json')
        self.assertFalse(ReviewComment.objects.get(id=self.comment['id']).resolved)

    def test_clients_can_never_make_or_see_note_tasks(self):
        client = self.add_client_member()
        self.make(self.owner, [self.comment['id']])
        public = self.note(self.owner, self.media['id'], 'Client can see this')
        self.assertEqual(self.make(client, [public['id']]).status_code, 403)
        self.assertEqual(self.links(client)['links'], {})

    def test_carry_over_copies_open_notes_once_as_team_checklist(self):
        self.note(self.owner, self.media['id'], 'Already fixed')
        ReviewComment.objects.filter(media_version_id=self.media['id']).exclude(id=self.comment['id']).update(resolved=True)
        v2 = self.upload(self.editor, title='Hero 30s')
        status = self.links(self.owner, v2)['carry_over']
        self.assertEqual(status['available'], 1)
        self.as_user(self.owner)
        url = reverse('api-version-carry-over', args=[self.workspace.id, self.project_id, v2['id']])
        self.assertEqual(self.client.post(url).json()['created'], 1)
        self.assertEqual(self.client.post(url).json()['created'], 0)
        copy = ReviewComment.objects.get(media_version_id=v2['id'], carried_from_id=self.comment['id'])
        self.assertEqual(copy.visibility, 'team')
        self.assertEqual(copy.start_time_ms, 12500)
        self.assertTrue(self.links(self.owner, v2)['carry_over']['done'])
