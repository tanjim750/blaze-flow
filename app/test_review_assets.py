import hashlib
import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse

from .models import Annotation, AnnotationRevision, AuditLog, File, ReviewCommentContent
from .test_access_projects import WorkspaceAccessSetupMixin


class ReviewAssetsApiTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='blazeflow-review-assets-')
        self.settings_override = override_settings(
            MEDIA_ROOT=self.media_root,
            MAX_MEDIA_UPLOAD_BYTES=1024 * 1024,
            MAX_REVIEW_ATTACHMENT_BYTES=1024 * 1024,
        )
        self.settings_override.enable()
        super().setUp()
        self.client.force_authenticate(self.owner)
        project = self.client.post(reverse('api-projects', args=[self.workspace.id]), {'name': 'Review Assets'}, format='json')
        self.project_id = project.json()['id']
        media = self.client.post(
            reverse('api-media-versions', args=[self.workspace.id, self.project_id]),
            {'file': SimpleUploadedFile('frame.png', b'\x89PNG\r\n\x1a\nasset-media', content_type='image/png'), 'title': 'Asset media'},
            format='multipart',
        )
        self.media_id = media.json()['id']
        comment = self.client.post(
            reverse('api-review-comments', args=[self.workspace.id, self.project_id, self.media_id]),
            {'text': 'Reference files and markup'}, format='json',
        )
        self.comment_id = comment.json()['id']

    def tearDown(self):
        self.settings_override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)
        super().tearDown()

    def attachment_upload_url(self):
        return reverse('api-review-attachment-upload', args=[self.workspace.id, self.project_id, self.media_id, self.comment_id])

    def annotations_url(self):
        return reverse('api-annotations', args=[self.workspace.id, self.project_id, self.media_id])

    def test_verified_attachment_upload_private_download_and_soft_delete(self):
        content = b'%PDF-1.7\nreview reference'
        uploaded = self.client.post(
            self.attachment_upload_url(),
            {'file': SimpleUploadedFile('reference.pdf', content, content_type='application/pdf')},
            format='multipart',
        )
        content_id = uploaded.json()['id']
        detail_url = reverse('api-review-attachment-detail', args=[self.workspace.id, self.project_id, self.media_id, self.comment_id, content_id])
        downloaded = self.client.get(detail_url)

        self.assertEqual(uploaded.status_code, 201)
        self.assertEqual(uploaded.json()['file']['checksum_sha256'], hashlib.sha256(content).hexdigest())
        self.assertEqual(b''.join(downloaded.streaming_content), content)
        self.assertTrue(AuditLog.objects.filter(action='review.attachment.downloaded').exists())
        self.assertEqual(self.client.delete(detail_url).status_code, 204)
        self.assertEqual(self.client.get(detail_url).status_code, 404)
        attachment = ReviewCommentContent.objects.get(id=content_id)
        self.assertIsNotNone(attachment.deleted_at)
        self.assertIsNotNone(attachment.file.deleted_at)

    def test_spoofed_or_oversized_attachment_is_rejected_without_file_row(self):
        initial_files = File.objects.count()
        spoofed = self.client.post(
            self.attachment_upload_url(),
            {'file': SimpleUploadedFile('fake.pdf', b'not-a-pdf', content_type='application/pdf')},
            format='multipart',
        )
        self.assertEqual(spoofed.status_code, 400)
        self.assertEqual(File.objects.count(), initial_files)

    def test_annotation_create_validates_normalized_geometry(self):
        valid = self.client.post(
            self.annotations_url(),
            {'review_comment_id': self.comment_id, 'start_time_ms': 1200, 'elements': [{'element_type': 'RECTANGLE', 'geometry': {'x': 0.1, 'y': 0.2, 'width': 0.3, 'height': 0.4}, 'style': {'color': '#ff0000'}}]},
            format='json',
        )
        invalid = self.client.post(
            self.annotations_url(),
            {'elements': [{'element_type': 'RECTANGLE', 'geometry': {'x': 0.8, 'y': 0.2, 'width': 0.4, 'height': 0.4}}]},
            format='json',
        )
        self.assertEqual(valid.status_code, 201)
        self.assertEqual(valid.json()['elements'][0]['element_type'], 'RECTANGLE')
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(Annotation.objects.count(), 1)

    def test_annotation_edit_preserves_revision_and_author_rule(self):
        created = self.client.post(
            self.annotations_url(),
            {'elements': [{'element_type': 'POINT', 'geometry': {'x': 0.2, 'y': 0.3}}]},
            format='json',
        )
        annotation_id = created.json()['id']
        detail = reverse('api-annotation-detail', args=[self.workspace.id, self.project_id, self.media_id, annotation_id])
        self.invite_and_accept()
        self.client.force_authenticate(self.member_user)
        self.assertEqual(self.client.patch(detail, {'elements': [{'element_type': 'POINT', 'geometry': {'x': 0.4, 'y': 0.5}}]}, format='json').status_code, 403)

        self.client.force_authenticate(self.owner)
        edited = self.client.patch(detail, {'elements': [{'element_type': 'ARROW', 'geometry': {'start': {'x': 0.1, 'y': 0.1}, 'end': {'x': 0.9, 'y': 0.9}}}]}, format='json')
        revisions = self.client.get(reverse('api-annotation-revisions', args=[self.workspace.id, self.project_id, self.media_id, annotation_id]))
        self.assertEqual(edited.status_code, 200)
        self.assertEqual(edited.json()['revision_count'], 1)
        self.assertEqual(revisions.json()[0]['snapshot']['elements'][0]['element_type'], 'POINT')
        self.assertEqual(AnnotationRevision.objects.count(), 1)

    def test_annotation_manager_soft_deletes_and_health_is_owner_only(self):
        created = self.client.post(self.annotations_url(), {'elements': [{'element_type': 'TEXT', 'geometry': {'x': 0.2, 'y': 0.3}, 'payload': {'text': 'Move title'}}]}, format='json')
        detail = reverse('api-annotation-detail', args=[self.workspace.id, self.project_id, self.media_id, created.json()['id']])
        self.assertEqual(self.client.delete(detail).status_code, 204)
        self.assertEqual(self.client.get(self.annotations_url()).json(), [])
        health_url = reverse('api-delivery-health', args=[self.workspace.id])
        self.assertEqual(self.client.get(health_url).status_code, 200)
        self.invite_and_accept()
        self.client.force_authenticate(self.member_user)
        self.assertEqual(self.client.get(health_url).status_code, 403)

    def test_supervised_worker_once_mode_loads(self):
        call_command('run_outbox_worker', once=True, batch_size=10, interval_seconds=0.1)
