"""How long a drawing stays on screen, and range notes.

An annotation's ``start_time_ms``/``end_time_ms`` is the window the review player shows the
drawing in (``end == start`` means "just this frame"; no end means the player's default
hold). A comment's own ``end_time_ms`` is only set for an in/out range note. These tests
pin the API and publish paths that carry those windows, and the database guard on them.
"""
import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError, transaction
from django.test import TestCase, override_settings
from django.urls import reverse

from .models import Annotation, File, FileStatus, ReviewComment
from .services.outbox import process_outbox_events
from .test_access_projects import WorkspaceAccessSetupMixin
from .test_publish_to_project import POINT, _png

ELLIPSE = {'element_type': 'ELLIPSE', 'geometry': {'x': 0.2, 'y': 0.2, 'width': 0.3, 'height': 0.2}}


class _MediaRoot(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='blazeflow-window-tests-')
        self.settings_override = override_settings(MEDIA_ROOT=self.media_root, MAX_MEDIA_UPLOAD_BYTES=1024 * 1024, MAX_PROJECT_FILE_BYTES=1024 * 1024)
        self.settings_override.enable()
        super().setUp()
        self.client.force_authenticate(self.owner)
        self.project_id = self.client.post(reverse('api-projects', args=[self.workspace.id]), {'name': 'Window Project'}, format='json').json()['id']

    def tearDown(self):
        self.settings_override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)
        super().tearDown()


class AnnotationWindowApiTests(_MediaRoot):
    def setUp(self):
        super().setUp()
        response = self.client.post(
            reverse('api-media-versions', args=[self.workspace.id, self.project_id]),
            {'file': SimpleUploadedFile('frame.png', _png(), content_type='image/png'), 'title': 'Cut'}, format='multipart',
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.media_id = response.json()['id']

    def create_comment(self, **payload):
        response = self.client.post(
            reverse('api-review-comments', args=[self.workspace.id, self.project_id, self.media_id]),
            {'text': 'testing circle', **payload}, format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        return response

    def annotations_url(self):
        return reverse('api-annotations', args=[self.workspace.id, self.project_id, self.media_id])

    def draw(self, **payload):
        return self.client.post(self.annotations_url(), {'elements': [ELLIPSE], **payload}, format='json')

    def test_drawing_keeps_its_display_window(self):
        comment = self.create_comment(start_time_ms=2000).json()
        held = self.draw(review_comment_id=comment['id'], start_time_ms=2000, end_time_ms=7000)
        self.assertEqual(held.status_code, 201, held.content)
        self.assertEqual((held.json()['start_time_ms'], held.json()['end_time_ms']), (2000, 7000))

        frame = self.draw(start_time_ms=4000, end_time_ms=4000)
        self.assertEqual(frame.status_code, 201, frame.content)
        self.assertEqual(frame.json()['end_time_ms'], 4000)

        listed = {item['id']: item for item in self.client.get(self.annotations_url()).json()}
        self.assertEqual(listed[held.json()['id']]['end_time_ms'], 7000)

    def test_a_window_cannot_run_backwards_or_float_without_a_start(self):
        self.assertEqual(self.draw(start_time_ms=5000, end_time_ms=4000).status_code, 400)
        self.assertEqual(self.draw(end_time_ms=4000).status_code, 400)

    def test_the_window_can_be_changed_after_posting(self):
        created = self.draw(start_time_ms=2000, end_time_ms=7000).json()
        url = reverse('api-annotation-detail', args=[self.workspace.id, self.project_id, self.media_id, created['id']])
        patched = self.client.patch(url, {'elements': [ELLIPSE], 'end_time_ms': 12000}, format='json')
        self.assertEqual(patched.status_code, 200, patched.content)
        self.assertEqual((patched.json()['start_time_ms'], patched.json()['end_time_ms']), (2000, 12000))

    def test_range_note_round_trips(self):
        created = self.create_comment(start_time_ms=2000, end_time_ms=9500).json()
        self.assertEqual((created['start_time_ms'], created['end_time_ms']), (2000, 9500))

    def test_database_refuses_a_backwards_window(self):
        annotation = Annotation.objects.get(id=self.draw(start_time_ms=1000, end_time_ms=2000).json()['id'])
        with self.assertRaises(IntegrityError), transaction.atomic():
            Annotation.objects.filter(id=annotation.id).update(end_time_ms=500)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Annotation.objects.filter(id=annotation.id).update(start_time_ms=None)
        comment = ReviewComment.objects.get(id=self.create_comment(start_time_ms=3000).json()['id'])
        with self.assertRaises(IntegrityError), transaction.atomic():
            ReviewComment.objects.filter(id=comment.id).update(end_time_ms=1000)


class PublishCarriesWindowTests(_MediaRoot):
    def setUp(self):
        super().setUp()
        response = self.client.post(
            reverse('api-asset-files', args=[self.workspace.id]),
            {'file': SimpleUploadedFile('library.png', _png(), content_type='image/png')}, format='multipart',
        )
        self.assertEqual(response.status_code, 201, response.content)
        process_outbox_events()
        process_outbox_events()
        File.objects.filter(id=response.json()['file']['id']).update(status=FileStatus.READY)
        self.asset = response.json()

    def publish(self, **payload):
        return self.client.post(
            reverse('api-asset-file-publish', args=[self.workspace.id, self.asset['id']]),
            {'project_id': self.project_id, **payload}, format='json',
        )

    def test_publish_keeps_drawing_duration_and_range(self):
        response = self.publish(
            notes=[
                {'key': 'held', 'text': 'testing circle', 'start_time_ms': 2000, 'annotation_end_time_ms': 7000, 'elements': [ELLIPSE]},
                {'key': 'range', 'text': 'whole shot', 'start_time_ms': 3000, 'end_time_ms': 9000,
                 'annotation_end_time_ms': 9000, 'elements': [POINT]},
                {'key': 'frame', 'text': 'this frame', 'start_time_ms': 4000, 'annotation_end_time_ms': 4000, 'elements': [POINT]},
                {'key': 'plain', 'text': 'no drawing', 'start_time_ms': 5000},
            ],
            annotations=[{'start_time_ms': 6000, 'end_time_ms': 8000, 'elements': [POINT]}],
        )
        self.assertEqual(response.status_code, 201, response.content)
        ids = response.json()['comment_ids']
        comments = {key: ReviewComment.objects.get(id=value) for key, value in ids.items()}
        self.assertIsNone(comments['held'].end_time_ms)
        self.assertEqual(comments['range'].end_time_ms, 9000)
        drawn = {str(item.review_comment_id): item for item in Annotation.objects.filter(review_comment_id__in=ids.values())}
        self.assertEqual(drawn[ids['held']].end_time_ms, 7000)
        self.assertEqual(drawn[ids['range']].end_time_ms, 9000)
        self.assertEqual(drawn[ids['frame']].end_time_ms, 4000)
        loose = Annotation.objects.get(review_comment__isnull=True, media_version_id=response.json()['media_version']['id'])
        self.assertEqual((loose.start_time_ms, loose.end_time_ms), (6000, 8000))

    def test_publish_refuses_a_drawing_that_ends_before_it_starts(self):
        refused = self.publish(notes=[{'key': 'n', 'text': 'x', 'start_time_ms': 5000, 'annotation_end_time_ms': 1000, 'elements': [POINT]}])
        self.assertEqual(refused.status_code, 400)
        self.assertFalse(ReviewComment.objects.exists())
        unpinned = self.publish(notes=[{'key': 'n', 'text': 'x', 'end_time_ms': 1000}])
        self.assertEqual(unpinned.status_code, 400)
