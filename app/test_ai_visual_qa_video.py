"""AI Visual QA on video: sampling, tracking, time ranges, caps, cancel and notifications."""
import shutil
import subprocess
import tempfile
from pathlib import Path
from unittest import skipUnless

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse

from .ai_qa import video as vid
from .ai_qa.spelling import Candidate
from .models import AIFinding, AIReview, Annotation, File, MediaVersion, Notification
from .services import process_outbox_events
from .test_access_projects import WorkspaceAccessSetupMixin

HAS_FFMPEG = bool(shutil.which('ffmpeg') and shutil.which('ffprobe'))


def cand(word, x=0.1, y=0.5, band='high'):
    return Candidate(category='POSSIBLE_SPELLING_ERROR', band=band, detected_text=word, suggested_text='x',
                     context_text=word, explanation='', ocr_confidence=0.97, decision_confidence=0.9,
                     region={'x': x, 'y': y, 'width': 0.2, 'height': 0.05})


class TrackingTests(TestCase):
    def test_sightings_of_a_moving_word_merge_into_one_track(self):
        frames = [(t, [cand('PREMUIM', x=0.1 + t / 20000)]) for t in range(1000, 3001, 500)]
        [track] = vid.build_tracks(frames)
        self.assertEqual((track.start_ms, track.end_ms, len(track.sightings)), (1000, 3000, 5))

    def test_a_long_gap_or_another_place_starts_a_new_track(self):
        frames = [(0, [cand('PREMUIM')]), (500, [cand('PREMUIM')]), (5000, [cand('PREMUIM')]), (5500, [cand('PREMUIM', y=0.05)])]
        self.assertEqual(len(vid.build_tracks(frames)), 3)

    def test_a_subtitle_on_a_static_shot_is_not_a_duplicate(self):
        from PIL import Image, ImageDraw
        with tempfile.TemporaryDirectory() as work:
            plain = Image.new('RGB', (1280, 720), (30, 28, 52))
            subbed = plain.copy()
            ImageDraw.Draw(subbed).rectangle([440, 630, 840, 680], fill=(0, 0, 0))
            ImageDraw.Draw(subbed).text((460, 640), 'You will recieve a gift', fill=(255, 255, 255))
            plain.save(f'{work}/a.jpg'); plain.save(f'{work}/b.jpg', quality=70); subbed.save(f'{work}/c.jpg')
            a, b, c = (vid.fingerprint(f'{work}/{n}.jpg') for n in 'abc')
            self.assertLess(vid.changed_fraction(a, b), 0.002)
            self.assertGreater(vid.changed_fraction(a, c), 0.002)

    def test_dense_windows_only_where_text_changes(self):
        a, b = frozenset({'sale'}), frozenset({'sale', 'premuim'})
        samples = [(0, a), (500, a), (1000, b), (1500, b), (2000, frozenset())]
        self.assertEqual(vid.dense_windows(samples), [(501, 999), (1501, 1999)])


def make_video(path, seconds=4):
    subprocess.run(
        ['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', f'testsrc=size=320x180:rate=25:duration={seconds}',
         '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', str(path)],
        check=True,
    )
    return Path(path).read_bytes()


TIMELINE = [
    {'start_ms': 0, 'end_ms': 4000, 'text': 'SUMMER SALE', 'box': [0.1, 0.1, 0.6, 0.1]},
    {'start_ms': 1000, 'end_ms': 3000, 'text': 'PREMUIM QUALITY', 'box': [0.05, 0.4, 0.5, 0.1], 'dx_per_s': 0.1},
    {'start_ms': 2000, 'end_ms': 4000, 'text': 'Recieve your free gift', 'box': [0.2, 0.85, 0.6, 0.06]},
]


