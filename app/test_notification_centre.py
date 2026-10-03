"""The notifications centre: who hears about what, and what they are allowed to hear."""
import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse

from .models import (
    Notification,
    NotificationKind,
    NotificationSetting,
    OutboxEvent,
    WorkflowStage,
    WorkspaceMembership,
)
from .test_access_projects import WorkspaceAccessSetupMixin

K = NotificationKind


class NotificationCentreBase(WorkspaceAccessSetupMixin):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='blazeflow-notification-centre-')
        self.settings_override = override_settings(MEDIA_ROOT=self.media_root, MAX_MEDIA_UPLOAD_BYTES=1024 * 1024)
        self.settings_override.enable()
        super().setUp()
        self.member_membership = self.invite_and_accept()
        self.client.force_authenticate(self.owner)
        self.project_id = self.client.post(
            reverse('api-projects', args=[self.workspace.id]), {'name': 'Spring Launch'}, format='json',
        ).json()['id']

    def tearDown(self):
        self.settings_override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)
        super().tearDown()

    def as_user(self, user):
        self.client.force_authenticate(user)

    def upload(self, title='Hero v1.png', note=''):
        response = self.client.post(
            reverse('api-media-versions', args=[self.workspace.id, self.project_id]),
            {
                'file': SimpleUploadedFile('frame.png', b'\x89PNG\r\n\x1a\n' + title.encode(), content_type='image/png'),
                'title': title,
                'note': note,
            },
            format='multipart',
        )
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()['id']

    def comment(self, media_id, text, **extra):
        response = self.client.post(
            reverse('api-review-comments', args=[self.workspace.id, self.project_id, media_id]),
            {'text': text, **extra}, format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def kinds_for(self, user):
        return sorted(Notification.objects.filter(recipient_user=user).values_list('kind', flat=True))

    def add_client_member(self):
        """Makes a fresh user a client-team member with the Member role on every project."""
        user_model = WorkspaceMembership._meta.get_field('user').remote_field.model
        client_user = user_model.objects.create_user(
            email='client@acme.test', password='a-secure-test-password', first_name='Casey', last_name='Client',
        )
        self.as_user(self.owner)
        team = self.client.post(reverse('api-client-teams', args=[self.workspace.id]), {'name': 'Acme'}, format='json').json()
        self.client.post(reverse('api-client-team-members', args=[self.workspace.id, team['id']]), {'email': client_user.email}, format='json')
        granted = self.client.post(
            reverse('api-client-team-workspace-access', args=[self.workspace.id, team['id']]),
            {'role_id': str(self.member_role.id), 'project_access_mode': 'ALL'}, format='json',
        )
        self.assertEqual(granted.status_code, 201, granted.content)
        return client_user


class CommentNotificationTests(NotificationCentreBase, TestCase):
    def test_comment_on_your_cut_notifies_the_uploader_with_a_deep_link(self):
        media_id = self.upload()
        self.as_user(self.member_user)
        note = self.comment(media_id, 'The logo pops in a frame early', start_time_ms=12_500)

        notification = Notification.objects.get(recipient_user=self.owner)
        self.assertEqual(notification.kind, K.REVIEW_COMMENT_NEW)
        self.assertEqual(notification.actor_user, self.member_user)
        self.assertEqual(notification.payload['excerpt'], 'The logo pops in a frame early')
        self.assertEqual(notification.payload['version_number'], 1)
        self.assertIn(f"comment={note['id']}", notification.payload['link'])
        self.assertIn('t=12500', notification.payload['link'])
        self.assertTrue(notification.payload['link'].startswith('/review?media='))
        # No email channel for this kind, so no outbox noise.
        self.assertFalse(OutboxEvent.objects.filter(topic='notification.created').exists())

    def test_commenting_on_your_own_cut_notifies_nobody(self):
        media_id = self.upload()
        self.comment(media_id, 'Note to self')
        self.assertFalse(Notification.objects.exists())

    def test_reply_notifies_the_parent_author_once_not_twice(self):
        media_id = self.upload()
        self.as_user(self.member_user)
        parent = self.comment(media_id, 'Can we cut the intro?')
        self.as_user(self.owner)
        self.comment(media_id, 'Yes, trimming it', parent_comment_id=parent['id'])
        self.assertEqual(self.kinds_for(self.member_user), [K.REVIEW_COMMENT_REPLY])
        # The owner wrote the reply on their own cut: nothing for them.
        self.assertEqual(self.kinds_for(self.owner), [K.REVIEW_COMMENT_NEW])

    def test_replying_to_yourself_is_not_a_notification(self):
        media_id = self.upload()
        parent = self.comment(media_id, 'First')
        self.comment(media_id, 'Second thought', parent_comment_id=parent['id'])
        self.assertFalse(Notification.objects.exists())

    def test_a_mention_wins_over_a_reply_and_a_cut_note(self):
        media_id = self.upload()
        self.as_user(self.member_user)
        parent = self.comment(media_id, 'Question for you')
        self.as_user(self.owner)
        self.comment(media_id, 'Answering', parent_comment_id=parent['id'], mentioned_user_ids=[str(self.member_user.id)])
        self.assertEqual(self.kinds_for(self.member_user), [K.REVIEW_COMMENT_MENTION])

    def test_assignees_of_a_task_with_the_cut_attached_hear_about_notes(self):
        media_id = self.upload()
        file_id = self.client.get(
            reverse('api-media-version-detail', args=[self.workspace.id, self.project_id, media_id])
        ).json()['file']['id']
        task = self.client.post(reverse('api-tasks', args=[self.workspace.id]), {
            'title': 'Grade the hero cut', 'project_id': self.project_id, 'assignee_id': str(self.member_membership.id),
        }, format='json').json()
        attached = self.client.post(
            reverse('api-task-attachments', args=[self.workspace.id, task['id']]), {'file_id': file_id}, format='json',
        )
        self.assertEqual(attached.status_code, 201, attached.content)
        Notification.objects.all().delete()
        self.comment(media_id, 'Owner note on the cut')
        self.assertEqual(self.kinds_for(self.member_user), [K.REVIEW_COMMENT_NEW])

    def test_guest_comment_notifies_the_uploader_with_the_guest_name(self):
        media_id = self.upload()
        invite = self.client.post(
            reverse('api-project-guest-invites', args=[self.workspace.id, self.project_id]),
            {'label': 'Client', 'permissions': ['media.read', 'review.comment.read', 'review.comment.create'], 'expires_in_hours': 24},
            format='json',
        ).json()
        self.client.force_authenticate(user=None)
        key = self.client.post(
            reverse('api-guest-exchange'), {'token': invite['token'], 'name': 'Dana Guest', 'email': 'dana@example.com'}, format='json',
        ).json()['access_key']
        posted = self.client.post(
            reverse('api-guest-comments', args=[self.project_id, media_id]), {'text': 'Love it'},
            format='json', HTTP_X_GUEST_ACCESS_KEY=key,
        )
        self.assertEqual(posted.status_code, 201, posted.content)
        notification = Notification.objects.get(recipient_user=self.owner)
        self.assertEqual(notification.kind, K.REVIEW_COMMENT_NEW)
        self.assertIsNone(notification.actor_user)
        self.as_user(self.owner)
        row = self.client.get(reverse('api-notifications'), {'page': 1}).json()['results'][0]
        self.assertEqual(row['actor']['name'], 'Dana Guest')
        self.assertTrue(row['actor']['is_guest'])


class TeamNoteLeakTests(NotificationCentreBase, TestCase):
    def test_team_only_reply_never_reaches_a_client_member(self):
        client_user = self.add_client_member()
        media_id = self.upload()
        self.as_user(client_user)
        client_note = self.comment(media_id, 'Can the music be warmer?')
        Notification.objects.all().delete()
        self.as_user(self.owner)
        self.comment(media_id, 'Internal: the client is wrong', parent_comment_id=client_note['id'], visibility='team')
        self.assertEqual(self.kinds_for(client_user), [])

    def test_team_note_on_a_client_uploaded_cut_skips_the_client_uploader(self):
        client_user = self.add_client_member()
        self.as_user(client_user)
        media_id = self.upload('Client supplied logo.png')
        self.as_user(self.owner)
        self.comment(media_id, 'Internal: resolution too low', visibility='team')
        self.assertEqual(self.kinds_for(client_user), [])
        self.comment(media_id, 'Could you send a higher-resolution logo?')
        self.assertEqual(self.kinds_for(client_user), [K.REVIEW_COMMENT_NEW])

    def test_team_notes_still_reach_teammates(self):
        media_id = self.upload()
        self.as_user(self.member_user)
        self.comment(media_id, 'Internal: needs a regrade', visibility='team')
        notification = Notification.objects.get(recipient_user=self.owner)
        self.assertTrue(notification.payload['team_only'])


class StageAndVersionNotificationTests(NotificationCentreBase, TestCase):
    def stage(self, slug):
        return WorkflowStage.objects.get(workspace=self.workspace, slug=slug)

    def test_approval_notifies_the_uploader_not_the_approver(self):
        self.as_user(self.member_user)
        media_id = self.upload()
        self.as_user(self.owner)
        response = self.client.post(
            reverse('api-media-version-workflow', args=[self.workspace.id, self.project_id, media_id]),
            {'workflow_stage_id': str(self.stage('approved').id)}, format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(self.kinds_for(self.member_user), [K.MEDIA_APPROVED])
        self.assertEqual(self.kinds_for(self.owner), [])

    def test_moving_to_a_neutral_stage_is_silent(self):
        self.as_user(self.member_user)
        media_id = self.upload()
        self.as_user(self.owner)
        self.client.post(
            reverse('api-media-version-workflow', args=[self.workspace.id, self.project_id, media_id]),
            {'workflow_stage_id': str(self.stage('in-review').id)}, format='json',
        )
        self.assertFalse(Notification.objects.exists())

    def test_request_changes_sends_one_notification_quoting_the_note(self):
        self.as_user(self.member_user)
        media_id = self.upload()
        self.as_user(self.owner)
        response = self.client.post(
            reverse('api-media-revision-request', args=[self.workspace.id, self.project_id, media_id]),
            {'text': 'Swap the end card', 'start_time_ms': 28_000}, format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        notification = Notification.objects.get(recipient_user=self.member_user)
        self.assertEqual(notification.kind, K.MEDIA_CHANGES_REQUESTED)
        self.assertEqual(notification.payload['excerpt'], 'Swap the end card')
        self.assertIn('t=28000', notification.payload['link'])

    def test_new_version_notifies_commenters_on_earlier_cuts_of_the_same_file(self):
        v1 = self.upload('Hero v1.png')
        self.as_user(self.member_user)
        self.comment(v1, 'Shorter please')
        self.as_user(self.owner)
        Notification.objects.all().delete()
        v2 = self.upload('Hero v2.png', note='Trimmed by 3s')
        notification = Notification.objects.get(recipient_user=self.member_user)
        self.assertEqual(notification.kind, K.MEDIA_VERSION_NEW)
        self.assertEqual(notification.payload['media_version_id'], v2)
        self.assertEqual(notification.payload['excerpt'], 'Trimmed by 3s')
        self.assertEqual(self.kinds_for(self.owner), [])

    def test_an_unrelated_upload_notifies_nobody(self):
        v1 = self.upload('Hero v1.png')
        self.as_user(self.member_user)
        self.comment(v1, 'Shorter please')
        self.as_user(self.owner)
        Notification.objects.all().delete()
        self.upload('Cutdown 15s.png')
        self.assertFalse(Notification.objects.exists())


class TaskAssignmentNotificationTests(NotificationCentreBase, TestCase):
    def test_assigning_someone_notifies_them_with_the_task_link(self):
        task = self.client.post(reverse('api-tasks', args=[self.workspace.id]), {
            'title': 'Cut the 15s version', 'assignee_id': str(self.member_membership.id),
        }, format='json').json()
        notification = Notification.objects.get(recipient_user=self.member_user)
        self.assertEqual(notification.kind, K.TASK_ASSIGNED)
        self.assertEqual(notification.payload['link'], f"/tasks?task={task['id']}")
        self.assertEqual(notification.payload['title'], 'Cut the 15s version')

    def test_assigning_yourself_is_silent(self):
        self.client.post(reverse('api-tasks', args=[self.workspace.id]), {
            'title': 'My own task', 'assignee_id': str(self.owner_membership.id),
        }, format='json')
        self.assertFalse(Notification.objects.exists())

    def test_assignee_endpoint_and_patch_also_notify(self):
        task = self.client.post(reverse('api-tasks', args=[self.workspace.id]), {'title': 'Later'}, format='json').json()
        self.client.post(
            reverse('api-task-assignees', args=[self.workspace.id, task['id']]),
            {'membership_id': str(self.member_membership.id)}, format='json',
        )
        self.assertEqual(self.kinds_for(self.member_user), [K.TASK_ASSIGNED])


class PreferenceTests(NotificationCentreBase, TestCase):
    def prefs_url(self):
        return reverse('api-notification-preferences')

    def test_switching_a_kind_off_stops_it_in_that_workspace(self):
        self.as_user(self.owner)
        response = self.client.patch(self.prefs_url(), {
            'workspace_id': str(self.workspace.id), 'in_app': {K.REVIEW_COMMENT_NEW: False},
        }, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(response.json()['in_app'][K.REVIEW_COMMENT_NEW])
        self.assertTrue(response.json()['in_app'][K.REVIEW_COMMENT_REPLY])
        media_id = self.upload()
        self.as_user(self.member_user)
        self.comment(media_id, 'Owner will not hear about this')
        self.assertEqual(self.kinds_for(self.owner), [])

    def test_mentions_switched_off_create_no_notification_or_email_event(self):
        NotificationSetting.objects.create(user=self.member_user, workspace=self.workspace, kind=K.REVIEW_COMMENT_MENTION, in_app_enabled=False)
        media_id = self.upload()
        self.comment(media_id, 'Hey', mentioned_user_ids=[str(self.member_user.id)])
        self.assertEqual(self.kinds_for(self.member_user), [])
        self.assertFalse(OutboxEvent.objects.filter(topic='notification.created').exists())

    def test_task_assignment_switch_is_honoured(self):
        NotificationSetting.objects.create(user=self.member_user, workspace=self.workspace, kind=K.TASK_ASSIGNED, in_app_enabled=False)
        self.client.post(reverse('api-tasks', args=[self.workspace.id]), {
            'title': 'Quiet', 'assignee_id': str(self.member_membership.id),
        }, format='json')
        self.assertEqual(self.kinds_for(self.member_user), [])

    def test_get_lists_every_kind_on_by_default_and_the_email_toggle(self):
        response = self.client.get(self.prefs_url(), {'workspace': str(self.workspace.id)})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data['email_mentions_enabled'])
        self.assertTrue(all(data['in_app'].values()))
        self.assertIn(K.TASK_ASSIGNED, [row['kind'] for row in data['kinds']])

    def test_unknown_kinds_and_foreign_workspaces_are_refused(self):
        bad = self.client.patch(self.prefs_url(), {'workspace_id': str(self.workspace.id), 'in_app': {'NOPE': False}}, format='json')
        self.assertEqual(bad.status_code, 400)
        not_bool = self.client.patch(self.prefs_url(), {'workspace_id': str(self.workspace.id), 'in_app': {K.TASK_ASSIGNED: 'no'}}, format='json')
        self.assertEqual(not_bool.status_code, 400)
        user_model = WorkspaceMembership._meta.get_field('user').remote_field.model
        outsider = user_model.objects.create_user(email='out@example.com', password='a-secure-test-password', first_name='O', last_name='S')
        self.as_user(outsider)
        self.assertEqual(self.client.get(self.prefs_url(), {'workspace': str(self.workspace.id)}).status_code, 403)

    def test_email_toggle_still_saves_on_its_own(self):
        response = self.client.patch(self.prefs_url(), {'email_mentions_enabled': False}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()['email_mentions_enabled'])


class NotificationListTests(NotificationCentreBase, TestCase):
    def make_notifications(self, count):
        media_id = self.upload()
        self.as_user(self.member_user)
        for index in range(count):
            self.comment(media_id, f'Note {index}')
        self.as_user(self.owner)

    def test_paged_list_carries_counts_link_snippet_and_actor(self):
        self.make_notifications(3)
        response = self.client.get(reverse('api-notifications'), {'page': 1, 'page_size': 2, 'workspace': str(self.workspace.id)})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['count'], 3)
        self.assertEqual(data['unread_count'], 3)
        self.assertTrue(data['has_next'])
        first = data['results'][0]
        self.assertEqual(first['snippet'], 'Note 2')
        self.assertTrue(first['link'].startswith('/review?media='))
        self.assertEqual(first['actor']['initials'], 'WM')
        self.assertIsNone(first['poster_url'])
        page_two = self.client.get(reverse('api-notifications'), {'page': 2, 'page_size': 2}).json()
        self.assertEqual(len(page_two['results']), 1)
        self.assertFalse(page_two['has_next'])

    def test_unread_filter_and_mark_one_and_all(self):
        self.make_notifications(2)
        first = Notification.objects.filter(recipient_user=self.owner).order_by('created_at').first()
        self.client.post(reverse('api-notification-read', args=[first.id]))
        unread = self.client.get(reverse('api-notifications'), {'page': 1, 'unread': 'true'}).json()
        self.assertEqual(unread['count'], 1)
        self.assertEqual(unread['unread_count'], 1)
        self.client.post(reverse('api-notifications-read-all'), {'workspace_id': str(self.workspace.id)}, format='json')
        self.assertEqual(self.client.get(reverse('api-notifications'), {'page': 1}).json()['unread_count'], 0)

    def test_plain_list_is_still_an_array_for_older_callers(self):
        self.make_notifications(1)
        response = self.client.get(reverse('api-notifications'))
        self.assertIsInstance(response.json(), list)

    def test_bad_paging_is_a_400(self):
        self.assertEqual(self.client.get(reverse('api-notifications'), {'page': 0}).status_code, 400)
        self.assertEqual(self.client.get(reverse('api-notifications'), {'page': 1, 'page_size': 500}).status_code, 400)
        self.assertEqual(self.client.get(reverse('api-notifications'), {'page': 1, 'workspace': 'nope'}).status_code, 400)


class LegacyLinkTests(NotificationCentreBase, TestCase):
    def test_rows_written_before_links_still_get_one(self):
        Notification.objects.create(
            id='00000000-0000-0000-0000-000000000001', recipient_user=self.owner, workspace=self.workspace,
            kind=K.TASK_CLIENT_READY, entity_type='task', entity_id='t1',
            payload={'task_id': 'abc', 'title': 'Old'}, created_at='2026-09-01T10:00:00Z',
        )
        row = self.client.get(reverse('api-notifications'), {'page': 1}).json()['results'][0]
        self.assertEqual(row['link'], '/tasks?task=abc')


