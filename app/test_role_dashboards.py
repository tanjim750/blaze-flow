"""Role-based dashboards: the viewer's dashboard role, their notes to address and cuts, the
team workload aggregate, and the activity feed's "my work" filter."""
import shutil
import tempfile
import uuid
from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .models import (
    File, MediaVersion, ProjectAccessMode, ResourceAccess, ReviewComment, Role, RoleStatus, Task,
    WorkflowStage, WorkspaceMembership,
)
from .permissions import (
    CLIENT_TEAM_MANAGE, MEMBER_PERMISSION_KEYS, PROJECT_READ, ROLE_MANAGE, TASK_READ, WORKSPACE_MANAGE,
    WORKSPACE_MEMBERS_MANAGE, WORKSPACE_READ,
)
from .services.dashboard import OWNER_DASHBOARD_PERMISSIONS, dashboard_role
from .services.roles import create_role
from .services.tasks import link_task_attachment
from .test_access_projects import WorkspaceAccessSetupMixin


def _user(email, first='Test', last='User'):
    model = WorkspaceMembership._meta.get_field('user').remote_field.model
    return model.objects.create_user(email=email, password='a-secure-test-password', first_name=first, last_name=last)


class DashboardBase(WorkspaceAccessSetupMixin):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='blazeflow-role-dashboards-')
        self.settings_override = override_settings(MEDIA_ROOT=self.media_root)
        self.settings_override.enable()
        super().setUp()
        self.as_user(self.owner)
        self.project_id = self.client.post(reverse('api-projects', args=[self.workspace.id]), {'name': 'Spring Launch'}, format='json').json()['id']

    def tearDown(self):
        self.settings_override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)
        super().tearDown()

    # -- helpers --------------------------------------------------------------------
    def as_user(self, user):
        self.client.force_authenticate(user)

    def listed_workspace(self, user):
        self.as_user(user)
        response = self.client.get(reverse('api-workspaces'))
        self.assertEqual(response.status_code, 200)
        return next((row for row in response.json() if row['id'] == str(self.workspace.id)), None)

    def add_member(self, email, *, role=None, mode=ProjectAccessMode.ALL, first='Ed', last='Itor'):
        """A workspace user with ``role`` (the Member role by default)."""
        user = _user(email, first, last)
        now = timezone.now()
        membership = WorkspaceMembership.objects.create(
            id=uuid.uuid4(), workspace=self.workspace, principal_type='USER', user=user,
            role=role or self.member_role, project_access_mode=mode, status='ACTIVE',
            joined_at=now, created_at=now, updated_at=now,
        )
        return user, membership

    def custom_role(self, name, keys):
        return create_role(workspace=self.workspace, created_by_user=self.owner, name=name, permission_keys=keys)

    def add_client_member(self, email='cleo@client.example', *, role=None, team_name='Acme'):
        """A user who is in the workspace only through a client team."""
        user = _user(email, 'Cleo', 'Client')
        self.as_user(self.owner)
        team = self.client.post(reverse('api-client-teams', args=[self.workspace.id]), {'name': team_name}, format='json').json()
        added = self.client.post(reverse('api-client-team-members', args=[self.workspace.id, team['id']]), {'email': user.email}, format='json')
        self.assertEqual(added.status_code, 201, added.content)
        granted = self.client.post(
            reverse('api-client-team-workspace-access', args=[self.workspace.id, team['id']]),
            {'role_id': str((role or self.member_role).id), 'project_access_mode': 'ALL'}, format='json',
        )
        self.assertEqual(granted.status_code, 201, granted.content)
        return user

    def upload(self, user=None, title='Hero 30s'):
        self.as_user(user or self.owner)
        response = self.client.post(
            reverse('api-media-versions', args=[self.workspace.id, self.project_id]),
            {'file': SimpleUploadedFile('frame.png', b'\x89PNG\r\n\x1a\n' + title.encode(), content_type='image/png'), 'title': title},
            format='multipart',
        )
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def note(self, user, media_id, text, **extra):
        self.as_user(user)
        response = self.client.post(
            reverse('api-review-comments', args=[self.workspace.id, self.project_id, media_id]),
            {'text': text, **extra}, format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def task(self, title, assignee=None, *, due_at=None, project=True, **extra):
        self.as_user(self.owner)
        payload = {'title': title, **extra}
        if project:
            payload['project_id'] = self.project_id
        if assignee is not None:
            payload['assignee_id'] = str(assignee.id)
        if due_at is not None:
            payload['due_at'] = due_at.isoformat()
        response = self.client.post(reverse('api-tasks', args=[self.workspace.id]), payload, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def link(self, task, media):
        link_task_attachment(
            task=Task.objects.get(id=task['id']), file=File.objects.get(id=media['file']['id']), membership=self.owner_membership,
        )

    def get(self, name, user, **params):
        self.as_user(user)
        return self.client.get(reverse(name, args=[self.workspace.id]), params)

    def notes(self, user, **params):
        response = self.get('api-dashboard-notes-to-address', user, **params)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()


class DashboardRoleTests(DashboardBase, TestCase):
    def test_the_primary_owner_is_an_owner(self):
        self.assertEqual(self.listed_workspace(self.owner)['dashboard_role'], 'owner')

    def test_a_member_is_an_editor(self):
        user, _ = self.add_member('editor@example.com')
        self.assertEqual(self.listed_workspace(user)['dashboard_role'], 'editor')

    def test_each_management_permission_alone_makes_an_owner(self):
        for index, key in enumerate(OWNER_DASHBOARD_PERMISSIONS):
            role = self.custom_role(f'Custom {index}', [WORKSPACE_READ, PROJECT_READ, key])
            user, _ = self.add_member(f'admin{index}@example.com', role=role)
            self.assertEqual(self.listed_workspace(user)['dashboard_role'], 'owner', key)
        self.assertEqual(set(OWNER_DASHBOARD_PERMISSIONS), {WORKSPACE_MANAGE, WORKSPACE_MEMBERS_MANAGE, ROLE_MANAGE, CLIENT_TEAM_MANAGE})

    def test_it_follows_permissions_not_role_names(self):
        # Named like an admin, but can only do member things: an editor.
        named_admin = self.custom_role('Admin', list(MEMBER_PERMISSION_KEYS))
        user, _ = self.add_member('named-admin@example.com', role=named_admin)
        self.assertEqual(self.listed_workspace(user)['dashboard_role'], 'editor')
        # Named like a junior, but manages people: an owner.
        named_junior = self.custom_role('Junior editor', [WORKSPACE_READ, WORKSPACE_MEMBERS_MANAGE])
        junior, _ = self.add_member('junior@example.com', role=named_junior)
        self.assertEqual(self.listed_workspace(junior)['dashboard_role'], 'owner')

    def test_a_read_only_member_is_an_editor_not_a_client(self):
        viewer = self.custom_role('Viewer', [WORKSPACE_READ, PROJECT_READ, TASK_READ])
        user, _ = self.add_member('viewer@example.com', role=viewer)
        self.assertEqual(self.listed_workspace(user)['dashboard_role'], 'editor')

    def test_an_archived_role_grants_no_owner_powers(self):
        role = self.custom_role('Ops', [WORKSPACE_READ, WORKSPACE_MANAGE])
        user, _ = self.add_member('ops@example.com', role=role)
        Role.objects.filter(id=role.id).update(status=RoleStatus.ARCHIVED)
        self.assertEqual(dashboard_role(user=user, workspace=self.workspace), 'editor')

    def test_a_client_team_member_is_a_client_even_with_a_managing_role(self):
        client = self.add_client_member()
        self.assertEqual(self.listed_workspace(client)['dashboard_role'], 'client')
        self.assertIsNone(self.listed_workspace(client)['my_membership_id'])
        powerful = self.add_client_member('boss@client.example', role=Role.objects.get(workspace=self.workspace, name='Owner'), team_name='Bigco')
        self.assertEqual(self.listed_workspace(powerful)['dashboard_role'], 'client')

    def test_a_team_member_who_is_also_on_a_client_team_is_not_a_client(self):
        user, _ = self.add_member('both@example.com')
        self.as_user(self.owner)
        team = self.client.post(reverse('api-client-teams', args=[self.workspace.id]), {'name': 'Dual'}, format='json').json()
        self.client.post(reverse('api-client-team-members', args=[self.workspace.id, team['id']]), {'email': user.email}, format='json')
        self.assertEqual(self.listed_workspace(user)['dashboard_role'], 'editor')

    def test_no_role_without_access(self):
        outsider = _user('outsider@example.com')
        self.assertIsNone(dashboard_role(user=outsider, workspace=self.workspace))
        self.assertIsNone(self.listed_workspace(outsider))


class NotesToAddressTests(DashboardBase, TestCase):
    def setUp(self):
        super().setUp()
        self.editor, self.editor_membership = self.add_member('editor@example.com', first='Maya', last='Chen')
        self.reviewer, _ = self.add_member('reviewer@example.com', first='Priya', last='Shah')

    def test_lists_unresolved_notes_from_others_on_cuts_i_uploaded_with_a_timecode_link(self):
        mine = self.upload(self.editor, 'Hero 30s')
        note = self.note(self.reviewer, mine['id'], 'Pull saturation 10%', start_time_ms=5200)
        self.note(self.editor, mine['id'], 'My own reminder')  # mine: not something to address
        resolved = self.note(self.reviewer, mine['id'], 'Already fixed')
        ReviewComment.objects.filter(id=resolved['id']).update(resolved=True)
        deleted = self.note(self.reviewer, mine['id'], 'Deleted')
        ReviewComment.objects.filter(id=deleted['id']).update(deleted_at=timezone.now())
        self.note(self.owner, mine['id'], 'On it', parent_comment_id=note['id'])  # a reply, counted not listed

        data = self.notes(self.editor)
        self.assertEqual(data['count'], 1)
        [row] = data['results']
        self.assertEqual(row['id'], note['id'])
        self.assertEqual(row['text'], 'Pull saturation 10%')
        self.assertEqual(row['start_time_ms'], 5200)
        self.assertEqual(row['author']['name'], 'Priya Shah')
        self.assertEqual(row['reply_count'], 1)
        self.assertEqual(row['reasons'], ['uploaded'])
        self.assertEqual(row['media']['title'], 'Hero 30s')
        self.assertEqual(row['media']['project']['name'], 'Spring Launch')
        self.assertEqual(row['href'], f"/review?media={mine['file']['id']}&comment={note['id']}&t=5200")

    def test_a_note_without_a_timecode_links_to_the_note_only(self):
        mine = self.upload(self.editor)
        note = self.note(self.reviewer, mine['id'], 'General note')
        [row] = self.notes(self.editor)['results']
        self.assertEqual(row['href'], f"/review?media={mine['file']['id']}&comment={note['id']}")

    def test_includes_cuts_linked_to_a_task_assigned_to_me(self):
        cut = self.upload(self.owner, 'Owner upload')
        note = self.note(self.reviewer, cut['id'], 'Fix the super')
        self.assertEqual(self.notes(self.editor)['count'], 0)
        task = self.task('Apply notes', self.editor_membership)
        self.link(task, cut)
        [row] = self.notes(self.editor)['results']
        self.assertEqual(row['id'], note['id'])
        self.assertEqual(row['reasons'], ['assigned'])
        # The owner uploaded it, so it is theirs too — and someone else wrote the note.
        self.assertEqual(self.notes(self.owner)['results'][0]['reasons'], ['uploaded'])

    def test_a_task_link_counts_only_for_the_assignee_and_only_while_the_task_lives(self):
        cut = self.upload(self.owner)
        self.note(self.reviewer, cut['id'], 'Note')
        task = self.task('Unassigned task')
        self.link(task, cut)
        self.assertEqual(self.notes(self.editor)['count'], 0)
        assigned = self.task('Assigned task', self.editor_membership)
        self.link(assigned, cut)
        self.assertEqual(self.notes(self.editor)['count'], 1)
        Task.objects.filter(id=assigned['id']).update(deleted_at=timezone.now())
        self.assertEqual(self.notes(self.editor)['count'], 0)

    def test_other_peoples_cuts_are_not_mine(self):
        theirs = self.upload(self.reviewer)
        self.note(self.owner, theirs['id'], 'For Priya')
        self.assertEqual(self.notes(self.editor)['count'], 0)
        self.assertEqual(self.notes(self.reviewer)['count'], 1)

    def test_needs_project_access(self):
        user, membership = self.add_member('selected@example.com', mode=ProjectAccessMode.SELECTED)
        now = timezone.now()
        grant = ResourceAccess.objects.create(id=uuid.uuid4(), workspace_membership=membership, project_id=self.project_id, created_at=now)
        cut = self.upload(user)
        self.note(self.reviewer, cut['id'], 'Note')
        self.assertEqual(self.notes(user)['count'], 1)
        grant.delete()
        self.assertEqual(self.notes(user)['count'], 0)

    def test_client_team_members_never_get_team_notes(self):
        client = self.add_client_member()
        cut = self.upload(client, 'Client upload')
        client_note = self.note(self.owner, cut['id'], 'Client-visible note', start_time_ms=1000)
        self.note(self.owner, cut['id'], 'Internal: grade is off', visibility='team')
        self.note(self.owner, cut['id'], 'Internal reply', parent_comment_id=client_note['id'], visibility='team')

        data = self.notes(client)
        self.assertEqual([row['id'] for row in data['results']], [client_note['id']])
        self.assertEqual(data['count'], 1)
        self.assertEqual(data['results'][0]['reply_count'], 0)  # the team reply is not even counted
        self.assertNotIn('Internal', str(data))
        # A workspace user who owns the same cut sees both notes and the reply.
        task = self.task('Apply client notes', self.editor_membership)
        self.link(task, cut)
        editor_view = self.notes(self.editor)
        self.assertEqual(editor_view['count'], 2)
        self.assertEqual(next(row for row in editor_view['results'] if row['id'] == client_note['id'])['reply_count'], 1)

    def test_outsiders_and_anonymous_get_nothing(self):
        outsider = _user('outsider@example.com')
        self.assertEqual(self.get('api-dashboard-notes-to-address', outsider).status_code, 403)
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(reverse('api-dashboard-notes-to-address', args=[self.workspace.id])).status_code, (401, 403))

    def test_limit_is_validated_and_applied(self):
        cut = self.upload(self.editor)
        for index in range(3):
            self.note(self.reviewer, cut['id'], f'Note {index}')
        data = self.notes(self.editor, limit=2)
        self.assertEqual((len(data['results']), data['count']), (2, 3))
        self.assertEqual([row['text'] for row in data['results']], ['Note 0', 'Note 1'])  # oldest first
        self.assertEqual(self.get('api-dashboard-notes-to-address', self.editor, limit='x').status_code, 400)
        self.assertEqual(self.get('api-dashboard-notes-to-address', self.editor, limit=0).status_code, 400)


class MyCutsTests(DashboardBase, TestCase):
    def test_lists_my_cuts_with_stage_and_open_note_count(self):
        editor, membership = self.add_member('editor@example.com')
        mine = self.upload(editor, 'Mine')
        linked = self.upload(self.owner, 'Linked')
        self.upload(self.owner, 'Not mine')
        self.link(self.task('Task', membership), linked)
        self.note(self.owner, mine['id'], 'Open note')
        stage = WorkflowStage.objects.get(workspace=self.workspace, slug='in-review')
        self.as_user(self.owner)
        moved = self.client.post(
            reverse('api-media-version-workflow', args=[self.workspace.id, self.project_id, mine['id']]),
            {'workflow_stage_id': str(stage.id)}, format='json',
        )
        self.assertIn(moved.status_code, (200, 201), moved.content)

        response = self.get('api-dashboard-my-cuts', editor)
        self.assertEqual(response.status_code, 200)
        rows = {row['title']: row for row in response.json()['results']}
        self.assertEqual(set(rows), {'Mine', 'Linked'})
        self.assertEqual(rows['Mine']['stage']['name'], 'In Review')
        self.assertEqual(rows['Mine']['open_notes'], 1)
        self.assertEqual(rows['Mine']['reasons'], ['uploaded'])
        self.assertEqual(rows['Linked']['reasons'], ['assigned'])
        self.assertEqual(rows['Mine']['href'], f"/review?media={mine['file']['id']}")

    def test_open_note_counts_skip_team_notes_for_clients(self):
        client = self.add_client_member()
        cut = self.upload(client)
        self.note(self.owner, cut['id'], 'Team only', visibility='team')
        [row] = self.get('api-dashboard-my-cuts', client).json()['results']
        self.assertEqual(row['open_notes'], 0)

    def test_a_cut_being_deleted_is_left_out(self):
        editor, _ = self.add_member('editor@example.com')
        cut = self.upload(editor)
        MediaVersion.objects.filter(id=cut['id']).update(status='PENDING_DELETION')
        self.assertEqual(self.get('api-dashboard-my-cuts', editor).json()['results'], [])


class WorkloadTests(DashboardBase, TestCase):
    def setUp(self):
        super().setUp()
        self.maya, self.maya_m = self.add_member('maya@example.com', first='Maya', last='Chen')
        self.theo, self.theo_m = self.add_member('theo@example.com', first='Theo', last='Park')
        now = timezone.now()
        self.task('Late', self.maya_m, due_at=now - timedelta(days=2))
        self.task('Soon', self.maya_m, due_at=now + timedelta(days=2))
        self.task('Later', self.maya_m, due_at=now + timedelta(days=20))
        self.task('Undated', self.theo_m)
        self.task('Done', self.theo_m, status='COMPLETED', due_at=now - timedelta(days=5))
        deleted = self.task('Deleted', self.theo_m, due_at=now - timedelta(days=5))
        Task.objects.filter(id=deleted['id']).update(deleted_at=now)
        self.task('Nobody', due_at=now - timedelta(days=1))
        self.task('Internal, no project', self.theo_m, project=False)

    def workload(self, user):
        response = self.get('api-dashboard-workload', user)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_counts_open_overdue_and_due_this_week_per_member(self):
        data = self.workload(self.owner)
        rows = {row['user']['name']: row for row in data['results']}
        self.assertEqual((rows['Maya Chen']['open'], rows['Maya Chen']['overdue'], rows['Maya Chen']['due_this_week']), (3, 1, 1))
        self.assertEqual((rows['Theo Park']['open'], rows['Theo Park']['overdue']), (2, 0))
        # Idle people are listed too, so the chart shows who has room.
        self.assertEqual(rows['Access Owner']['open'], 0)
        self.assertEqual(data['unassigned'], {'open': 1, 'overdue': 1})
        self.assertEqual(data['total_open'], 6)
        self.assertEqual(data['results'][0]['user']['name'], 'Maya Chen')  # busiest first
        self.assertEqual(rows['Maya Chen']['membership_id'], str(self.maya_m.id))

    def test_only_owners_and_admins_may_see_it(self):
        self.assertEqual(self.get('api-dashboard-workload', self.maya).status_code, 403)
        client = self.add_client_member()
        self.assertEqual(self.get('api-dashboard-workload', client).status_code, 403)
        self.assertEqual(self.get('api-dashboard-workload', _user('outsider@example.com')).status_code, 403)
        admin_role = self.custom_role('People lead', [WORKSPACE_READ, WORKSPACE_MEMBERS_MANAGE, TASK_READ, PROJECT_READ])
        admin, _ = self.add_member('lead@example.com', role=admin_role)
        self.assertEqual(self.get('api-dashboard-workload', admin).status_code, 200)

    def test_client_teams_are_not_listed_as_people(self):
        self.add_client_member()
        names = [row['user']['name'] for row in self.workload(self.owner)['results']]
        self.assertNotIn('Cleo Client', names)

    def test_counts_only_tasks_the_viewer_could_see(self):
        role = self.custom_role('Ops lead', [WORKSPACE_READ, WORKSPACE_MANAGE, TASK_READ, PROJECT_READ])
        lead, _ = self.add_member('ops@example.com', role=role, mode=ProjectAccessMode.SELECTED)
        rows = {row['user']['name']: row for row in self.workload(lead)['results']}
        # No project access: only the project-less task is visible.
        self.assertEqual(rows['Maya Chen']['open'], 0)
        self.assertEqual(rows['Theo Park']['open'], 1)


class MyWorkActivityTests(DashboardBase, TestCase):
    def test_mine_keeps_others_actions_on_my_tasks_and_cuts(self):
        editor, membership = self.add_member('editor@example.com', first='Maya', last='Chen')
        reviewer, _ = self.add_member('reviewer@example.com', first='Priya', last='Shah')
        my_task = self.task('My task', membership)   # owner creates + assigns: on my work
        self.task('Someone else\'s task')
        cut = self.upload(editor, 'My cut')           # my own action: left out
        self.note(reviewer, cut['id'], 'Note on my cut')
        other = self.upload(reviewer, 'Their cut')
        self.note(self.owner, other['id'], 'Not on my work')

        self.as_user(editor)
        response = self.client.get(reverse('api-workspace-activity', args=[self.workspace.id]), {'mine': '1'})
        self.assertEqual(response.status_code, 200)
        rows = response.json()['results']
        actions = sorted((row['action'], row['object']['label']) for row in rows)
        self.assertIn(('task.created', 'My task'), actions)
        self.assertIn(('review.comment.created', 'Note on my cut'), [(row['action'], row['detail'].get('excerpt')) for row in rows])
        self.assertTrue(all(row['actor']['id'] != str(editor.id) for row in rows))
        self.assertNotIn('Their cut', str(rows))
        self.assertNotIn("Someone else's task", str(rows))
        self.assertEqual(response.json()['count'], len(rows))
        self.assertTrue(any(row['object']['id'] == my_task['id'] for row in rows))

    def test_mine_is_validated(self):
        self.as_user(self.owner)
        self.assertEqual(self.client.get(reverse('api-workspace-activity', args=[self.workspace.id]), {'mine': 'maybe'}).status_code, 400)
