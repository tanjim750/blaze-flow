import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse

from .models import (
    Annotation, AnnotationRevision, AuditLog, ReviewComment,
    ReviewCommentContent, ReviewCommentRevision,
)
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

    def test_guest_rotates_access_key_and_old_key_stops_immediately(self):
        old_headers = self.issue_access(['media.read'])
        rotate_url = reverse('api-guest-access-key-rotate', args=[self.project_id])
        rotated = self.client.post(rotate_url, format='json', **old_headers)
        new_headers = {'HTTP_X_GUEST_ACCESS_KEY': rotated.json()['access_key']}
        review_url = reverse('api-guest-review', args=[self.project_id])
        self.assertEqual(rotated.status_code, 200)
        self.assertNotEqual(rotated.json()['access_key'], self.latest_access_key)
        self.assertEqual(self.client.get(review_url, **old_headers).status_code, 403)
        self.assertEqual(self.client.get(review_url, **new_headers).status_code, 200)
        self.assertTrue(AuditLog.objects.filter(action='guest.access_key.rotated', actor_type='GUEST').exists())

    def test_guest_edits_and_deletes_own_review_content_with_revisions(self):
        headers = self.issue_access([
            'review.comment.read', 'review.comment.create', 'review.comment.edit',
            'review.comment.delete', 'annotation.read', 'annotation.create',
            'annotation.edit', 'annotation.delete',
        ])
        comments_url = reverse('api-guest-comments', args=[self.project_id, self.media_id])
        created_comment = self.client.post(comments_url, {'text': 'Original'}, format='json', **headers)
        comment_id = created_comment.json()['id']
        comment_url = reverse('api-guest-comment-detail', args=[self.project_id, self.media_id, comment_id])
        edited_comment = self.client.patch(comment_url, {'text': 'Updated'}, format='json', **headers)
        comment_revisions_url = reverse('api-guest-comment-revisions', args=[self.project_id, self.media_id, comment_id])
        comment_revisions = self.client.get(comment_revisions_url, **headers)

        annotations_url = reverse('api-guest-annotations', args=[self.project_id, self.media_id])
        created_annotation = self.client.post(
            annotations_url,
            {'elements': [{'element_type': 'POINT', 'geometry': {'x': 0.1, 'y': 0.2}}]},
            format='json', **headers,
        )
        annotation_id = created_annotation.json()['id']
        annotation_url = reverse('api-guest-annotation-detail', args=[self.project_id, self.media_id, annotation_id])
        edited_annotation = self.client.patch(
            annotation_url,
            {'elements': [{'element_type': 'POINT', 'geometry': {'x': 0.8, 'y': 0.7}}]},
            format='json', **headers,
        )
        annotation_revisions_url = reverse('api-guest-annotation-revisions', args=[self.project_id, self.media_id, annotation_id])
        annotation_revisions = self.client.get(annotation_revisions_url, **headers)

        self.assertEqual(edited_comment.status_code, 200)
        self.assertEqual(edited_comment.json()['text'], 'Updated')
        self.assertEqual(comment_revisions.status_code, 200)
        self.assertIsNotNone(comment_revisions.json()[0]['edited_by_guest_session_id'])
        self.assertEqual(edited_annotation.status_code, 200)
        self.assertEqual(edited_annotation.json()['elements'][0]['geometry']['x'], 0.8)
        self.assertIsNotNone(annotation_revisions.json()[0]['edited_by_guest_session_id'])
        self.assertEqual(ReviewCommentRevision.objects.count(), 1)
        self.assertEqual(AnnotationRevision.objects.count(), 1)
        self.assertEqual(self.client.delete(annotation_url, **headers).status_code, 204)
        self.assertEqual(self.client.delete(comment_url, **headers).status_code, 204)
        self.assertTrue(AuditLog.objects.filter(action='review.comment.deleted', actor_type='GUEST').exists())

    def test_guest_cannot_change_another_guest_content(self):
        permissions = ['review.comment.create', 'review.comment.edit', 'review.comment.delete']
        first_headers = self.issue_access(permissions)
        comments_url = reverse('api-guest-comments', args=[self.project_id, self.media_id])
        comment = self.client.post(comments_url, {'text': 'First guest'}, format='json', **first_headers)
        self.client.force_authenticate(self.owner)
        second_headers = self.issue_access(permissions)
        detail_url = reverse('api-guest-comment-detail', args=[self.project_id, self.media_id, comment.json()['id']])
        self.assertEqual(self.client.patch(detail_url, {'text': 'Hijacked'}, format='json', **second_headers).status_code, 403)
        self.assertEqual(self.client.delete(detail_url, **second_headers).status_code, 403)

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
            'review.attachment.delete',
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
        deleted = self.client.delete(download_url, **headers)
        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(self.client.get(download_url, **headers).status_code, 404)
        self.assertIsNotNone(
            ReviewCommentContent.objects.get(id=uploaded.json()['id']).deleted_by_guest_session_id
        )
        self.assertTrue(AuditLog.objects.filter(action='review.attachment.uploaded', actor_type='GUEST').exists())
        self.assertTrue(AuditLog.objects.filter(action='review.attachment.deleted', actor_type='GUEST').exists())

    def test_guest_comment_list_uses_bounded_pagination(self):
        headers = self.issue_access(['review.comment.read', 'review.comment.create'])
        url = reverse('api-guest-comments', args=[self.project_id, self.media_id])
        for index in range(3):
            self.client.post(url, {'text': f'Guest comment {index}'}, format='json', **headers)
        response = self.client.get(f'{url}?limit=1&offset=1', **headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 1)
        self.assertEqual(response['X-Pagination-Total'], '3')
        self.assertEqual(response['X-Pagination-Next-Offset'], '2')
