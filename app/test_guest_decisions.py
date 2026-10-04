"""Client decisions on an exact cut: from a review link (guests) and from the signed-in
review page (client-team members), plus guest playback and the client review page's reads."""
import shutil
import tempfile
import uuid
from datetime import timedelta

from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .models import (
    AuditLog, File, FileStatus, FileVariant, GuestInvite, MediaVersion, MediaVersionStageEntry, Notification,
    ReviewComment, ReviewDecision, Task, WorkspaceMembership,
)
from .permissions import REVIEW_DECISION_CREATE
from .services.roles import create_role
from .services.tasks import link_task_attachment
from .test_access_projects import WorkspaceAccessSetupMixin

GUEST_COMMENT = ['media.read', 'review.comment.read', 'review.comment.create', 'annotation.read']
GUEST_DECIDE = GUEST_COMMENT + ['review.decision.create']
# The demo "Client reviewer" role: reads and comments, no workflow or decision rights.
CLIENT_REVIEWER_KEYS = [
    'workspace.read', 'project.read', 'media.read', 'media.download', 'review.comment.read',
    'review.comment.create', 'review.reaction.create', 'annotation.read', 'annotation.create',
]
PAYLOAD = bytes(range(256)) * 64


def _user(email, first='Test', last='User'):
    model = WorkspaceMembership._meta.get_field('user').remote_field.model
    return model.objects.create_user(email=email, password='a-secure-test-password', first_name=first, last_name=last)


