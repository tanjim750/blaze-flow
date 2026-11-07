"""Team-only review notes never reach guests or client-team members."""
import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse

from .models import Annotation, ReviewComment, ReviewCommentContent, ReviewCommentVisibility
from .test_access_projects import WorkspaceAccessSetupMixin


class ReviewCommentVisibilityTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='blazeflow-visibility-')
        self.settings_override = override_settings(MEDIA_ROOT=self.media_root)
        self.settings_override.enable()
        super().setUp()
        self.client.force_authenticate(self.owner)
        project = self.client.post(reverse('api-projects', args=[self.workspace.id]), {'name': 'Visibility'}, format='json')
        self.project_id = project.json()['id']
        media = self.client.post(
            reverse('api-media-versions', args=[self.workspace.id, self.project_id]),
            {'file': SimpleUploadedFile('frame.png', b'\x89PNG\r\n\x1a\nvisibility', content_type='image/png'), 'title': 'Frame'},
            format='multipart',
        )
        self.media_id = media.json()['id']
        self.comments_url = reverse('api-review-comments', args=[self.workspace.id, self.project_id, self.media_id])
        self.client_note = self.post({'text': 'Client can read this'})
        self.team_note = self.post({'text': 'Internal: the grade is off', 'visibility': 'team'})
        # A reply in a team thread asks for client visibility and must still come out team.
        self.team_reply = self.post({'text': 'Agreed, fixing', 'parent_comment_id': self.team_note['id'], 'visibility': 'client'})
        self.client_reply_team = self.post({'text': 'Internal aside on a client note', 'parent_comment_id': self.client_note['id'], 'visibility': 'team'})
        annotations_url = reverse('api-annotations', args=[self.workspace.id, self.project_id, self.media_id])
        self.team_drawing = self.client.post(annotations_url, {
            'review_comment_id': self.team_note['id'],
            'elements': [{'element_type': 'POINT', 'geometry': {'x': 0.5, 'y': 0.5}}],
        }, format='json').json()
        self.client_drawing = self.client.post(annotations_url, {
            'review_comment_id': self.client_note['id'],
            'elements': [{'element_type': 'POINT', 'geometry': {'x': 0.2, 'y': 0.2}}],
        }, format='json').json()

    def tearDown(self):
        self.settings_override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)
        super().tearDown()

    def post(self, payload):
        response = self.client.post(self.comments_url, payload, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def guest_headers(self, permissions=None):
        self.client.force_authenticate(self.owner)
        invite = self.client.post(
            reverse('api-project-guest-invites', args=[self.workspace.id, self.project_id]),
            {'label': 'Client', 'permissions': permissions or [
                'media.read', 'media.download', 'review.comment.read', 'review.comment.create',
                'review.reaction.create', 'annotation.read', 'annotation.create',
            ], 'expires_in_hours': 24},
            format='json',
        )
        self.client.force_authenticate(user=None)
        exchange = self.client.post(
            reverse('api-guest-exchange'),
            {'token': invite.json()['token'], 'name': 'Client One', 'email': 'client@example.com'},
            format='json',
        )
        return {'HTTP_X_GUEST_ACCESS_KEY': exchange.json()['access_key']}

    def test_existing_and_default_comments_are_client_visible(self):
        self.assertEqual(self.client_note['visibility'], 'client')
        self.assertEqual(ReviewComment._meta.get_field('visibility').default, ReviewCommentVisibility.CLIENT)

    def test_replies_in_a_team_thread_are_forced_team(self):
        self.assertEqual(self.team_note['visibility'], 'team')
        self.assertEqual(self.team_reply['visibility'], 'team')
        self.assertEqual(self.client_reply_team['visibility'], 'team')

    def test_teammates_see_every_note(self):
        listed = self.client.get(self.comments_url).json()
        ids = {row['id'] for row in listed}
        self.assertEqual(ids, {self.client_note['id'], self.team_note['id'], self.team_reply['id'], self.client_reply_team['id']})

    def test_guest_list_never_includes_team_notes_or_their_replies(self):
        headers = self.guest_headers()
        url = reverse('api-guest-comments', args=[self.project_id, self.media_id])
        response = self.client.get(url, **headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row['id'] for row in response.json()], [self.client_note['id']])
        self.assertNotIn('Internal', response.content.decode())

    def test_guest_cannot_reach_a_team_note_by_id(self):
        headers = self.guest_headers()
        team_id = self.team_note['id']
        args = [self.project_id, self.media_id, team_id]
        self.assertEqual(self.client.get(reverse('api-guest-comment-revisions', args=args), **headers).status_code, 404)
        self.assertEqual(self.client.post(reverse('api-guest-comment-reactions', args=args), {'emoji': '👍'}, format='json', **headers).status_code, 404)
        reply = self.client.post(
            reverse('api-guest-comments', args=[self.project_id, self.media_id]),
            {'text': 'Replying to a hidden note', 'parent_comment_id': team_id}, format='json', **headers,
        )
        self.assertEqual(reply.status_code, 404)
        drawing = self.client.post(
            reverse('api-guest-annotations', args=[self.project_id, self.media_id]),
            {'review_comment_id': team_id, 'elements': [{'element_type': 'POINT', 'geometry': {'x': 0.1, 'y': 0.1}}]},
            format='json', **headers,
        )
        self.assertEqual(drawing.status_code, 404)
        # The reply under a team note is hidden too, not only the root.
        self.assertEqual(self.client.get(reverse('api-guest-comment-revisions', args=[self.project_id, self.media_id, self.team_reply['id']]), **headers).status_code, 404)

    def test_guest_cannot_post_a_team_note(self):
        headers = self.guest_headers()
        created = self.client.post(
            reverse('api-guest-comments', args=[self.project_id, self.media_id]),
            {'text': 'Trying to hide this', 'visibility': 'team'}, format='json', **headers,
        )
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.json()['visibility'], 'client')

    def test_guest_annotations_exclude_drawings_on_team_notes(self):
        headers = self.guest_headers()
        listed = self.client.get(reverse('api-guest-annotations', args=[self.project_id, self.media_id]), **headers).json()
        ids = {row['id'] for row in listed}
        self.assertIn(self.client_drawing['id'], ids)
        self.assertNotIn(self.team_drawing['id'], ids)
        hidden = reverse('api-guest-annotation-revisions', args=[self.project_id, self.media_id, self.team_drawing['id']])
        self.assertEqual(self.client.get(hidden, **headers).status_code, 404)

    def test_guest_cannot_download_a_team_note_attachment(self):
        self.client.force_authenticate(self.owner)
        base = [self.workspace.id, self.project_id, self.media_id]
        upload = lambda comment_id: self.client.post(  # noqa: E731
            reverse('api-review-attachment-upload', args=[*base, comment_id]),
            {'file': SimpleUploadedFile('still.png', b'\x89PNG\r\n\x1a\nsecret', content_type='image/png')}, format='multipart',
        )
        team_upload = upload(self.team_note['id'])
        client_upload = upload(self.client_note['id'])
        self.assertEqual(team_upload.status_code, 201, team_upload.content)
        headers = self.guest_headers()
        team_url = reverse('api-guest-attachment', args=[self.project_id, team_upload.json()['id']])
        client_url = reverse('api-guest-attachment', args=[self.project_id, client_upload.json()['id']])
        self.assertEqual(self.client.get(team_url, **headers).status_code, 404)
        # The client-visible one is found (it may still be scanning, hence 200 or 409).
        self.assertIn(self.client.get(client_url, **headers).status_code, (200, 409))
        self.assertTrue(ReviewCommentContent.objects.filter(review_comment_id=self.team_note['id'], file__isnull=False).exists())

    def test_client_team_members_do_not_see_team_notes_and_cannot_write_them(self):
        self.client.force_authenticate(self.owner)
        team = self.client.post(reverse('api-client-teams', args=[self.workspace.id]), {'name': 'Acme'}, format='json').json()
        self.client.post(reverse('api-client-team-members', args=[self.workspace.id, team['id']]), {'email': self.member_user.email}, format='json')
        granted = self.client.post(
            reverse('api-client-team-workspace-access', args=[self.workspace.id, team['id']]),
            {'role_id': str(self.member_role.id), 'project_access_mode': 'ALL'}, format='json',
        )
        self.assertEqual(granted.status_code, 201, granted.content)
        self.client.force_authenticate(self.member_user)
        listed = self.client.get(self.comments_url)
        self.assertEqual(listed.status_code, 200, listed.content)
        self.assertEqual([row['id'] for row in listed.json()], [self.client_note['id']])
        detail = reverse('api-review-comment-detail', args=[self.workspace.id, self.project_id, self.media_id, self.team_note['id']])
        self.assertEqual(self.client.patch(detail, {'text': 'x'}, format='json').status_code, 404)
        annotations = self.client.get(reverse('api-annotations', args=[self.workspace.id, self.project_id, self.media_id])).json()
        self.assertNotIn(self.team_drawing['id'], {row['id'] for row in annotations})
        attempt = self.client.post(self.comments_url, {'text': 'Sneaky', 'visibility': 'team'}, format='json')
        self.assertIn(attempt.status_code, (400, 403))
        self.assertFalse(ReviewComment.objects.filter(visibility='team', author_user=self.member_user).exists())

    def test_team_note_cannot_mention_a_client_member(self):
        self.client.force_authenticate(self.owner)
        team = self.client.post(reverse('api-client-teams', args=[self.workspace.id]), {'name': 'Acme'}, format='json').json()
        self.client.post(reverse('api-client-team-members', args=[self.workspace.id, team['id']]), {'email': self.member_user.email}, format='json')
        self.client.post(
            reverse('api-client-team-workspace-access', args=[self.workspace.id, team['id']]),
            {'role_id': str(self.member_role.id), 'project_access_mode': 'ALL'}, format='json',
        )
        response = self.client.post(self.comments_url, {
            'text': 'Internal', 'visibility': 'team', 'mentioned_user_ids': [str(self.member_user.id)],
        }, format='json')
        self.assertEqual(response.status_code, 400, response.content)

    def test_unknown_visibility_is_rejected(self):
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.post(self.comments_url, {'text': 'x', 'visibility': 'secret'}, format='json').status_code, 400)

    def test_annotations_are_listed_for_teammates(self):
        self.assertEqual(Annotation.objects.filter(review_comment_id=self.team_note['id']).count(), 1)
