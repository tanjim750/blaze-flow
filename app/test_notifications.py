import shutil
import tempfile
from datetime import timedelta
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .models import (
    Notification,
    OutboxEvent,
    OutboxEventStatus,
    ProjectAccessMode,
    ReviewComment,
    ReviewCommentMention,
    ReviewCommentRevision,
)
from .services import process_outbox_events
from .test_access_projects import WorkspaceAccessSetupMixin


class MentionNotificationApiTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='blazeflow-notification-tests-')
        self.settings_override = override_settings(
            MEDIA_ROOT=self.media_root,
            MAX_MEDIA_UPLOAD_BYTES=1024 * 1024,
        )
        self.settings_override.enable()
        super().setUp()
        self.client.force_authenticate(self.owner)
        project_response = self.client.post(
            reverse('api-projects', args=[self.workspace.id]),
            {'name': 'Notification Project'},
            format='json',
        )
        self.project_id = project_response.json()['id']
        upload_response = self.client.post(
            reverse('api-media-versions', args=[self.workspace.id, self.project_id]),
            {
                'file': SimpleUploadedFile(
                    'frame.png',
                    b'\x89PNG\r\n\x1a\nnotification-test',
                    content_type='image/png',
                ),
                'title': 'Mention media',
            },
            format='multipart',
        )
        self.assertEqual(upload_response.status_code, 201)
        self.media_id = upload_response.json()['id']

    def tearDown(self):
        self.settings_override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)
        super().tearDown()

    def comments_url(self):
        return reverse(
            'api-review-comments',
            args=[self.workspace.id, self.project_id, self.media_id],
        )

    def create_mention(self, user_ids):
        return self.client.post(
            self.comments_url(),
            {
                'text': 'Please review this update.',
                'mentioned_user_ids': [str(user_id) for user_id in user_ids],
            },
            format='json',
        )

    def test_mention_creates_deduplicated_notification_and_outbox_event(self):
        self.invite_and_accept()
        self.client.force_authenticate(self.owner)
        response = self.create_mention(
            [self.member_user.id, self.member_user.id, self.owner.id]
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual([item['id'] for item in response.json()['mentions']], [str(self.member_user.id)])
        notification = Notification.objects.get(recipient_user=self.member_user)
        self.assertEqual(notification.payload['media_version_id'], str(self.media_id))
        outbox = OutboxEvent.objects.get()
        self.assertEqual(outbox.topic, 'notification.created')
        self.assertEqual(outbox.status, OutboxEventStatus.PENDING)
        self.assertEqual(ReviewCommentMention.objects.count(), 1)

    def test_inaccessible_mention_rejects_and_rolls_back_comment(self):
        self.invite_and_accept(project_access_mode=ProjectAccessMode.SELECTED)
        self.client.force_authenticate(self.owner)
        response = self.create_mention([self.member_user.id])

        self.assertEqual(response.status_code, 400)
        self.assertFalse(ReviewComment.objects.exists())
        self.assertFalse(Notification.objects.exists())
        self.assertFalse(OutboxEvent.objects.exists())

    def test_edit_synchronizes_mentions_and_preserves_notification_deduplication(self):
        self.invite_and_accept()
        self.client.force_authenticate(self.owner)
        created = self.create_mention([])
        comment_id = created.json()['id']
        detail_url = reverse(
            'api-review-comment-detail',
            args=[self.workspace.id, self.project_id, self.media_id, comment_id],
        )
        added = self.client.patch(
            detail_url,
            {
                'text': 'Please review this update.',
                'mentioned_user_ids': [str(self.member_user.id)],
            },
            format='json',
        )
        removed = self.client.patch(
            detail_url,
            {'text': 'Please review this update.', 'mentioned_user_ids': []},
            format='json',
        )
        readded = self.client.patch(
            detail_url,
            {
                'text': 'Please review this update.',
                'mentioned_user_ids': [str(self.member_user.id)],
            },
            format='json',
        )

        self.assertEqual(added.status_code, 200)
        self.assertEqual(removed.status_code, 200)
        self.assertEqual(readded.status_code, 200)
        self.assertEqual(Notification.objects.count(), 1)
        self.assertEqual(OutboxEvent.objects.count(), 1)
        self.assertEqual(ReviewCommentMention.objects.count(), 1)
        self.assertEqual(readded.json()['revision_count'], 3)
        revision_snapshots = list(
            ReviewCommentRevision.objects.filter(review_comment_id=comment_id)
            .order_by('created_at')
            .values_list('snapshot', flat=True)
        )
        self.assertEqual(revision_snapshots[0]['mentioned_user_ids'], [])
        self.assertEqual(
            revision_snapshots[1]['mentioned_user_ids'],
            [str(self.member_user.id)],
        )

    def test_notification_inbox_is_recipient_only_and_read_operations_are_idempotent(self):
        self.invite_and_accept()
        self.client.force_authenticate(self.owner)
        self.create_mention([self.member_user.id])
        notification = Notification.objects.get()
        self.assertEqual(self.client.get(reverse('api-notifications')).json(), [])
        self.assertEqual(
            self.client.post(
                reverse('api-notification-read', args=[notification.id]),
                {},
                format='json',
            ).status_code,
            404,
        )

        self.client.force_authenticate(self.member_user)
        unread = self.client.get(f"{reverse('api-notifications')}?unread=true")
        read_url = reverse('api-notification-read', args=[notification.id])
        first_read = self.client.post(read_url, {}, format='json')
        second_read = self.client.post(read_url, {}, format='json')
        read_all = self.client.post(reverse('api-notifications-read-all'), {}, format='json')

        self.assertEqual(len(unread.json()), 1)
        self.assertTrue(unread.json()[0]['unread'])
        self.assertFalse(first_read.json()['unread'])
        self.assertEqual(second_read.status_code, 200)
        self.assertEqual(read_all.json()['updated_count'], 0)

    def test_outbox_processor_publishes_and_retries_failures(self):
        self.invite_and_accept()
        self.client.force_authenticate(self.owner)
        self.create_mention([self.member_user.id])
        event = OutboxEvent.objects.get()

        def failing_dispatcher(domain_event):
            raise RuntimeError('delivery unavailable')

        failed = process_outbox_events(event_dispatcher=failing_dispatcher)
        event.refresh_from_db()
        self.assertEqual(failed, {'claimed': 1, 'published': 0, 'failed': 1})
        self.assertEqual(event.status, OutboxEventStatus.FAILED)
        self.assertEqual(event.attempts, 1)

        delivered = []
        succeeded = process_outbox_events(event_dispatcher=delivered.append)
        event.refresh_from_db()
        self.assertEqual(succeeded, {'claimed': 1, 'published': 1, 'failed': 0})
        self.assertEqual(event.status, OutboxEventStatus.PUBLISHED)
        self.assertEqual(event.attempts, 2)
        self.assertEqual(delivered[0].name, 'notification.created')

    def test_outbox_processor_reclaims_stale_processing_event(self):
        self.invite_and_accept()
        self.client.force_authenticate(self.owner)
        self.create_mention([self.member_user.id])
        event = OutboxEvent.objects.get()
        event.status = OutboxEventStatus.PROCESSING
        event.locked_at = timezone.now() - timedelta(minutes=10)
        event.save(update_fields=['status', 'locked_at'])

        delivered = []
        result = process_outbox_events(
            event_dispatcher=delivered.append,
            reclaim_after_seconds=60,
        )
        event.refresh_from_db()

        self.assertEqual(result, {'claimed': 1, 'published': 1, 'failed': 0})
        self.assertEqual(event.status, OutboxEventStatus.PUBLISHED)
        self.assertEqual(delivered[0].name, 'notification.created')

    def test_outbox_failure_rolls_back_comment_mention_and_notification(self):
        self.invite_and_accept()
        self.client.force_authenticate(self.owner)
        with patch(
            'app.services.notifications.OutboxEvent.objects.create',
            side_effect=RuntimeError('outbox unavailable'),
        ):
            with self.assertRaises(RuntimeError):
                self.create_mention([self.member_user.id])

        self.assertFalse(ReviewComment.objects.exists())
        self.assertFalse(ReviewCommentMention.objects.exists())
        self.assertFalse(Notification.objects.exists())