class DecisionBase(WorkspaceAccessSetupMixin):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='blazeflow-decisions-')
        self.settings_override = override_settings(MEDIA_ROOT=self.media_root)
        self.settings_override.enable()
        super().setUp()
        self.editor, self.editor_membership = self.add_member('maya@studio.test', 'Maya', 'Editor')
        self.assignee, self.assignee_membership = self.add_member('ari@studio.test', 'Ari', 'Assist')
        self.as_user(self.owner)
        self.project_id = self.client.post(reverse('api-projects', args=[self.workspace.id]), {'name': 'Spring Launch'}, format='json').json()['id']
        self.v1 = self.upload(self.editor)
        self.v2 = self.upload(self.editor)
        task = self.client.post(reverse('api-tasks', args=[self.workspace.id]), {
            'title': 'Hero cut', 'project_id': self.project_id, 'assignee_id': str(self.assignee_membership.id),
        }, format='json').json()
        link_task_attachment(task=Task.objects.get(id=task['id']), file=File.objects.get(id=self.v2['file']['id']), membership=self.owner_membership)

    def tearDown(self):
        self.settings_override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)
        super().tearDown()

    # -- helpers --------------------------------------------------------------------
    def as_user(self, user):
        self.client.force_authenticate(user)

    def add_member(self, email, first, last, role=None):
        user = _user(email, first, last)
        now = timezone.now()
        membership = WorkspaceMembership.objects.create(
            id=uuid.uuid4(), workspace=self.workspace, principal_type='USER', user=user,
            role=role or self.member_role, project_access_mode='ALL', status='ACTIVE',
            joined_at=now, created_at=now, updated_at=now,
        )
        return user, membership

    def add_client_member(self, keys, email='cleo@client.test'):
        role = create_role(workspace=self.workspace, created_by_user=self.owner, name=f'Client {uuid.uuid4().hex[:6]}', permission_keys=keys)
        user = _user(email, 'Cleo', 'Client')
        self.as_user(self.owner)
        team = self.client.post(reverse('api-client-teams', args=[self.workspace.id]), {'name': f'Acme {email}'}, format='json').json()
        self.assertEqual(self.client.post(reverse('api-client-team-members', args=[self.workspace.id, team['id']]), {'email': user.email}, format='json').status_code, 201)
        granted = self.client.post(
            reverse('api-client-team-workspace-access', args=[self.workspace.id, team['id']]),
            {'role_id': str(role.id), 'project_access_mode': 'ALL'}, format='json',
        )
        self.assertEqual(granted.status_code, 201, granted.content)
        return user

    def upload(self, user, title='Hero 30s'):
        self.as_user(user)
        response = self.client.post(
            reverse('api-media-versions', args=[self.workspace.id, self.project_id]),
            {'file': SimpleUploadedFile('hero.png', b'\x89PNG\r\n\x1a\n' + uuid.uuid4().bytes, content_type='image/png'), 'title': title},
            format='multipart',
        )
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def note(self, media, text, visibility='client', resolved=False):
        self.as_user(self.owner)
        response = self.client.post(
            reverse('api-review-comments', args=[self.workspace.id, self.project_id, media['id']]),
            {'text': text, 'visibility': visibility}, format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        if resolved:
            ReviewComment.objects.filter(id=response.json()['id']).update(resolved=True)
        return response.json()

    def guest_link(self, permissions=GUEST_DECIDE, name='Rachel Kim', email='rachel@northlight.test', hours=24):
        self.as_user(self.owner)
        invite = self.client.post(
            reverse('api-project-guest-invites', args=[self.workspace.id, self.project_id]),
            {'label': 'Client review', 'permissions': permissions, 'expires_in_hours': hours}, format='json',
        )
        self.assertEqual(invite.status_code, 201, invite.content)
        self.client.force_authenticate(user=None)
        exchange = self.client.post(reverse('api-guest-exchange'), {'token': invite.json()['token'], 'name': name, 'email': email}, format='json')
        self.assertEqual(exchange.status_code, 201, exchange.content)
        return invite.json(), {'HTTP_X_GUEST_ACCESS_KEY': exchange.json()['access_key']}

    def decide(self, headers, media, decision, **extra):
        self.client.force_authenticate(user=None)
        return self.client.post(
            reverse('api-guest-decision', args=[self.project_id, media['id']]),
            {'decision': decision, **extra}, format='json', **headers,
        )

    def stage_slug(self, media):
        entry = MediaVersionStageEntry.objects.select_related('workflow_stage').get(media_version_id=media['id'], exited_at__isnull=True)
        return entry.workflow_stage.slug

    def guest_review(self, headers):
        self.client.force_authenticate(user=None)
        response = self.client.get(reverse('api-guest-review', args=[self.project_id]), **headers)
        self.assertEqual(response.status_code, 200, response.content)
        return {item['version_number']: item for item in response.json()['media_versions']}, response.json()['viewer']

    def team_decisions(self, user, media):
        self.as_user(user)
        response = self.client.get(reverse('api-media-version-decisions', args=[self.workspace.id, self.project_id, media['id']]))
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()


class GuestDecisionPermissionTests(DecisionBase, TestCase):
    def test_new_links_say_whether_they_allow_decisions(self):
        with_decisions, _ = self.guest_link(GUEST_DECIDE)
        without, _ = self.guest_link(GUEST_COMMENT)
        self.assertTrue(with_decisions['allow_decisions'])
        self.assertFalse(without['allow_decisions'])
        self.as_user(self.owner)
        listed = {row['id']: row for row in self.client.get(reverse('api-project-guest-invites', args=[self.workspace.id, self.project_id])).json()}
        self.assertTrue(listed[with_decisions['id']]['allow_decisions'])
        self.assertFalse(listed[without['id']]['allow_decisions'])

    def test_a_link_without_decisions_cannot_decide(self):
        _, headers = self.guest_link(GUEST_COMMENT)
        self.assertEqual(self.decide(headers, self.v2, 'approved').status_code, 403)
        self.assertEqual(self.decide(headers, self.v2, 'changes_requested', message='Shorter').status_code, 403)
        self.assertFalse(ReviewDecision.objects.exists())
        self.assertEqual(self.stage_slug(self.v2), 'queued')
        _, viewer = self.guest_review(headers)
        self.assertFalse(viewer['can_decide'])

    def test_deciding_needs_media_read_too(self):
        _, headers = self.guest_link(['review.comment.read', 'review.decision.create'])
        self.assertEqual(self.decide(headers, self.v2, 'approved').status_code, 403)

    def test_revoked_link_revoked_reviewer_and_expired_link_cannot_decide(self):
        invite, headers = self.guest_link()
        self.as_user(self.owner)
        self.client.delete(reverse('api-project-guest-invite-detail', args=[self.workspace.id, self.project_id, invite['id']]))
        self.assertEqual(self.decide(headers, self.v2, 'approved').status_code, 403)

        invite, headers = self.guest_link(email='second@northlight.test')
        self.as_user(self.owner)
        access_id = next(row for row in self.client.get(reverse('api-project-guest-invites', args=[self.workspace.id, self.project_id])).json() if row['id'] == invite['id'])['accesses'][0]['id']
        self.client.delete(reverse('api-project-guest-access-detail', args=[self.workspace.id, self.project_id, access_id]))
        self.assertEqual(self.decide(headers, self.v2, 'approved').status_code, 403)

        invite, headers = self.guest_link(email='third@northlight.test')
        GuestInvite.objects.filter(id=invite['id']).update(expires_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(self.decide(headers, self.v2, 'approved').status_code, 403)
        self.assertFalse(ReviewDecision.objects.exists())

    def test_a_cut_from_another_project_is_not_found(self):
        _, headers = self.guest_link()
        self.as_user(self.owner)
        other = self.client.post(reverse('api-projects', args=[self.workspace.id]), {'name': 'Other'}, format='json').json()
        media = self.client.post(
            reverse('api-media-versions', args=[self.workspace.id, other['id']]),
            {'file': SimpleUploadedFile('o.png', b'\x89PNG\r\n\x1a\nother', content_type='image/png'), 'title': 'Other'},
            format='multipart',
        ).json()
        self.assertEqual(self.decide(headers, media, 'approved').status_code, 404)

    def test_allow_decisions_can_be_switched_on_an_existing_link(self):
        invite, headers = self.guest_link(GUEST_COMMENT)
        self.as_user(self.owner)
        url = reverse('api-project-guest-invite-detail', args=[self.workspace.id, self.project_id, invite['id']])
        switched = self.client.patch(url, {'allow_decisions': True}, format='json')
        self.assertEqual(switched.status_code, 200, switched.content)
        self.assertTrue(switched.json()['allow_decisions'])
        # Reviewers who already opened the link get it too.
        self.assertEqual(self.decide(headers, self.v2, 'approved').status_code, 201)
        self.as_user(self.owner)
        self.assertFalse(self.client.patch(url, {'allow_decisions': False}, format='json').json()['allow_decisions'])
        self.assertEqual(self.decide(headers, self.v2, 'changes_requested', message='Wait').status_code, 403)
        [on, off] = AuditLog.objects.filter(action='guest.invite.updated').order_by('created_at')
        self.assertEqual((on.metadata['allow_decisions'], off.metadata['allow_decisions']), (True, False))
        # Only people who manage links may change it, and a revoked link stays as it is.
        self.as_user(self.add_client_member(CLIENT_REVIEWER_KEYS))
        self.assertEqual(self.client.patch(url, {'allow_decisions': True}, format='json').status_code, 403)
        self.as_user(self.owner)
        self.client.delete(url)
        self.assertEqual(self.client.patch(url, {'allow_decisions': True}, format='json').status_code, 400)


class GuestDecisionFlowTests(DecisionBase, TestCase):
    def test_approve_pins_the_version_moves_the_cut_and_records_who(self):
        self.note(self.v2, 'Logo is soft')
        self.note(self.v2, 'Music dips at 0:12')
        self.note(self.v2, 'Fixed already', resolved=True)
        self.note(self.v2, 'Internal: re-export before Friday', visibility='team')
        self.note(self.v1, 'Old cut note')
        invite, headers = self.guest_link()
        response = self.decide(headers, self.v2, 'approved')
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual((body['decision'], body['version_number'], body['open_notes_count']), ('approved', 2, 2))
        self.assertTrue(body['mine'])
        self.assertNotIn('email', body['reviewer'])
        record = ReviewDecision.objects.get()
        self.assertEqual(str(record.media_version_id), self.v2['id'])
        self.assertEqual((record.reviewer_name, record.reviewer_email), ('Rachel Kim', 'rachel@northlight.test'))
        self.assertEqual(str(record.guest_invite_id), invite['id'])
        self.assertIsNotNone(record.created_at)
        # Same workflow as the team's Approve: V2 moves, V1 does not.
        self.assertEqual(self.stage_slug(self.v2), 'approved')
        self.assertEqual(self.stage_slug(self.v1), 'queued')
        entry = MediaVersionStageEntry.objects.get(media_version_id=self.v2['id'], exited_at__isnull=True)
        self.assertEqual(entry.changed_by_guest_session_id, record.guest_session_id)
        self.assertIsNone(entry.changed_by_user_id)
        self.assertEqual(record.stage_entry_id, entry.id)

    def test_approve_is_audited_and_notifies_uploader_and_assignees_once(self):
        _, headers = self.guest_link()
        self.decide(headers, self.v2, 'approved')
        [decided] = AuditLog.objects.filter(action='review.decision.approved')
        self.assertEqual(decided.actor_type, 'GUEST')
        self.assertEqual(decided.metadata['version_number'], 2)
        self.assertEqual(str(decided.project_id), self.project_id)
        [moved] = AuditLog.objects.filter(action='media.workflow.transitioned', entity_id=self.v2['id'])
        self.assertEqual(moved.actor_type, 'GUEST')
        self.assertEqual(moved.metadata['review_decision_id'], decided.metadata['review_decision_id'])
        notes = Notification.objects.filter(kind='MEDIA_APPROVED')
        self.assertEqual({n.recipient_user_id for n in notes}, {self.editor.id, self.assignee.id})
        for note in notes:
            self.assertEqual(note.entity_type, 'review_decision')
            self.assertTrue(note.payload['client_decision'])
            self.assertEqual(note.payload['actor_name'], 'Rachel Kim')
            self.assertEqual(note.payload['version_number'], 2)

    def test_request_changes_needs_a_message_which_becomes_a_client_note(self):
        _, headers = self.guest_link()
        self.assertEqual(self.decide(headers, self.v2, 'changes_requested').status_code, 400)
        self.assertEqual(self.decide(headers, self.v2, 'changes_requested', message='   ').status_code, 400)
        self.assertEqual(self.decide(headers, self.v2, 'changes_requested', message='x' * 2001).status_code, 400)
        response = self.decide(headers, self.v2, 'changes_requested', message='Swap the end card for the spring one', start_time_ms=12000)
        self.assertEqual(response.status_code, 201, response.content)
        record = ReviewDecision.objects.get()
        comment = ReviewComment.objects.get(id=record.review_comment_id)
        self.assertEqual(comment.visibility, 'client')
        self.assertEqual(comment.author_guest_session_id, record.guest_session_id)
        self.assertEqual((comment.start_time_ms, str(comment.media_version_id)), (12000, self.v2['id']))
        self.assertEqual(self.stage_slug(self.v2), 'revision')
        # The guest sees their note; the team hears "changes requested" quoting it, not also "new note".
        self.client.force_authenticate(user=None)
        listed = self.client.get(reverse('api-guest-comments', args=[self.project_id, self.v2['id']]), **headers).json()
        self.assertIn(str(comment.id), [row['id'] for row in listed])
        changes = Notification.objects.filter(kind='MEDIA_CHANGES_REQUESTED')
        self.assertEqual({n.recipient_user_id for n in changes}, {self.editor.id, self.assignee.id})
        self.assertTrue(all(n.payload['excerpt'] == 'Swap the end card for the spring one' for n in changes))
        self.assertFalse(Notification.objects.filter(kind='REVIEW_COMMENT_NEW').exists())
        self.assertTrue(AuditLog.objects.filter(action='review.decision.changes_requested', actor_type='GUEST').exists())

    def test_a_newer_version_does_not_inherit_the_approval(self):
        _, headers = self.guest_link()
        self.decide(headers, self.v2, 'approved')
        v3 = self.upload(self.editor)
        self.assertEqual(self.stage_slug(v3), 'queued')
        versions, _ = self.guest_review(headers)
        self.assertEqual(versions[2]['decision']['decision'], 'approved')
        self.assertIsNone(versions[3]['decision'])
        self.assertEqual(self.team_decisions(self.owner, v3)['results'], [])
        # And V3 can be decided on its own.
        self.assertEqual(self.decide(headers, v3, 'approved').status_code, 201)
        self.assertEqual(ReviewDecision.objects.filter(media_version_id=v3['id']).count(), 1)

    def test_an_approved_cut_cannot_be_approved_twice_but_can_be_reopened(self):
        _, headers = self.guest_link()
        self.decide(headers, self.v2, 'approved')
        again = self.decide(headers, self.v2, 'approved')
        self.assertEqual(again.status_code, 409)
        self.assertIn('already approved by Rachel Kim', again.json()['detail'])
        self.assertEqual(self.decide(headers, self.v2, 'changes_requested', message='Actually, one more fix').status_code, 201)
        self.assertEqual(self.stage_slug(self.v2), 'revision')
        self.assertEqual(self.decide(headers, self.v2, 'approved').status_code, 201)
        self.assertEqual(ReviewDecision.objects.count(), 3)

    def test_a_cut_the_team_already_approved_is_still_recorded_but_not_moved(self):
        self.as_user(self.owner)
        approved = self.client.get(reverse('api-workflow-stages', args=[self.workspace.id])).json()
        stage = next(item for item in approved if item['slug'] == 'approved')
        self.client.post(reverse('api-media-version-workflow', args=[self.workspace.id, self.project_id, self.v2['id']]), {'workflow_stage_id': stage['id']}, format='json')
        _, headers = self.guest_link()
        response = self.decide(headers, self.v2, 'approved')
        self.assertEqual(response.status_code, 201)
        self.assertFalse(response.json()['workflow_transitioned'])
        # The team still hears that the client signed off.
        self.assertTrue(Notification.objects.filter(kind='MEDIA_APPROVED', entity_type='review_decision', recipient_user=self.editor).exists())

    def test_the_guest_sees_the_decision_afterwards_without_other_reviewers_emails(self):
        _, headers = self.guest_link()
        self.decide(headers, self.v2, 'approved')
        versions, viewer = self.guest_review(headers)
        self.assertTrue(viewer['can_decide'])
        decision = versions[2]['decision']
        self.assertEqual((decision['decision'], decision['reviewer']['name'], decision['mine']), ('approved', 'Rachel Kim', True))
        self.assertNotIn('email', decision['reviewer'])
        _, other = self.guest_link(email='jo@northlight.test', name='Jo Park')
        versions, _ = self.guest_review(other)
        self.assertFalse(versions[2]['decision']['mine'])

    def test_share_panel_status_and_activity_feed_show_the_decision(self):
        invite, headers = self.guest_link()
        self.client.get(reverse('api-guest-comments', args=[self.project_id, self.v2['id']]), **headers)
        self.decide(headers, self.v2, 'approved')
        self.as_user(self.owner)
        listed = self.client.get(reverse('api-project-guest-invites', args=[self.workspace.id, self.project_id])).json()
        status = next(row for row in listed if row['id'] == invite['id'])['activity']
        self.assertEqual((status['decision'], status['decision_version_number'], status['decided_by']), ('approved', 2, 'Rachel Kim'))
        self.assertIsNotNone(status['decided_at'])
        feed = self.client.get(reverse('api-project-activity', args=[self.workspace.id, self.project_id])).json()['results']
        actions = [row['action'] for row in feed]
        self.assertIn('review.decision.approved', actions)
        row = next(row for row in feed if row['action'] == 'review.decision.approved')
        self.assertEqual(row['summary'], "Rachel Kim approved 'Hero 30s' V2 as the client")
        self.assertEqual(row['actor']['type'], 'guest')
        # The stage move is part of the decision, not a second row.
        self.assertFalse(any(r['action'] == 'media.workflow.transitioned' and r['object']['id'] == self.v2['id'] for r in feed))

    def test_a_change_request_is_one_feed_row_carrying_its_message(self):
        invite, headers = self.guest_link()
        response = self.decide(headers, self.v2, 'changes_requested', message='Trim the sting')
        comment_id = response.json()['review_comment_id']
        self.as_user(self.owner)
        feed = self.client.get(reverse('api-project-activity', args=[self.workspace.id, self.project_id])).json()['results']
        self.assertIn('review.decision.changes_requested', [row['action'] for row in feed])
        # The note exists (and is listed on the cut), but the feed does not repeat it as a comment.
        self.assertNotIn('review.comment.created', [row['action'] for row in feed])
        self.assertTrue(ReviewComment.objects.filter(id=comment_id).exists())

    def test_team_review_lists_the_client_approval_as_proof(self):
        self.note(self.v2, 'Logo is soft')
        invite, headers = self.guest_link()
        self.decide(headers, self.v2, 'approved')
        data = self.team_decisions(self.owner, self.v2)
        [record] = data['results']
        self.assertEqual(record['reviewer'], {'name': 'Rachel Kim', 'type': 'guest', 'email': 'rachel@northlight.test'})
        self.assertEqual((record['version_number'], record['open_notes_count'], record['link_label']), (2, 1, 'Client review'))
        self.assertEqual(data['viewer'], {'kind': 'team', 'can_transition': True, 'can_request_changes': True, 'can_decide': False})
        # The stage reads as moved by the guest, so the Approved pill names them.
        self.as_user(self.owner)
        media = self.client.get(reverse('api-media-version-detail', args=[self.workspace.id, self.project_id, self.v2['id']])).json()
        self.assertEqual(media['current_stage']['changed_by'], {'id': None, 'name': 'Rachel Kim', 'type': 'guest'})


class TeamNoteLeakTests(DecisionBase, TestCase):
    def test_team_notes_never_reach_a_guest_through_decisions(self):
        self.note(self.v2, 'Client-visible note')
        team = self.note(self.v2, 'Internal: client hates the logo', visibility='team')
        _, headers = self.guest_link()
        versions, _ = self.guest_review(headers)
        self.assertEqual(versions[2]['open_notes'], 1)
        body = self.decide(headers, self.v2, 'changes_requested', message='Make the logo bigger').json()
        self.assertEqual(body['open_notes_count'], 1)
        self.assertNotIn('Internal', str(body))
        self.client.force_authenticate(user=None)
        listed = self.client.get(reverse('api-guest-comments', args=[self.project_id, self.v2['id']]), **headers).json()
        self.assertNotIn(team['id'], [row['id'] for row in listed])
        self.assertNotIn('Internal', str(self.guest_review(headers)))

    def test_client_members_see_decisions_and_feed_rows_without_team_notes(self):
        self.note(self.v2, 'Internal: re-grade', visibility='team')
        client = self.add_client_member(CLIENT_REVIEWER_KEYS)
        _, headers = self.guest_link()
        self.decide(headers, self.v2, 'changes_requested', message='Warmer grade please')
        data = self.team_decisions(client, self.v2)
        [record] = data['results']
        self.assertNotIn('email', record['reviewer'])
        self.assertNotIn('link_label', record)
        self.as_user(client)
        feed = self.client.get(reverse('api-project-activity', args=[self.workspace.id, self.project_id])).json()['results']
        self.assertNotIn('Internal', str(feed))
        self.assertIn('review.decision.changes_requested', [row['action'] for row in feed])


class ClientMemberReviewTests(DecisionBase, TestCase):
    """The signed-in review page for someone who is in the workspace only through a client team."""

    def test_the_endpoints_the_client_review_page_loads_all_answer(self):
        client = self.add_client_member(CLIENT_REVIEWER_KEYS)
        self.note(self.v2, 'Internal', visibility='team')
        self.note(self.v2, 'For the client')
        self.as_user(client)
        ws, pid, mid = self.workspace.id, self.project_id, self.v2['id']
        for name, args in (
            ('api-workspaces', []),
            ('api-projects', [ws]),
            ('api-workflow-stages', [ws]),
            ('api-media-versions', [ws, pid]),
            ('api-media-version-detail', [ws, pid, mid]),
            ('api-review-comments', [ws, pid, mid]),
            ('api-annotations', [ws, pid, mid]),
            ('api-media-version-decisions', [ws, pid, mid]),
        ):
            self.assertEqual(self.client.get(reverse(name, args=args)).status_code, 200, name)
        comments = self.client.get(reverse('api-review-comments', args=[ws, pid, mid])).json()
        self.assertEqual([row['visibility'] for row in comments], ['client'])
        # The internal lists the old page asked for. The page now skips them for clients.
        for name, args in (
            ('api-client-teams', [ws]), ('api-asset-files', [ws]), ('api-asset-folders', [ws]),
            ('api-task-stages', [ws]), ('api-tasks', [ws]), ('api-project-guest-invites', [ws, pid]),
        ):
            self.assertEqual(self.client.get(reverse(name, args=args)).status_code, 403, name)

    def test_a_client_role_without_decision_rights_cannot_decide(self):
        client = self.add_client_member(CLIENT_REVIEWER_KEYS)
        data = self.team_decisions(client, self.v2)
        self.assertEqual(data['viewer'], {'kind': 'client', 'can_transition': False, 'can_request_changes': False, 'can_decide': False})
        url = reverse('api-media-version-decisions', args=[self.workspace.id, self.project_id, self.v2['id']])
        self.assertEqual(self.client.post(url, {'decision': 'approved'}, format='json').status_code, 403)
        # Nor through the team's routes.
        self.assertEqual(self.client.post(
            reverse('api-media-revision-request', args=[self.workspace.id, self.project_id, self.v2['id']]),
            {'text': 'x'}, format='json',
        ).status_code, 403)

    def test_a_client_role_with_decision_rights_decides_like_a_guest(self):
        client = self.add_client_member(CLIENT_REVIEWER_KEYS + [REVIEW_DECISION_CREATE])
        data = self.team_decisions(client, self.v2)
        self.assertTrue(data['viewer']['can_decide'])
        url = reverse('api-media-version-decisions', args=[self.workspace.id, self.project_id, self.v2['id']])
        self.assertEqual(self.client.post(url, {'decision': 'changes_requested'}, format='json').status_code, 400)
        response = self.client.post(url, {'decision': 'approved'}, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        record = ReviewDecision.objects.get()
        self.assertEqual((record.decided_by_user_id, record.reviewer_name), (client.id, 'Cleo Client'))
        self.assertIsNone(record.guest_session_id)
        self.assertEqual(self.stage_slug(self.v2), 'approved')
        entry = MediaVersionStageEntry.objects.get(media_version_id=self.v2['id'], exited_at__isnull=True)
        self.assertEqual(entry.changed_by_user_id, client.id)
        self.assertTrue(AuditLog.objects.filter(action='review.decision.approved', actor_user=client).exists())
        self.assertEqual({n.recipient_user_id for n in Notification.objects.filter(kind='MEDIA_APPROVED')}, {self.editor.id, self.assignee.id})
        # Changes requested from the page also becomes a client-visible note.
        response = self.client.post(url, {'decision': 'changes_requested', 'message': 'Swap the music'}, format='json')
        self.assertEqual(response.status_code, 201)
        note = ReviewComment.objects.get(id=ReviewDecision.objects.latest('created_at').review_comment_id)
        self.assertEqual((note.visibility, note.author_user_id), ('client', client.id))

    def test_team_members_use_the_review_bar_not_client_decisions(self):
        self.as_user(self.editor)
        url = reverse('api-media-version-decisions', args=[self.workspace.id, self.project_id, self.v2['id']])
        self.assertEqual(self.client.post(url, {'decision': 'approved'}, format='json').status_code, 403)
        viewer_role = create_role(workspace=self.workspace, created_by_user=self.owner, name='Viewer', permission_keys=['workspace.read', 'project.read', 'media.read', 'review.comment.read'])
        viewer, _ = self.add_member('jordan@studio.test', 'Jordan', 'Viewer', role=viewer_role)
        data = self.team_decisions(viewer, self.v2)
        self.assertEqual(data['viewer'], {'kind': 'team', 'can_transition': False, 'can_request_changes': False, 'can_decide': False})

    def test_outsiders_cannot_read_decisions(self):
        outsider = _user('nobody@else.test')
        self.as_user(outsider)
        url = reverse('api-media-version-decisions', args=[self.workspace.id, self.project_id, self.v2['id']])
        self.assertEqual(self.client.get(url).status_code, 403)
        self.client.force_authenticate(user=None)
        self.assertIn(self.client.get(url).status_code, (401, 403))


class GuestPlaybackTests(DecisionBase, TestCase):
    def add_proxy(self, media):
        record = MediaVersion.objects.select_related('original_file').get(id=media['id']).original_file
        key = default_storage.save(f'tests/{uuid.uuid4()}.mp4', ContentFile(PAYLOAD))
        now = timezone.now()
        FileVariant.objects.filter(file=record).update(status=FileStatus.FAILED)
        return FileVariant.objects.create(
            id=uuid.uuid4(), file=record, storage_backend=record.storage_backend, object_key=key,
            original_name='hero.preview.mp4', mime_type='video/mp4', size_bytes=len(PAYLOAD), checksum='feed01',
            checksum_algorithm='sha256', metadata={'variant_type': 'VIDEO_PROXY', 'duration_ms': 30000, 'width': 1920, 'height': 1080},
            status=FileStatus.READY, created_at=now + timedelta(minutes=1), updated_at=now,
        )

    def playback(self, headers, media):
        self.client.force_authenticate(user=None)
        return self.client.get(reverse('api-guest-playback', args=[self.project_id, media['id']]), **headers)

    def body(self, response):
        return b''.join(response.streaming_content) if response.streaming else response.content

    def test_no_playable_file_yet_is_a_409(self):
        _, headers = self.guest_link()
        FileVariant.objects.all().update(status=FileStatus.FAILED)
        self.assertEqual(self.playback(headers, self.v2).status_code, 409)

    def test_signed_url_streams_with_ranges(self):
        self.add_proxy(self.v2)
        _, headers = self.guest_link()
        response = self.playback(headers, self.v2)
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual((data['mime_type'], data['duration_ms'], data['width']), ('video/mp4', 30000, 1920))
        self.assertTrue(AuditLog.objects.filter(action='guest.media.viewed', entity_id=self.v2['id']).exists())
        # No key header: the URL alone authorises it, like a <video> element needs.
        full = self.client.get(data['url'])
        self.assertEqual(full.status_code, 200)
        self.assertEqual(full['Accept-Ranges'], 'bytes')
        self.assertEqual(self.body(full), PAYLOAD)
        middle = self.client.get(data['url'], HTTP_RANGE='bytes=8192-8193')
        self.assertEqual(middle.status_code, 206)
        self.assertEqual(self.body(middle), PAYLOAD[8192:8194])
        self.assertEqual(self.client.head(data['url']).status_code, 200)

    def test_tampered_foreign_or_revoked_urls_are_refused(self):
        self.add_proxy(self.v2)
        self.add_proxy(self.v1)
        invite, headers = self.guest_link()
        url = self.playback(headers, self.v2).json()['url']
        self.assertEqual(self.client.get(url[:-2] + 'xx').status_code, 403)
        other = reverse('api-guest-media-stream', args=[self.project_id, self.v1['id']])
        self.assertEqual(self.client.get(f"{other}?{url.split('?', 1)[1]}").status_code, 403)
        self.assertEqual(self.client.get(url.split('?', 1)[0]).status_code, 403)
        self.as_user(self.owner)
        self.client.delete(reverse('api-project-guest-invite-detail', args=[self.workspace.id, self.project_id, invite['id']]))
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get(url).status_code, 403)

    def test_a_link_without_media_read_gets_no_playback(self):
        self.add_proxy(self.v2)
        _, headers = self.guest_link(['review.comment.read'])
        self.assertEqual(self.playback(headers, self.v2).status_code, 403)
