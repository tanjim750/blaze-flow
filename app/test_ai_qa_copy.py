"""AI Visual QA PR 3: approved-copy compare (alignment, finding types, runs, saved copy)."""
import shutil
import tempfile
from pathlib import Path
from unittest import skipUnless

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, TestCase, override_settings
from django.urls import reverse

from .ai_qa.copy_compare import MISMATCH, MISSING, TYPO, UNEXPECTED, Unit, compare, video_units
from .ai_qa.engines import OcrLine
from .models import AIReview, ApprovedCopy, File, MediaVersion
from .services import process_outbox_events
from .test_access_projects import WorkspaceAccessSetupMixin
from .test_ai_visual_qa import poster_png
from .test_ai_visual_qa_video import HAS_FFMPEG, make_video

COPY = """SUMMER SALE
Up to 50% off everything
Cold-brew coffee from £3.50
Terms and conditions apply. Offer ends 31 August 2027."""


def kinds(rows):
    return sorted((r['category'], r['detected_text'].casefold(), r['suggested_text'].casefold()) for r in rows)


class AlignmentTests(SimpleTestCase):
    def test_styling_line_breaks_case_punctuation_and_order_are_not_differences(self):
        units = [Unit('Offer ends 31 August 2027', 0.9), Unit('TERMS & CONDITIONS APPLY.', 0.9),
                 Unit('COLDBREW COFFEE FROM £3.50', 0.95), Unit('UP TO 50% OFF', 0.95), Unit('everything!', 0.95),
                 Unit('Summer  sale', 0.97)]
        self.assertEqual(compare(COPY, units), [])

    def test_each_kind_of_difference_gets_its_own_type(self):
        units = [Unit('SUMER SALE', 0.97), Unit('Up to 50% off everything', 0.95),
                 Unit('Cold brew coffee from £4.50', 0.95), Unit('Download our app', 0.95)]
        found = kinds(compare(COPY, units))
        self.assertIn((TYPO, 'sumer', 'summer'), found)
        self.assertIn((MISMATCH, '£4.50', '£3.50'), found)
        self.assertIn((UNEXPECTED, 'download our app', ''), found)
        self.assertIn((MISSING, '', 'terms and conditions apply offer ends 31 august 2027'), found)
        self.assertEqual(len(found), 4)

    def test_a_different_word_is_a_mismatch_not_a_typo(self):
        found = kinds(compare('Fresh bread daily', [Unit('Fresh cake daily', 0.95)]))
        self.assertEqual(found, [(MISMATCH, 'cake', 'bread')])

    def test_legal_wording_differences_are_mismatches_never_typos(self):
        units = [Unit('SUMMER SALE', 0.97), Unit('Up to 50% off everything', 0.95), Unit('Cold brew coffee from £3.50', 0.95),
                 Unit('Terms and condition apply. Offer ends 31 August 2027.', 0.8)]
        rows = compare(COPY, units)
        self.assertEqual([(r['category'], r['band']) for r in rows], [(MISMATCH, 'medium')])

    def test_digit_for_letter_misreads_are_ignored_and_letter_confusables_are_low(self):
        self.assertEqual(compare('UP TO 50% OFF', [Unit('UP T0 50% 0FF', 0.97)]), [])
        rows = compare('MODERN CLASSICS', [Unit('MODEM CLASSICS', 0.97)])
        self.assertEqual([(r['category'], r['band']) for r in rows], [(TYPO, 'low')])

    def test_video_tracks_carry_time_ranges_and_ignore_misread_flickers(self):
        box = [[0.1, 0.1], [0.5, 0.1], [0.5, 0.2], [0.1, 0.2]]
        observed = {t: [OcrLine('SUMMER SALE', 0.97, box)] for t in range(0, 3000, 500)}
        observed[1000] = [OcrLine('SUMMFR SALE', 0.7, box)]  # one misread frame
        for t in range(3000, 5000, 500):
            observed[t] = [OcrLine('Up to 50% off everyting', 0.95, box)]
        rows = compare('SUMMER SALE\nUp to 50% off everything', video_units(observed))
        self.assertEqual(kinds(rows), [(TYPO, 'everyting', 'everything')])
        self.assertEqual((rows[0]['start_time_ms'], rows[0]['end_time_ms']), (3000, 4500))
        self.assertEqual(len(rows[0]['track']), 4)

    def test_typewriter_reveal_is_not_a_typo(self):
        box = [[0, 0], [1, 0], [1, 0.1], [0, 0.1]]
        observed = {0: [OcrLine('SUM', 0.9, box)], 500: [OcrLine('SUMMER', 0.95, box)], 1000: [OcrLine('SUMMER SA', 0.95, box)],
                    1500: [OcrLine('SUMMER SALE', 0.97, box)], 2000: [OcrLine('SUMMER SALE', 0.97, box)]}
        self.assertEqual(compare('SUMMER SALE', video_units(observed)), [])


