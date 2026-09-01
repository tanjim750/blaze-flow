import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse

from .models import (
    AuditLog,
    MediaVersion,
    MediaVersionStageEntry,
    ReviewComment,
    ReviewCommentContent,
    ReviewCommentRevision,
    RolePermission,
)
from .permissions import REVIEW_COMMENT_MANAGE
from .test_access_projects import WorkspaceAccessSetupMixin


class ReviewCommentApiTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='blazeflow-comment-tests-')
        self.settings_override = override_settings(
            MEDIA_ROOT=self.media_root,
            MAX_MEDIA_UPLOAD_BYTES=1024 * 1024,
        )
        self.settings_override.enable()
        super().setUp()
        self.client.force_authenticate(self.owner)
        project_response = self.client.post(
            reverse('api-projects', args=[self.workspace.id]),
            {'name': 'Review Project'},
            format='json',
        )
        self.project_id = project_response.json()['id']
        self.media_id = self.upload_media('Review media')

    def tearDown(self):
        self.settings_override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)
        super().tearDown()

    def upload_media(self, title):
        response = self.client.post(
            reverse('api-media-versions', args=[self.workspace.id, self.project_id]),
            {
                'file': SimpleUploadedFile(
                    'frame.png',
                    b'\x89PNG\r\n\x1a\ncomment-test',
                    content_type='image/png',
                ),
                'title': title,
            },
            format='multipart',
        )
        self.assertEqual(response.status_code, 201)
        return response.json()['id']

    def comments_url(self, media_id=None):
        return reverse(
            'api-review-comments',
            args=[self.workspace.id, self.project_id, media_id or self.media_id],
        )

    def create_comment(self, **payload):
        data = {'text': 'Please tighten this cut.', **payload}
        response = self.client.post(self.comments_url(), data, format='json')
        self.assertEqual(response.status_code, 201)
        return response

    def test_create_and_list_timestamped_comment_with_audit(self):
        created = self.create_comment(start_time_ms=1250, end_time_ms=2400)
        listed = self.client.get(self.comments_url())

        self.assertEqual(len(listed.json()), 1)
        self.assertEqual(created.json()['text'], 'Please tighten this cut.')
        self.assertEqual(created.json()['start_time_ms'], 1250)
        self.assertEqual(created.json()['author']['email'], self.owner.email)
        self.assertTrue(AuditLog.objects.filter(action='review.comment.created').exists())

    def test_comment_list_is_bounded_and_reports_pagination_headers(self):
        for index in range(3):
            self.create_comment(text=f'Comment {index}')
        response = self.client.get(f'{self.comments_url()}?limit=2&offset=1')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 2)
        self.assertEqual(response['X-Pagination-Total'], '3')
        self.assertEqual(response['X-Pagination-Offset'], '1')
        self.assertNotIn('X-Pagination-Next-Offset', response)
        self.assertEqual(self.client.get(f'{self.comments_url()}?limit=9999').status_code, 400)

    def test_reply_inherits_timing_and_parent_must_match_media(self):
        parent = self.create_comment(start_time_ms=500).json()
        invalid_reply = self.client.post(
            self.comments_url(),
            {
                'text': 'Reply',
                'parent_comment_id': parent['id'],
                'start_time_ms': 600,
            },
            format='json',
        )
        self.assertEqual(invalid_reply.status_code, 400)

        second_media_id = self.upload_media('Other media')
        wrong_media = self.client.post(
            self.comments_url(second_media_id),
            {'text': 'Wrong parent', 'parent_comment_id': parent['id']},
            format='json',
        )
        self.assertEqual(wrong_media.status_code, 404)

        reply = self.client.post(
            self.comments_url(),
            {'text': 'Reply', 'parent_comment_id': parent['id']},
            format='json',
        )
        self.assertEqual(reply.status_code, 201)
        self.assertIsNone(reply.json()['start_time_ms'])

    def test_author_edit_preserves_revision_and_blocks_other_user(self):
        comment_id = self.create_comment(text='Original feedback').json()['id']
        detail_url = reverse(
            'api-review-comment-detail',
            args=[self.workspace.id, self.project_id, self.media_id, comment_id],
        )
        self.invite_and_accept()
        self.client.force_authenticate(self.member_user)
        denied = self.client.patch(detail_url, {'text': 'Member edit'}, format='json')
        self.assertEqual(denied.status_code, 403)

        self.client.force_authenticate(self.owner)
        edited = self.client.patch(detail_url, {'text': 'Updated feedback'}, format='json')
        revisions_url = reverse(
            'api-review-comment-revisions',
            args=[self.workspace.id, self.project_id, self.media_id, comment_id],
        )
        revisions = self.client.get(revisions_url)

        self.assertEqual(edited.status_code, 200)
        self.assertEqual(edited.json()['text'], 'Updated feedback')
        self.assertEqual(edited.json()['revision_count'], 1)
        self.assertEqual(
            revisions.json()[0]['snapshot']['contents'][0]['text_content'],
            'Original feedback',
        )
        self.assertEqual(ReviewCommentRevision.objects.count(), 1)
        self.assertTrue(AuditLog.objects.filter(action='review.comment.edited').exists())

    def test_resolution_requires_manage_permission_and_supports_reopen(self):
        comment_id = self.create_comment().json()['id']
        resolution_url = reverse(
            'api-review-comment-resolution',
            args=[self.workspace.id, self.project_id, self.media_id, comment_id],
        )
        RolePermission.objects.filter(
            role=self.member_role,
            permission_key=REVIEW_COMMENT_MANAGE,
        ).delete()
        self.invite_and_accept()
        self.client.force_authenticate(self.member_user)
        denied = self.client.post(resolution_url, {'resolved': True}, format='json')
        self.assertEqual(denied.status_code, 403)

        self.client.force_authenticate(self.owner)
        resolved = self.client.post(resolution_url, {'resolved': True}, format='json')
        reopened = self.client.post(resolution_url, {'resolved': False}, format='json')
        self.assertEqual(resolved.status_code, 200)
        self.assertTrue(resolved.json()['resolved'])
        self.assertIsNotNone(resolved.json()['resolved_at'])
        self.assertEqual(reopened.status_code, 200)
        self.assertFalse(reopened.json()['resolved'])
        self.assertIsNone(reopened.json()['resolved_at'])
        self.assertTrue(AuditLog.objects.filter(action='review.comment.resolved').exists())
        self.assertTrue(AuditLog.objects.filter(action='review.comment.reopened').exists())

    def test_delete_soft_deletes_entire_reply_subtree(self):
        parent_id = self.create_comment().json()['id']
        reply = self.client.post(
            self.comments_url(),
            {'text': 'Nested reply', 'parent_comment_id': parent_id},
            format='json',
        )
        detail_url = reverse(
            'api-review-comment-detail',
            args=[self.workspace.id, self.project_id, self.media_id, parent_id],
        )
        deleted = self.client.delete(detail_url)

        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(self.client.get(self.comments_url()).json(), [])
        self.assertEqual(ReviewComment.objects.filter(deleted_at__isnull=False).count(), 2)
        self.assertEqual(ReviewCommentContent.objects.count(), 2)
        audit = AuditLog.objects.get(action='review.comment.deleted')
        self.assertEqual(audit.metadata['deleted_comment_count'], 2)
        self.assertTrue(ReviewComment.objects.filter(id=reply.json()['id']).exists())

    def test_revision_request_creates_feedback_and_moves_workflow_atomically(self):
        url = reverse(
            'api-media-revision-request',
            args=[self.workspace.id, self.project_id, self.media_id],
        )
        requested = self.client.post(
            url,
            {'text': 'Please replace the final frame.', 'start_time_ms': 9000},
            format='json',
        )
        repeated = self.client.post(
            url,
            {'text': 'Also adjust the music.'},
            format='json',
        )

        self.assertEqual(requested.status_code, 201)
        self.assertEqual(requested.json()['workflow']['stage']['slug'], 'revision')
        self.assertTrue(requested.json()['workflow_transitioned'])
        self.assertEqual(repeated.status_code, 201)
        self.assertFalse(repeated.json()['workflow_transitioned'])
        self.assertEqual(
            ReviewComment.objects.filter(media_version_id=self.media_id).count(),
            2,
        )
        self.assertEqual(AuditLog.objects.filter(action='media.revision.requested').count(), 2)

    def test_revision_request_rolls_back_comment_when_transition_fails(self):
        MediaVersionStageEntry.objects.filter(media_version_id=self.media_id).delete()
        url = reverse(
            'api-media-revision-request',
            args=[self.workspace.id, self.project_id, self.media_id],
        )
        response = self.client.post(
            url,
            {'text': 'This must roll back.'},
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(ReviewComment.objects.exists())
        self.assertFalse(AuditLog.objects.filter(action='review.comment.created').exists())

    def test_outsider_cannot_read_comments(self):
        user_model = type(self.owner)
        outsider = user_model.objects.create_user(
            email='comment-outsider@example.com',
            password='a-secure-test-password',
            first_name='Comment',
            last_name='Outsider',
        )
        self.client.force_authenticate(outsider)
        self.assertEqual(self.client.get(self.comments_url()).status_code, 403)
