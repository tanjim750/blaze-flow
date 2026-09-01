from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.urls import reverse

from .models import Annotation, AuditLog, ReviewComment
from .test_access_projects import WorkspaceAccessSetupMixin


class GuestReviewApiTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.owner)
        project = self.client.post(reverse('api-projects', args=[self.workspace.id]), {'name': 'Guest Review'}, format='json')
        self.project_id = project.json()['id']
        media = self.client.post(
            reverse('api-media-versions', args=[self.workspace.id, self.project_id]),
            {'file': SimpleUploadedFile('frame.png', b'\x89PNG\r\n\x1a\nguest-media', content_type='image/png'), 'title': 'Guest frame'},
            format='multipart',
        )
        self.media_id = media.json()['id']

    def issue_access(self, permissions):
        invite = self.client.post(
            reverse('api-project-guest-invites', args=[self.workspace.id, self.project_id]),
            {'label': 'Client reviewer', 'permissions': permissions, 'expires_in_hours': 24},
            format='json',
        )
        self.assertEqual(invite.status_code, 201)
        self.client.force_authenticate(user=None)
        exchange = self.client.post(
            reverse('api-guest-exchange'),
            {'token': invite.json()['token'], 'name': 'Client One', 'email': 'client@example.com'},
            format='json',
        )
        self.assertEqual(exchange.status_code, 201)
        return {'HTTP_X_GUEST_ACCESS_KEY': exchange.json()['access_key']}

    def test_guest_can_read_create_comment_and_annotate_with_scoped_key(self):
        headers = self.issue_access([
            'media.read', 'review.comment.read', 'review.comment.create',
            'annotation.read', 'annotation.create',
        ])
        review = self.client.get(reverse('api-guest-review', args=[self.project_id]), **headers)
        comments_url = reverse('api-guest-comments', args=[self.project_id, self.media_id])
        comment = self.client.post(comments_url, {'text': 'Please move the title'}, format='json', **headers)
        annotations_url = reverse('api-guest-annotations', args=[self.project_id, self.media_id])
        annotation = self.client.post(
            annotations_url,
            {'review_comment_id': comment.json()['id'], 'elements': [{'element_type': 'POINT', 'geometry': {'x': 0.2, 'y': 0.4}}]},
            format='json', **headers,
        )
        self.assertEqual(review.status_code, 200)
        self.assertEqual(comment.status_code, 201)
        self.assertEqual(comment.json()['author']['type'], 'guest')
        self.assertEqual(annotation.status_code, 201)
        self.assertIsNotNone(annotation.json()['author_guest_session_id'])
        self.assertEqual(ReviewComment.objects.filter(author_guest_session__isnull=False).count(), 1)
        self.assertEqual(Annotation.objects.filter(author_guest_session__isnull=False).count(), 1)
        self.assertTrue(AuditLog.objects.filter(actor_type='GUEST').exists())

    def test_guest_permission_and_project_scope_are_enforced(self):
        headers = self.issue_access(['media.read'])
        comments_url = reverse('api-guest-comments', args=[self.project_id, self.media_id])
        self.assertEqual(self.client.post(comments_url, {'text': 'Blocked'}, format='json', **headers).status_code, 403)
        self.assertEqual(self.client.get(reverse('api-guest-review', args=[self.project_id])).status_code, 403)