@skipUnless(HAS_FFMPEG, 'ffmpeg is required for the video pipeline tests')
# The fake engine scripts text by time on a near-static test pattern, so frame dedupe is off
# here (it would replay one frame's script on the next); `test_near_duplicates_skip_ocr` covers it.
@override_settings(AI_VISUAL_QA_ENABLED=True, AI_QA_ENGINE='fake', AI_QA_DEDUPE_FRAMES=False)
class VideoQAApiTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='blazeflow-aiqa-video-')
        self.settings_override = override_settings(MEDIA_ROOT=self.media_root)
        self.settings_override.enable()
        super().setUp()
        self.client.force_authenticate(self.owner)
        self.project_id = self.client.post(reverse('api-projects', args=[self.workspace.id]), {'name': 'Spots'}, format='json').json()['id']
        data = make_video(Path(self.media_root) / 'spot.mp4')
        response = self.client.post(
            reverse('api-media-versions', args=[self.workspace.id, self.project_id]),
            {'file': SimpleUploadedFile('spot.mp4', data, content_type='video/mp4'), 'title': 'Spot'}, format='multipart',
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.media_id = response.json()['id']
        self.file = File.objects.get(id=MediaVersion.objects.get(id=self.media_id).original_file_id)
        self.file.metadata = {**(self.file.metadata or {}), 'fake_ocr_timeline': TIMELINE}
        self.file.save(update_fields=['metadata'])
        self.args = [self.workspace.id, self.project_id, self.media_id]

    def tearDown(self):
        self.settings_override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)
        super().tearDown()

    def start(self):
        response = self.client.post(reverse('api-ai-reviews', args=self.args), {}, format='json')
        self.assertEqual(response.status_code, 202, response.content)
        return response.json()

    def run_check(self):
        review = self.start()
        process_outbox_events()
        return self.client.get(reverse('api-ai-review-detail', args=[*self.args, review['id']])).json()

    def findings(self, review_id):
        return self.client.get(reverse('api-ai-review-findings', args=[*self.args, review_id])).json()

    def test_typos_become_one_finding_each_with_a_time_range(self):
        review = self.run_check()
        self.assertEqual(review['status'], 'SUCCEEDED', review)
        self.assertGreaterEqual(review['progress']['frames_total'], 8)
        self.assertEqual(review['progress']['frames_done'], review['progress']['frames_total'])
        by_word = {f['detected_text']: f for f in self.findings(review['id'])}
        self.assertEqual(set(by_word), {'PREMUIM', 'Recieve'})
        premium = by_word['PREMUIM']
        self.assertLessEqual(abs(premium['start_time_ms'] - 1000), 150)
        self.assertLessEqual(abs(premium['end_time_ms'] - 3000), 150)
        self.assertGreater(len(premium['track']), 4)
        self.assertGreater(premium['track'][-1]['x'], premium['track'][0]['x'])  # it moved
        self.assertLessEqual(abs(by_word['Recieve']['start_time_ms'] - 2000), 150)

    def test_near_duplicates_skip_ocr(self):
        with self.settings(AI_QA_DEDUPE_FRAMES=True, AI_QA_DUP_MAX_CHANGED=1.0):
            review = self.run_check()
        self.assertEqual(review['usage']['frames_ocr'], 1)
        self.assertGreater(review['usage']['frames_duplicate'], 0)

    def test_comment_carries_the_time_range_and_a_held_rectangle(self):
        review = self.run_check()
        finding = next(f for f in self.findings(review['id']) if f['detected_text'] == 'PREMUIM')
        result = self.client.post(reverse('api-ai-finding-comment', args=[*self.args, finding['id']]), {}, format='json').json()
        comment = result['comment']
        self.assertEqual((comment['start_time_ms'], comment['end_time_ms']), (finding['start_time_ms'], finding['end_time_ms']))
        self.assertEqual((comment['visibility'], comment['source']), ('team', 'ai_visual_qa'))
        annotation = Annotation.objects.get(review_comment_id=comment['id'])
        self.assertEqual(annotation.start_time_ms, finding['start_time_ms'])
        self.assertGreaterEqual(annotation.end_time_ms, finding['start_time_ms'] + 1500)

    def test_rerun_does_not_duplicate(self):
        first = self.run_check()
        keys = sorted(AIFinding.objects.filter(ai_review_id=first['id']).values_list('dedupe_key', flat=True))
        second = self.run_check()
        self.assertEqual(keys, sorted(AIFinding.objects.filter(ai_review_id=second['id']).values_list('dedupe_key', flat=True)))

    def test_length_cap_is_checked_before_queueing_and_in_the_worker(self):
        self.file.metadata = {**self.file.metadata, 'duration_ms': 16 * 60 * 1000}
        self.file.save(update_fields=['metadata'])
        refused = self.client.post(reverse('api-ai-reviews', args=self.args), {}, format='json')
        self.assertEqual(refused.status_code, 400)
        self.assertEqual(refused.json()['code'], 'ai_qa_too_long')
        self.assertIn('15 minutes', refused.json()['detail'])
        self.file.metadata = {**self.file.metadata, 'duration_ms': None}
        self.file.save(update_fields=['metadata'])
        with self.settings(AI_QA_MAX_VIDEO_SECONDS=2):
            review = self.run_check()
        self.assertEqual((review['status'], review['error_code']), ('FAILED', 'ai_qa_too_long'))

    def test_cancel_stops_the_run(self):
        review = self.start()
        cancelled = self.client.post(reverse('api-ai-review-cancel', args=[*self.args, review['id']]))
        self.assertEqual(cancelled.status_code, 200)
        self.assertEqual(cancelled.json()['status'], 'CANCELLED')
        process_outbox_events()
        self.assertEqual(AIReview.objects.get(id=review['id']).status, 'CANCELLED')
        self.assertFalse(AIFinding.objects.filter(ai_review_id=review['id']).exists())
        again = self.client.post(reverse('api-ai-review-cancel', args=[*self.args, review['id']]))
        self.assertEqual(again.status_code, 409)
        self.assertEqual(self.client.post(reverse('api-ai-reviews', args=self.args), {}, format='json').status_code, 202)

    def test_requester_is_notified_when_it_finishes(self):
        review = self.run_check()
        notification = Notification.objects.get(kind='AI_QA_COMPLETED', recipient_user=self.owner)
        self.assertEqual(notification.entity_id, review['id'])
        self.assertEqual(notification.payload['finding_count'], 2)
        self.assertEqual(notification.payload['status'], 'SUCCEEDED')
        self.assertIn('panel=ai', notification.payload['link'])
        listed = self.client.get(reverse('api-notifications') + f'?workspace={self.workspace.id}').json()
        rows = listed['results'] if isinstance(listed, dict) else listed
        self.assertTrue(any(row['kind'] == 'AI_QA_COMPLETED' for row in rows))