@override_settings(AI_VISUAL_QA_ENABLED=True, AI_QA_ENGINE='fake')
class ApprovedCopyApiTests(WorkspaceAccessSetupMixin, TestCase):
    POSTER = [
        {'text': 'SUMER SALE', 'confidence': 0.97, 'box': [0.1, 0.1, 0.8, 0.1]},
        {'text': 'Up to 50% off everything', 'confidence': 0.96, 'box': [0.1, 0.3, 0.8, 0.08]},
        {'text': 'Cold brew coffee from £4.50', 'confidence': 0.96, 'box': [0.1, 0.5, 0.8, 0.08]},
    ]

    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='blazeflow-aiqa-copy-')
        self.settings_override = override_settings(MEDIA_ROOT=self.media_root)
        self.settings_override.enable()
        super().setUp()
        self.client.force_authenticate(self.owner)
        self.project_id = self.client.post(reverse('api-projects', args=[self.workspace.id]), {'name': 'Posters'}, format='json').json()['id']
        response = self.client.post(
            reverse('api-media-versions', args=[self.workspace.id, self.project_id]),
            {'file': SimpleUploadedFile('poster.png', poster_png(self.POSTER), content_type='image/png'), 'title': 'poster.png'},
            format='multipart',
        )
        self.media_id = response.json()['id']
        self.args = [self.workspace.id, self.project_id, self.media_id]

    def tearDown(self):
        self.settings_override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)
        super().tearDown()

    def run_check(self, **body):
        response = self.client.post(reverse('api-ai-reviews', args=self.args), body, format='json')
        self.assertIn(response.status_code, (200, 202), response.content)
        process_outbox_events()
        review_id = response.json()['id']
        return review_id, self.client.get(reverse('api-ai-review-findings', args=[*self.args, review_id])).json()

    def test_compare_run_returns_typed_findings_with_regions_and_comment_text(self):
        review_id, findings = self.run_check(mode='COMPARE', approved_copy_text=COPY)
        self.assertEqual(AIReview.objects.get(id=review_id).status, 'SUCCEEDED')
        by = {f['category']: f for f in findings}
        self.assertEqual(set(by), {TYPO, MISMATCH, MISSING})
        self.assertEqual(by[TYPO]['suggested_text'], 'SUMMER')
        self.assertTrue(by[TYPO]['region'])
        self.assertEqual(by[MISSING]['region'], {})
        comment = self.client.post(reverse('api-ai-finding-comment', args=[*self.args, by[MISMATCH]['id']]), {}, format='json')
        self.assertEqual(comment.status_code, 201, comment.content)
        self.assertEqual(comment.json()['comment']['visibility'], 'team')
        self.assertIn('approved copy says “£3.50”', comment.json()['comment']['text'] if 'text' in comment.json()['comment'] else str(comment.json()))
        missing = self.client.post(reverse('api-ai-finding-comment', args=[*self.args, by[MISSING]['id']]), {}, format='json')
        self.assertEqual(missing.status_code, 201, missing.content)

    def test_both_mode_does_not_double_report_and_approved_words_are_never_spelling_errors(self):
        _, findings = self.run_check(mode='BOTH', approved_copy_text=COPY + '\nNorthlightz Kwikbrew')
        cats = [f['category'] for f in findings]
        self.assertNotIn('POSSIBLE_SPELLING_ERROR', [c for c, f in zip(cats, findings) if f['detected_text'].casefold() == 'sumer'])
        self.assertEqual(cats.count(TYPO), 1)

    def test_project_copy_is_versioned_and_can_be_picked_for_a_run(self):
        url = reverse('api-ai-approved-copy', args=[self.workspace.id, self.project_id])
        v1 = self.client.post(url, {'text': 'SUMMER SALE'}, format='json').json()
        same = self.client.post(url, {'text': 'SUMMER SALE'}, format='json').json()
        v2 = self.client.post(url, {'text': COPY}, format='json').json()
        self.assertEqual((v1['version'], same['id'], v2['version']), (1, v1['id'], 2))
        self.assertEqual([c['version'] for c in self.client.get(url).json()], [2, 1])
        review_id, findings = self.run_check(mode='COMPARE', approved_copy_id=v2['id'])
        self.assertEqual(str(AIReview.objects.get(id=review_id).approved_copy_id), v2['id'])
        self.assertTrue(any(f['category'] == MISMATCH for f in findings))

    def test_pasted_copy_is_kept_with_the_run_but_not_listed_on_the_project(self):
        self.run_check(mode='COMPARE', approved_copy_text='SUMMER SALE')
        self.assertEqual(ApprovedCopy.objects.filter(source='paste').count(), 1)
        self.assertEqual(self.client.get(reverse('api-ai-approved-copy', args=[self.workspace.id, self.project_id])).json(), [])

    def test_compare_needs_copy_and_outsiders_cannot_see_it(self):
        response = self.client.post(reverse('api-ai-reviews', args=self.args), {'mode': 'COMPARE'}, format='json')
        self.assertEqual(response.status_code, 400)
        from django.contrib.auth import get_user_model
        outsider = get_user_model().objects.create_user(email='out@example.com', password='x-pass-12345', first_name='Out', last_name='Sider')
        self.client.force_authenticate(outsider)
        self.assertEqual(self.client.get(reverse('api-ai-approved-copy', args=[self.workspace.id, self.project_id])).status_code, 404)


