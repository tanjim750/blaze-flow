import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse

from .models import Annotation, AuditLog, ReviewComment
from .services.outbox import process_outbox_events
from .test_access_projects import WorkspaceAccessSetupMixin


class GuestReviewApiTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='blazeflow-guest-review-')
        self.settings_override = override_settings(MEDIA_ROOT=self.media_root)
        self.settings_override.enable()
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

    def tearDown(self):
        self.settings_override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)
        super().tearDown()

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
        self.latest_invite_id = invite.json()['id']
        self.latest_access_key = exchange.json()['access_key']
        return {'HTTP_X_GUEST_ACCESS_KEY': self.latest_access_key}

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

    def test_manager_can_list_and_revoke_access_or_entire_invite(self):
        headers = self.issue_access(['media.read'])
        self.client.force_authenticate(self.owner)
        list_url = reverse('api-project-guest-invites', args=[self.workspace.id, self.project_id])
        listed = self.client.get(list_url)
        access_id = listed.json()[0]['accesses'][0]['id']
        access_url = reverse('api-project-guest-access-detail', args=[self.workspace.id, self.project_id, access_id])
        self.assertEqual(self.client.delete(access_url).status_code, 204)
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get(reverse('api-guest-review', args=[self.project_id]), **headers).status_code, 403)

        self.client.force_authenticate(self.owner)
        second_headers = self.issue_access(['media.read'])
        self.client.force_authenticate(self.owner)
        invite_url = reverse('api-project-guest-invite-detail', args=[self.workspace.id, self.project_id, self.latest_invite_id])
        self.assertEqual(self.client.delete(invite_url).status_code, 204)
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get(reverse('api-guest-review', args=[self.project_id]), **second_headers).status_code, 403)
        self.assertTrue(AuditLog.objects.filter(action='guest.access.revoked').exists())
        self.assertTrue(AuditLog.objects.filter(action='guest.invite.revoked').exists())

    def test_guest_upload_uses_quarantine_and_only_own_comment(self):
        owner_comment = self.client.post(
            reverse('api-review-comments', args=[self.workspace.id, self.project_id, self.media_id]),
            {'text': 'Owner comment'}, format='json',
        )
        headers = self.issue_access([
            'media.read', 'media.download', 'review.comment.read',
            'review.comment.create', 'review.attachment.create',
        ])
        comments_url = reverse('api-guest-comments', args=[self.project_id, self.media_id])
        comment = self.client.post(comments_url, {'text': 'File reference'}, format='json', **headers)
        upload_url = reverse('api-guest-attachment-upload', args=[self.project_id, self.media_id, comment.json()['id']])
        uploaded = self.client.post(
            upload_url,
            {'file': SimpleUploadedFile('guest.pdf', b'%PDF-1.7\nguest', content_type='application/pdf')},
            format='multipart', **headers,
        )
        self.assertEqual(uploaded.status_code, 201)
        self.assertEqual(uploaded.json()['file']['status'], 'PENDING')
        owner_upload_url = reverse('api-guest-attachment-upload', args=[self.project_id, self.media_id, owner_comment.json()['id']])
        denied = self.client.post(
            owner_upload_url,
            {'file': SimpleUploadedFile('denied.pdf', b'%PDF-1.7\ndenied', content_type='application/pdf')},
            format='multipart', **headers,
        )
        self.assertEqual(denied.status_code, 403)
        process_outbox_events()
        process_outbox_events()
        download_url = reverse('api-guest-attachment', args=[self.project_id, uploaded.json()['id']])
        download = self.client.get(download_url, **headers)
        self.assertEqual(download.status_code, 200)
        self.assertEqual(b''.join(download.streaming_content), b'%PDF-1.7\nguest')
        self.assertTrue(AuditLog.objects.filter(action='review.attachment.uploaded', actor_type='GUEST').exists())
