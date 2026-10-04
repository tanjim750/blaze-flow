"""The activity feed: what is audited, who sees it, and how it reads."""
import csv
import io
import shutil
import tempfile
import uuid
from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .models import AuditLog, MediaVersion, ProjectAccessMode, Role, TaskStage, WorkflowStage, WorkspaceMembership
from .services.audit import resolve_audit_scope
from .test_access_projects import WorkspaceAccessSetupMixin

GUEST_PERMISSIONS = ['media.read', 'review.comment.read', 'review.comment.create', 'annotation.read']


class ActivityBase(WorkspaceAccessSetupMixin):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='blazeflow-activity-')
        self.settings_override = override_settings(MEDIA_ROOT=self.media_root)
        self.settings_override.enable()
        super().setUp()
        self.client.force_authenticate(self.owner)
        self.project_id = self.client.post(reverse('api-projects', args=[self.workspace.id]), {'name': 'Spring Launch'}, format='json').json()['id']
        self.stages = {stage.kind: stage for stage in TaskStage.objects.filter(workspace=self.workspace)}

    def tearDown(self):
        self.settings_override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)
        super().tearDown()

    # -- helpers --------------------------------------------------------------------
    def as_user(self, user):
        self.client.force_authenticate(user)

    def upload(self, title='Hero 30s'):
        self.as_user(self.owner)
        response = self.client.post(
            reverse('api-media-versions', args=[self.workspace.id, self.project_id]),
            {'file': SimpleUploadedFile('frame.png', b'\x89PNG\r\n\x1a\nactivity', content_type='image/png'), 'title': title},
            format='multipart',
        )
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def comment(self, media_id, text, visibility='client'):
        self.as_user(self.owner)
        response = self.client.post(
            reverse('api-review-comments', args=[self.workspace.id, self.project_id, media_id]),
            {'text': text, 'visibility': visibility}, format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def make_task(self, title='Hero 30s', **extra):
        self.as_user(self.owner)
        response = self.client.post(reverse('api-tasks', args=[self.workspace.id]), {'title': title, 'project_id': self.project_id, **extra}, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def move(self, task_id, kind):
        response = self.client.post(reverse('api-task-move', args=[self.workspace.id, task_id]), {'task_stage_id': str(self.stages[kind].id)}, format='json')
        self.assertEqual(response.status_code, 200, response.content)

    def feed(self, user=None, project=None, **params):
        self.as_user(user or self.owner)
        url = reverse('api-project-activity', args=[self.workspace.id, project]) if project else reverse('api-workspace-activity', args=[self.workspace.id])
        response = self.client.get(url, params)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def events(self, action, entity_id=None):
        rows = AuditLog.objects.filter(action=action).order_by('created_at')
        if entity_id:
            rows = rows.filter(entity_id=str(entity_id))
        return list(rows)

    def guest_link(self, label='Client review'):
        self.as_user(self.owner)
        invite = self.client.post(
            reverse('api-project-guest-invites', args=[self.workspace.id, self.project_id]),
            {'label': label, 'permissions': GUEST_PERMISSIONS, 'expires_in_hours': 24}, format='json',
        ).json()
        self.client.force_authenticate(user=None)
        exchange = self.client.post(reverse('api-guest-exchange'), {'token': invite['token'], 'name': 'Dana Client', 'email': 'dana@client.test'}, format='json').json()
        return invite, {'HTTP_X_GUEST_ACCESS_KEY': exchange['access_key']}

    def add_client_member(self, *, email='client-member@example.com'):
        """A user who is in the workspace only through a client team (Member role, all projects)."""
        user_model = WorkspaceMembership._meta.get_field('user').remote_field.model
        user = user_model.objects.create_user(email=email, password='a-secure-test-password', first_name='Cleo', last_name='Client')
        self.as_user(self.owner)
        team = self.client.post(reverse('api-client-teams', args=[self.workspace.id]), {'name': 'Acme'}, format='json').json()
        self.client.post(reverse('api-client-team-members', args=[self.workspace.id, team['id']]), {'email': user.email}, format='json')
        granted = self.client.post(
            reverse('api-client-team-workspace-access', args=[self.workspace.id, team['id']]),
            {'role_id': str(self.member_role.id), 'project_access_mode': 'ALL'}, format='json',
        )
        self.assertEqual(granted.status_code, 201, granted.content)
        return user


class TaskAuditTests(ActivityBase, TestCase):
    def test_created_records_title_and_initial_stage(self):
        task = self.make_task()
        [event] = self.events('task.created', task['id'])
        self.assertEqual(event.actor_user, self.owner)
        self.assertEqual(str(event.project_id), self.project_id)
        self.assertEqual(event.metadata['task_title'], 'Hero 30s')
        self.assertEqual(event.metadata['stage']['kind'], 'todo')

    def test_assigned_on_create_and_through_the_assignees_route(self):
        membership = self.invite_and_accept()
        task = self.make_task(assignee_id=str(membership.id))
        self.assertEqual(len(self.events('task.assigned', task['id'])), 1)
        self.assertEqual(self.events('task.assigned', task['id'])[0].metadata['assignee']['name'], 'Workspace Member')
        # Re-sending the same assignee is not a new assignment.
        self.client.patch(reverse('api-task-detail', args=[self.workspace.id, task['id']]), {'assignee_id': str(membership.id)}, format='json')
        self.assertEqual(len(self.events('task.assigned', task['id'])), 1)
        # Clearing it is an unassignment.
        self.client.patch(reverse('api-task-detail', args=[self.workspace.id, task['id']]), {'assignee_id': None}, format='json')
        self.assertEqual(len(self.events('task.unassigned', task['id'])), 1)
        other = self.make_task('Cutdown')
        response = self.client.post(reverse('api-task-assignees', args=[self.workspace.id, other['id']]), {'membership_id': str(membership.id)}, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(len(self.events('task.assigned', other['id'])), 1)

    def test_stage_moves_record_from_and_to_with_kind(self):
        task = self.make_task()
        self.move(task['id'], 'review')
        self.move(task['id'], 'client_review')
        # Re-dropping in the same column (a reorder) is not a stage move.
        self.move(task['id'], 'client_review')
        moves = self.events('task.stage.moved', task['id'])
        self.assertEqual(len(moves), 2)
        self.assertEqual(moves[1].metadata['from_stage']['name'], 'Review')
        self.assertEqual(moves[1].metadata['from_stage']['kind'], 'review')
        self.assertEqual(moves[1].metadata['to_stage']['name'], 'Client Review')
        self.assertEqual(moves[1].metadata['to_stage']['kind'], 'client_review')

    def test_a_patch_to_the_stage_is_a_move_too(self):
        task = self.make_task()
        self.client.patch(reverse('api-task-detail', args=[self.workspace.id, task['id']]), {'task_stage_id': str(self.stages['in_progress'].id)}, format='json')
        [move] = self.events('task.stage.moved', task['id'])
        self.assertEqual(move.metadata['to_stage']['kind'], 'in_progress')

    def test_stage_history_gives_time_in_stage(self):
        task = self.make_task()
        self.move(task['id'], 'in_progress')
        self.move(task['id'], 'review')
        created, *moves = self.events('task.created', task['id']) + self.events('task.stage.moved', task['id'])
        # Entering a stage is each event's time; leaving it is the next event's.
        base = timezone.now() - timedelta(hours=10)
        for offset, event in enumerate([created, *moves]):
            AuditLog.objects.filter(id=event.id).update(created_at=base + timedelta(hours=offset * 3))
        history = [created, *moves]
        for event in history:
            event.refresh_from_db()
        entered = [(created.metadata['stage']['kind'], created.created_at)] + [(m.metadata['to_stage']['kind'], m.created_at) for m in moves]
        in_progress = entered[2][1] - entered[1][1]
        self.assertEqual([kind for kind, _ in entered], ['todo', 'in_progress', 'review'])
        self.assertEqual(in_progress, timedelta(hours=3))

    def test_due_date_change_records_before_and_after(self):
        task = self.make_task(due_at='2026-10-10T17:00:00Z')
        self.client.patch(reverse('api-task-detail', args=[self.workspace.id, task['id']]), {'due_at': '2026-10-14T17:00:00Z'}, format='json')
        [event] = self.events('task.due_date.changed', task['id'])
        self.assertTrue(event.metadata['before'].startswith('2026-10-10'))
        self.assertTrue(event.metadata['after'].startswith('2026-10-14'))
        # Saving the same date again is not a change.
        self.client.patch(reverse('api-task-detail', args=[self.workspace.id, task['id']]), {'due_at': '2026-10-14T17:00:00Z'}, format='json')
        self.assertEqual(len(self.events('task.due_date.changed', task['id'])), 1)

    def test_deleting_a_stage_records_the_bulk_move(self):
        task = self.make_task()
        self.move(task['id'], 'revisions')
        response = self.client.delete(
            reverse('api-task-stage-detail', args=[self.workspace.id, self.stages['revisions'].id]),
            {'replacement_stage_id': str(self.stages['in_progress'].id)}, format='json',
        )
        self.assertEqual(response.status_code, 204, response.content)
        last = self.events('task.stage.moved', task['id'])[-1]
        self.assertEqual(last.metadata['reason'], 'stage_deleted')
        self.assertEqual(last.metadata['to_stage']['name'], 'In Progress')


class GuestAuditTests(ActivityBase, TestCase):
    def test_link_lifecycle_is_audited(self):
        media = self.upload()
        invite, headers = self.guest_link()
        [created] = self.events('guest.invite.created')
        self.assertEqual(created.actor_user, self.owner)
        [opened] = self.events('guest.link.opened')
        self.assertEqual(opened.actor_type, 'GUEST')
        self.assertEqual(opened.metadata['guest_invite_id'], invite['id'])
        self.client.force_authenticate(user=None)
        url = reverse('api-guest-comments', args=[self.project_id, media['id']])
        self.assertEqual(self.client.get(url, **headers).status_code, 200)
        self.assertEqual(self.client.get(url, **headers).status_code, 200)
        annotations = reverse('api-guest-annotations', args=[self.project_id, media['id']])
        self.assertEqual(self.client.get(annotations, **headers).status_code, 200)
        [viewed] = self.events('guest.media.viewed')  # deduplicated: one visit, not three
        self.assertEqual(viewed.metadata['version_number'], 1)
        self.assertEqual(str(viewed.project_id), self.project_id)
        self.as_user(self.owner)
        listed = self.client.get(reverse('api-project-guest-invites', args=[self.workspace.id, self.project_id])).json()
        access_id = listed[0]['accesses'][0]['id']
        self.client.delete(reverse('api-project-guest-access-detail', args=[self.workspace.id, self.project_id, access_id]))
        self.client.delete(reverse('api-project-guest-invite-detail', args=[self.workspace.id, self.project_id, invite['id']]))
        [revoked_access] = self.events('guest.access.revoked')
        self.assertEqual(revoked_access.metadata['guest_name'], 'Dana Client')
        self.assertEqual(len(self.events('guest.invite.revoked')), 1)

    def test_invite_list_carries_a_status_built_from_guest_events(self):
        media = self.upload()
        invite, headers = self.guest_link()
        self.as_user(self.owner)
        listed = self.client.get(reverse('api-project-guest-invites', args=[self.workspace.id, self.project_id])).json()
        self.assertIsNotNone(listed[0]['activity']['last_opened_at'])
        self.assertIsNone(listed[0]['activity']['last_version_number'])
        self.client.force_authenticate(user=None)
        self.client.get(reverse('api-guest-comments', args=[self.project_id, media['id']]), **headers)
        self.as_user(self.owner)
        status = self.client.get(reverse('api-project-guest-invites', args=[self.workspace.id, self.project_id])).json()[0]['activity']
        self.assertEqual(status['last_version_number'], 1)
        self.assertIsNone(status['decision'])
        approved = WorkflowStage.objects.get(workspace=self.workspace, slug='approved')
        self.client.post(reverse('api-media-version-workflow', args=[self.workspace.id, self.project_id, media['id']]), {'workflow_stage_id': str(approved.id)}, format='json')
        status = self.client.get(reverse('api-project-guest-invites', args=[self.workspace.id, self.project_id])).json()[0]['activity']
        # A team approval is not the client's decision: the link line only reports what a
        # reviewer decided through the link (see test_guest_decisions for that path).
        self.assertIsNone(status['decision'])


    def test_links_opened_before_auditing_fall_back_to_the_access_clock(self):
        self.guest_link()
        AuditLog.objects.filter(action__startswith='guest.').delete()
        self.as_user(self.owner)
        status = self.client.get(reverse('api-project-guest-invites', args=[self.workspace.id, self.project_id])).json()[0]['activity']
        self.assertIsNotNone(status['last_opened_at'])
        self.assertEqual(status['visits'], 0)


class FeedReadTests(ActivityBase, TestCase):
    def test_rows_are_readable(self):
        task = self.make_task()
        self.move(task['id'], 'review')
        self.move(task['id'], 'client_review')
        row = self.feed(type='tasks')['results'][0]
        self.assertEqual(row['actor']['name'], 'Access Owner')
        self.assertEqual(row['actor']['initials'], 'AO')
        self.assertEqual(row['verb'], 'moved')
        self.assertEqual((row['before'], row['after']), ('Review', 'Client Review'))
        self.assertEqual(row['detail']['to_kind'], 'client_review')
        self.assertEqual(row['object'], {'type': 'task', 'id': task['id'], 'label': 'Hero 30s', 'href': f"/tasks?task={task['id']}"})
        self.assertEqual(row['project']['name'], 'Spring Launch')
        self.assertEqual(row['summary'], "Access Owner moved 'Hero 30s' from Review → Client Review")

    def test_guest_view_reads_with_version_and_decision(self):
        media = self.upload()
        _, headers = self.guest_link()
        self.client.force_authenticate(user=None)
        self.client.get(reverse('api-guest-comments', args=[self.project_id, media['id']]), **headers)
        row = self.feed(type='guests')['results'][0]
        self.assertEqual(row['actor'], {'type': 'guest', 'id': None, 'name': 'Dana Client', 'initials': 'DC', 'avatar_url': None})
        self.assertEqual(row['summary'], 'Dana Client opened review link · Hero 30s V1 · no decision yet')
        self.assertEqual(row['detail']['version_number'], 1)
        self.assertIn(f"version={media['id']}", row['object']['href'])

    def test_media_and_comment_events_link_to_the_review(self):
        media = self.upload()
        note = self.comment(media['id'], 'Logo is clipped at 0:12')
        rows = self.feed()['results']
        comment = next(row for row in rows if row['action'] == 'review.comment.created')
        self.assertEqual(comment['detail']['excerpt'], 'Logo is clipped at 0:12')
        self.assertIn(f"comment={note['id']}", comment['object']['href'])
        upload = next(row for row in rows if row['action'] == 'media.uploaded')
        self.assertEqual(upload['summary'], "Access Owner uploaded 'Hero 30s' V1")

    def test_workflow_transition_reads_from_and_to(self):
        media = self.upload()
        review = WorkflowStage.objects.get(workspace=self.workspace, slug='in-review')
        self.client.post(reverse('api-media-version-workflow', args=[self.workspace.id, self.project_id, media['id']]), {'workflow_stage_id': str(review.id)}, format='json')
        row = self.feed(type='media')['results'][0]
        self.assertEqual((row['before'], row['after']), ('Queued', 'In Review'))

    def test_pagination(self):
        for index in range(5):
            self.make_task(f'Task {index}')
        first = self.feed(type='tasks', page_size=2)
        self.assertEqual((first['count'], len(first['results']), first['has_next']), (5, 2, True))
        third = self.feed(type='tasks', page_size=2, page=3)
        self.assertEqual((len(third['results']), third['has_next']), (1, False))
        ids = {row['id'] for page in (1, 2, 3) for row in self.feed(type='tasks', page_size=2, page=page)['results']}
        self.assertEqual(len(ids), 5)
        # Newest first.
        self.assertEqual(first['results'][0]['object']['label'], 'Task 4')
        self.as_user(self.owner)
        self.assertEqual(self.client.get(reverse('api-workspace-activity', args=[self.workspace.id]), {'page_size': 500}).status_code, 400)

    def test_filters(self):
        self.invite_and_accept()
        self.make_task('Owner task')
        self.as_user(self.member_user)
        self.client.post(reverse('api-tasks', args=[self.workspace.id]), {'title': 'Member task', 'project_id': self.project_id}, format='json')
        self.upload()
        by_member = self.feed(actor=str(self.member_user.id))['results']
        self.assertEqual([row['object']['label'] for row in by_member], ['Member task'])
        self.assertEqual({row['category'] for row in self.feed(type='media')['results']}, {'media'})
        self.assertEqual({row['action'] for row in self.feed(type='task.created')['results']}, {'task.created'})
        other = self.client.post(reverse('api-projects', args=[self.workspace.id]), {'name': 'Other'}, format='json').json()['id']
        self.make_task('Elsewhere', project_id=other)
        self.assertEqual([row['object']['label'] for row in self.feed(project=other)['results']], ['Elsewhere'])
        self.assertEqual(self.feed(project=other)['count'], self.feed(**{'project': other})['count'])
        self.as_user(self.owner)
        self.assertEqual(self.client.get(reverse('api-workspace-activity', args=[self.workspace.id]), {'type': 'nope'}).status_code, 400)
        self.assertEqual(self.client.get(reverse('api-workspace-activity', args=[self.workspace.id]), {'actor': 'x'}).status_code, 400)

    def test_noise_actions_are_not_in_the_feed(self):
        media = self.upload()
        MediaVersion.objects.filter(id=media['id']).update(allow_download=True)
        self.client.get(reverse('api-media-version-download', args=[self.workspace.id, self.project_id, media['id']]))
        self.assertTrue(AuditLog.objects.filter(action='media.downloaded').exists())
        self.assertNotIn('media.downloaded', {row['action'] for row in self.feed()['results']})


class FeedPermissionTests(ActivityBase, TestCase):
    def setUp(self):
        super().setUp()
        self.media = self.upload()
        self.client_note = self.comment(self.media['id'], 'Client can read this')
        self.team_note = self.comment(self.media['id'], 'INTERNAL grade is off', visibility='team')
        self.as_user(self.owner)
        self.team_reply = self.client.post(
            reverse('api-review-comments', args=[self.workspace.id, self.project_id, self.media['id']]),
            {'text': 'INTERNAL agreed', 'parent_comment_id': self.team_note['id']}, format='json',
        ).json()
        self.client.post(
            reverse('api-review-comment-resolution', args=[self.workspace.id, self.project_id, self.media['id'], self.team_note['id']]),
            {'resolved': True}, format='json',
        )
        self.task = self.make_task('Project task')
        self.as_user(self.owner)
        self.internal_task = self.client.post(reverse('api-tasks', args=[self.workspace.id]), {'title': 'INTERNAL payroll'}, format='json').json()

    def test_team_members_see_team_notes(self):
        actions = [(row['action'], row['team_only']) for row in self.feed()['results']]
        self.assertIn(('review.comment.created', True), actions)
        self.assertIn(('review.comment.resolved', True), actions)
        self.assertIn('INTERNAL payroll', {row['object']['label'] for row in self.feed()['results'] if row['object']})

    def test_client_team_members_never_see_team_notes_or_internal_tasks(self):
        client_user = self.add_client_member()
        for project in (None, self.project_id):
            self.as_user(client_user)
            url = reverse('api-project-activity', args=[self.workspace.id, project]) if project else reverse('api-workspace-activity', args=[self.workspace.id])
            response = self.client.get(url, {'page_size': 100})
            self.assertEqual(response.status_code, 200, response.content)
            body = response.content.decode()
            self.assertNotIn('INTERNAL', body)
            self.assertNotIn(self.team_note['id'], body)
            self.assertNotIn(self.team_reply['id'], body)
            rows = response.json()['results']
            self.assertFalse(any(row['team_only'] for row in rows))
            self.assertEqual(response.json()['count'], len(rows))
            comments = [row for row in rows if row['action'] == 'review.comment.created']
            self.assertEqual([row['detail']['excerpt'] for row in comments], ['Client can read this'])
            self.assertIn('Project task', {row['object']['label'] for row in rows if row['object']})
            self.assertFalse(response.json()['can_export'])

    def test_a_note_made_team_only_later_still_stays_hidden(self):
        client_user = self.add_client_member()
        from .models import ReviewComment
        ReviewComment.objects.filter(id=self.client_note['id']).update(visibility='team')
        rows = self.feed(user=client_user)['results']
        self.assertNotIn('Client can read this', str(rows))

    def test_members_only_see_projects_they_can_access(self):
        self.invite_and_accept(project_access_mode=ProjectAccessMode.SELECTED)
        rows = self.feed(user=self.member_user)['results']
        self.assertEqual([row for row in rows if row['project']], [])
        self.as_user(self.member_user)
        self.assertEqual(self.client.get(reverse('api-project-activity', args=[self.workspace.id, self.project_id])).status_code, 404)

    def test_guest_link_events_need_the_manage_permission(self):
        self.guest_link()
        viewer = Role.objects.create(id=uuid.uuid4(), workspace=self.workspace, name='Read only', status='ACTIVE', created_by_user=self.owner, created_at=timezone.now(), updated_at=timezone.now())
        from .models import RolePermission
        from .permissions import MEDIA_READ, PROJECT_READ, REVIEW_COMMENT_READ, TASK_READ, WORKSPACE_READ
        RolePermission.objects.bulk_create([RolePermission(role=viewer, permission_key=key) for key in (WORKSPACE_READ, PROJECT_READ, MEDIA_READ, REVIEW_COMMENT_READ, TASK_READ)])
        self.member_role = viewer
        self.invite_and_accept()
        categories = {row['category'] for row in self.feed(user=self.member_user)['results']}
        self.assertNotIn('guests', categories)
        self.assertIn('guests', {row['category'] for row in self.feed()['results']})

    def test_guests_and_outsiders_get_nothing(self):
        _, headers = self.guest_link()
        self.client.force_authenticate(user=None)
        url = reverse('api-workspace-activity', args=[self.workspace.id])
        self.assertIn(self.client.get(url, **headers).status_code, (401, 403))
        self.assertIn(self.client.get(reverse('api-project-activity', args=[self.workspace.id, self.project_id]), **headers).status_code, (401, 403))
        self.assertIn(self.client.get(reverse('api-workspace-activity-export', args=[self.workspace.id]), **headers).status_code, (401, 403))
        user_model = WorkspaceMembership._meta.get_field('user').remote_field.model
        outsider = user_model.objects.create_user(email='outsider@example.com', password='a-secure-test-password', first_name='Out', last_name='Sider')
        self.as_user(outsider)
        self.assertEqual(self.client.get(url).status_code, 403)


class FeedCsvTests(ActivityBase, TestCase):
    def test_owner_exports_csv(self):
        task = self.make_task('=HYPERLINK("x")')
        self.move(task['id'], 'review')
        response = self.client.get(reverse('api-workspace-activity-export', args=[self.workspace.id]), {'type': 'tasks'})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response['Content-Type'].startswith('text/csv'))
        self.assertIn('attachment;', response['Content-Disposition'])
        rows = list(csv.reader(io.StringIO(response.content.decode())))
        self.assertEqual(rows[0][:6], ['time_utc', 'actor', 'actor_type', 'category', 'action', 'summary'])
        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[1][4], 'task.stage.moved')
        self.assertIn('from To Do → Review', rows[1][5])
        # Cells that a spreadsheet would run as a formula are neutralised.
        self.assertTrue(rows[1][7].startswith("'="))
        self.assertEqual(self.feed()['can_export'], True)

    def test_project_export_and_permission(self):
        self.make_task()
        response = self.client.get(reverse('api-project-activity-export', args=[self.workspace.id, self.project_id]))
        self.assertEqual(response.status_code, 200)
        self.invite_and_accept()
        self.as_user(self.member_user)
        self.assertEqual(self.client.get(reverse('api-workspace-activity-export', args=[self.workspace.id])).status_code, 403)
        self.assertFalse(self.feed(user=self.member_user)['can_export'])

    def test_export_respects_team_note_scoping(self):
        media = self.upload()
        self.comment(media['id'], 'INTERNAL', visibility='team')
        body = self.client.get(reverse('api-workspace-activity-export', args=[self.workspace.id])).content.decode()
        self.assertIn('commented on', body)


class ScopeResolutionTests(ActivityBase, TestCase):
    def test_existing_actions_get_their_project_and_team_flag(self):
        media = self.upload()
        team = self.comment(media['id'], 'x', visibility='team')
        upload = AuditLog.objects.get(action='media.uploaded')
        self.assertEqual(str(upload.project_id), self.project_id)
        created = AuditLog.objects.get(action='review.comment.created', entity_id=team['id'])
        self.assertTrue(created.team_only)
        self.assertEqual(resolve_audit_scope('review_comment', team['id'])[1], True)
        self.assertEqual(str(resolve_audit_scope('media_version', media['id'])[0]), self.project_id)
        self.assertEqual(resolve_audit_scope('task', 'not-a-uuid'), (None, False))