@skipUnless(HAS_FFMPEG, 'ffmpeg is required for the video pipeline tests')
@override_settings(AI_VISUAL_QA_ENABLED=True, AI_QA_ENGINE='fake', AI_QA_DEDUPE_FRAMES=False)
class VideoCopyCompareTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='blazeflow-aiqa-copyv-')
        self.settings_override = override_settings(MEDIA_ROOT=self.media_root)
        self.settings_override.enable()
        super().setUp()
        self.client.force_authenticate(self.owner)
        self.project_id = self.client.post(reverse('api-projects', args=[self.workspace.id]), {'name': 'Spots'}, format='json').json()['id']
        data = make_video(Path(self.media_root) / 'spot.mp4')
        response = self.client.post(reverse('api-media-versions', args=[self.workspace.id, self.project_id]),
                                    {'file': SimpleUploadedFile('spot.mp4', data, content_type='video/mp4'), 'title': 'Spot'}, format='multipart')
        self.media_id = response.json()['id']
        file = File.objects.get(id=MediaVersion.objects.get(id=self.media_id).original_file_id)
        file.metadata = {**(file.metadata or {}), 'fake_ocr_timeline': [
            {'start_ms': 0, 'end_ms': 1800, 'text': 'SUMMER SALE', 'box': [0.1, 0.1, 0.6, 0.1]},
            {'start_ms': 2000, 'end_ms': 4000, 'text': 'Up to 60% off everything', 'box': [0.1, 0.8, 0.8, 0.08]},
        ]}
        file.save(update_fields=['metadata'])

    def tearDown(self):
        self.settings_override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)
        super().tearDown()

    def test_video_compare_reports_per_track_time_ranges(self):
        args = [self.workspace.id, self.project_id, self.media_id]
        response = self.client.post(reverse('api-ai-reviews', args=args), {'mode': 'COMPARE', 'approved_copy_text': 'SUMMER SALE\nUp to 50% off everything\nShop now'}, format='json')
        process_outbox_events()
        findings = self.client.get(reverse('api-ai-review-findings', args=[*args, response.json()['id']])).json()
        by = {f['category']: f for f in findings}
        self.assertEqual(set(by), {MISMATCH, MISSING})
        self.assertEqual((by[MISMATCH]['detected_text'], by[MISMATCH]['suggested_text']), ('60%', '50%'))
        self.assertGreaterEqual(by[MISMATCH]['start_time_ms'], 1500)
        self.assertLessEqual(by[MISMATCH]['end_time_ms'], 4000)
        self.assertEqual(by[MISSING]['suggested_text'], 'Shop now')
