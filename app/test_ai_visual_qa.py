"""AI Visual QA: image proofreading runs, findings, decisions, comments and access."""
import io
import json
import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse
from PIL import Image, PngImagePlugin

from .ai_qa.engines import OcrLine
from .ai_qa.spelling import check_line
from .models import (
    AIFinding, AIFrameObservation, AIReview, Annotation, AnnotationElement, GlossaryTerm,
    OutboxEvent, ReviewComment,
)
from .services import process_outbox_events
from .services.workspaces import create_workspace
from .test_access_projects import WorkspaceAccessSetupMixin


def poster_png(lines):
    """A PNG whose `blazeflow-ocr` chunk tells the fake engine what it 'reads'."""
    image = Image.new('RGB', (400, 500), (20, 30, 60))
    info = PngImagePlugin.PngInfo()
    info.add_text('blazeflow-ocr', json.dumps(lines))
    buffer = io.BytesIO()
    image.save(buffer, format='PNG', pnginfo=info)
    return buffer.getvalue()


TYPO_POSTER = [
    {'text': 'SUMMER SALE', 'confidence': 0.97, 'box': [0.1, 0.1, 0.8, 0.1]},
    {'text': 'PREMUIM QUALITY', 'confidence': 0.98, 'box': [0.1, 0.3, 0.8, 0.1]},
    {'text': 'Visit www.northlight.studio @northlight #ad', 'confidence': 0.95, 'box': [0.1, 0.8, 0.8, 0.05]},
]


def line(text, confidence=0.97):
    return OcrLine(text=text, confidence=confidence, polygon=[[0, 0], [1, 0], [1, 0.1], [0, 0.1]])


class SpellingCascadeTests(TestCase):
    def test_flags_a_clear_typo_with_suggestion(self):
        [found] = check_line(line('PREMUIM QUALITY'))
        self.assertEqual((found.category, found.band, found.suggested_text), ('POSSIBLE_SPELLING_ERROR', 'high', 'PREMIUM'))
        self.assertLess(found.region['width'], 0.6)  # the word, not the whole line

    def test_skips_urls_handles_hashtags_and_acronyms(self):
        self.assertEqual(check_line(line('Visit www.northlight.studio or shop.example.com @northlight #ad NASA')), [])

    def test_glossary_terms_are_never_flagged(self):
        self.assertTrue(check_line(line('Recieve a Blazeflw gift')))
        self.assertEqual(check_line(line('Blazeflw rocks'), glossary=frozenset({'blazeflw'})), [])

    def test_ocr_confusables_are_uncertain_not_spelling(self):
        found = check_line(line('0FFER ends s00n'))
        self.assertEqual({f.category for f in found}, {'OCR_UNCERTAIN'})
        self.assertEqual([f.suggested_text for f in found], ['OFFER', 'soon'])

    def test_low_ocr_confidence_is_uncertain(self):
        [found] = check_line(line('Recieve', confidence=0.4))
        self.assertEqual((found.category, found.band), ('OCR_UNCERTAIN', 'low'))

    def test_british_and_american_spellings_both_pass(self):
        self.assertEqual(check_line(line('colour color organise organize')), [])

    def test_times_units_ampersands_and_compounds_pass(self):
        self.assertEqual(check_line(line('Order by 5pm on the 3rd in 4K T&Cs apply join the waitlist')), [])
        self.assertEqual([f.detected_text for f in check_line(line('the new semster'))], ['semster'])

    def test_unknown_capitalised_names_are_quiet(self):
        found = check_line(line('Meet Zorblatt today'))
        self.assertEqual(found, [])


@override_settings(AI_VISUAL_QA_ENABLED=True, AI_QA_ENGINE='fake')
class AIVisualQAApiTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='blazeflow-aiqa-')
        self.settings_override = override_settings(MEDIA_ROOT=self.media_root)
        self.settings_override.enable()
        super().setUp()
        self.client.force_authenticate(self.owner)
        self.project_id = self.client.post(reverse('api-projects', args=[self.workspace.id]), {'name': 'Posters'}, format='json').json()['id']
        self.media_id = self.upload(TYPO_POSTER)
        self.args = [self.workspace.id, self.project_id, self.media_id]

    def tearDown(self):
        self.settings_override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)
        super().tearDown()

    def upload(self, lines, name='poster.png'):
        response = self.client.post(
            reverse('api-media-versions', args=[self.workspace.id, self.project_id]),
            {'file': SimpleUploadedFile(name, poster_png(lines), content_type='image/png'), 'title': name},
            format='multipart',
        )
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()['id']

    def run_check(self, args=None):
        response = self.client.post(reverse('api-ai-reviews', args=args or self.args), {'language': 'en-GB'}, format='json')
        self.assertIn(response.status_code, (200, 202), response.content)
        process_outbox_events()
        return response.json()

    def findings(self, review_id, query=''):
        url = reverse('api-ai-review-findings', args=[*self.args, review_id]) + query
        return self.client.get(url).json()

    def test_run_produces_a_finding_with_evidence_and_persisted_state(self):
        started = self.run_check()
        self.assertEqual(started['status'], 'QUEUED')
        detail = self.client.get(reverse('api-ai-review-detail', args=[*self.args, started['id']])).json()
        self.assertEqual(detail['status'], 'SUCCEEDED')
        self.assertEqual(detail['engine'], 'fake')
        self.assertEqual(detail['summary']['total'], 1)
        [finding] = self.findings(started['id'])
        self.assertEqual(finding['detected_text'], 'PREMUIM')
        self.assertEqual(finding['suggested_text'], 'PREMIUM')
        self.assertEqual(finding['band'], 'high')
        self.assertIsNone(finding['start_time_ms'])
        self.assertTrue(0 < finding['region']['width'] < 1)
        self.assertEqual(AIFrameObservation.objects.filter(ai_review_id=started['id']).count(), 3)
        latest = self.client.get(reverse('api-ai-reviews', args=self.args)).json()
        self.assertEqual(latest['latest']['id'], started['id'])
        self.assertTrue(latest['supported'])

    def test_double_start_joins_the_active_run(self):
        first = self.client.post(reverse('api-ai-reviews', args=self.args), {}, format='json')
        second = self.client.post(reverse('api-ai-reviews', args=self.args), {}, format='json')
        self.assertEqual(first.status_code, 202)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.json()['id'], second.json()['id'])
        self.assertEqual(AIReview.objects.count(), 1)

    def test_one_check_at_a_time_per_workspace(self):
        other = self.upload(TYPO_POSTER, name='other.png')
        self.client.post(reverse('api-ai-reviews', args=self.args), {}, format='json')
        busy = self.client.post(reverse('api-ai-reviews', args=[self.workspace.id, self.project_id, other]), {}, format='json')
        self.assertEqual(busy.status_code, 409)
        self.assertEqual(busy.json()['code'], 'ai_qa_busy')

    @override_settings(AI_QA_DAILY_RUNS_PER_WORKSPACE=1)
    def test_daily_cap(self):
        self.run_check()
        capped = self.client.post(reverse('api-ai-reviews', args=self.args), {}, format='json')
        self.assertEqual(capped.status_code, 429)
        self.assertEqual(capped.json()['code'], 'ai_qa_quota')

    def test_video_is_not_supported_yet(self):
        from .models import File, MediaVersion
        media = MediaVersion.objects.get(id=self.media_id)
        File.objects.filter(id=media.original_file_id).update(mime_type='video/mp4')
        response = self.client.post(reverse('api-ai-reviews', args=self.args), {}, format='json')
        self.assertEqual(response.json()['code'], 'ai_qa_unsupported_media')

    def test_add_comment_is_idempotent_team_only_and_draws_the_region(self):
        review = self.run_check()
        [finding] = self.findings(review['id'])
        url = reverse('api-ai-finding-comment', args=[*self.args, finding['id']])
        first = self.client.post(url, {}, format='json')
        again = self.client.post(url, {}, format='json')
        self.assertEqual(first.status_code, 201)
        self.assertEqual(again.status_code, 200)
        comment = first.json()['comment']
        self.assertEqual(comment['id'], again.json()['comment']['id'])
        self.assertEqual(comment['visibility'], 'team')
        self.assertEqual(comment['source'], 'ai_visual_qa')
        self.assertEqual(comment['author']['id'], str(self.owner.id))
        self.assertIn('PREMIUM', comment['text'])
        self.assertEqual(ReviewComment.objects.count(), 1)
        annotation = Annotation.objects.get(review_comment_id=comment['id'])
        element = AnnotationElement.objects.get(annotation=annotation)
        self.assertEqual(element.element_type, 'RECTANGLE')
        self.assertEqual(element.payload['ai_finding_id'], finding['id'])
        self.assertEqual(first.json()['finding']['status'], 'COMMENT_CREATED')

    def test_rerun_never_duplicates_findings_or_comments_and_keeps_decisions(self):
        review = self.run_check()
        [finding] = self.findings(review['id'])
        self.client.post(reverse('api-ai-finding-comment', args=[*self.args, finding['id']]), {}, format='json')
        rerun = self.run_check()
        self.assertNotEqual(rerun['id'], review['id'])
        [again] = self.findings(rerun['id'])
        self.assertEqual(again['status'], 'COMMENT_CREATED')
        self.assertIsNotNone(again['comment_id'])
        repeat = self.client.post(reverse('api-ai-finding-comment', args=[*self.args, again['id']]), {}, format='json')
        self.assertEqual(repeat.status_code, 200)
        self.assertEqual(ReviewComment.objects.count(), 1)

    def test_duplicate_delivery_of_the_job_is_a_noop(self):
        review = self.run_check()
        from .ai_qa.pipeline import run_review
        self.assertIsNone(run_review(review['id']))
        self.assertEqual(AIFinding.objects.filter(ai_review_id=review['id']).count(), 1)

    def test_dismiss_edit_and_not_an_error_with_glossary(self):
        review = self.run_check()
        [finding] = self.findings(review['id'])
        url = reverse('api-ai-finding-detail', args=[*self.args, finding['id']])
        edited = self.client.patch(url, {'edited_suggestion': 'PREMIUM+', 'status': 'ACCEPTED'}, format='json').json()
        self.assertEqual((edited['status'], edited['edited_suggestion']), ('ACCEPTED', 'PREMIUM+'))
        dismissed = self.client.patch(url, {'status': 'NOT_AN_ERROR', 'add_to_glossary': 'project'}, format='json').json()
        self.assertEqual(dismissed['status'], 'NOT_AN_ERROR')
        self.assertTrue(GlossaryTerm.objects.filter(normalized='premuim', project_id=self.project_id).exists())
        rerun = self.run_check()
        self.assertEqual(self.findings(rerun['id']), [])  # the glossary now allows it
        bad = self.client.patch(url, {'status': 'COMMENT_CREATED'}, format='json')
        self.assertEqual(bad.status_code, 400)

    def test_filters(self):
        review = self.run_check()
        self.assertEqual(len(self.findings(review['id'], '?category=OCR_UNCERTAIN')), 0)
        self.assertEqual(len(self.findings(review['id'], '?band=high')), 1)

    def test_glossary_api(self):
        url = reverse('api-ai-glossary', args=[self.workspace.id])
        created = self.client.post(url, {'term': 'Northlight', 'kind': 'brand'}, format='json')
        self.assertEqual(created.status_code, 201)
        self.client.post(url, {'term': 'Zorb', 'project_id': self.project_id}, format='json')
        self.assertEqual([t['term'] for t in self.client.get(url).json()], ['Northlight'])
        self.assertEqual(len(self.client.get(url + f'?project={self.project_id}').json()), 2)
        self.client.delete(reverse('api-ai-glossary-detail', args=[self.workspace.id, created.json()['id']]))
        self.assertEqual(self.client.get(url).json(), [])

    def test_unreadable_image_fails_visibly_and_can_retry(self):
        from .models import File, MediaVersion
        from django.core.files.storage import default_storage
        media = MediaVersion.objects.get(id=self.media_id)
        file = File.objects.get(id=media.original_file_id)
        with default_storage.open(file.object_key, 'wb') as handle:
            handle.write(b'\x89PNG\r\n\x1a\nbroken')
        review = self.run_check()
        detail = self.client.get(reverse('api-ai-review-detail', args=[*self.args, review['id']])).json()
        self.assertEqual((detail['status'], detail['error_code']), ('FAILED', 'ai_qa_unreadable_image'))
        retry = self.client.post(reverse('api-ai-review-retry', args=[*self.args, review['id']]))
        self.assertEqual(retry.status_code, 202)
        self.assertEqual(retry.json()['status'], 'QUEUED')

    def test_other_workspaces_and_anonymous_users_get_nothing(self):
        review = self.run_check()
        [finding] = self.findings(review['id'])
        outsider = type(self.owner).objects.create_user(email='outsider@example.com', password='a-secure-test-password', first_name='Out', last_name='Sider')
        create_workspace(owner=outsider, name='Other', slug='other-ws', workspace_timezone='UTC')
        self.client.force_authenticate(outsider)
        for url in (
            reverse('api-ai-reviews', args=self.args),
            reverse('api-ai-review-detail', args=[*self.args, review['id']]),
            reverse('api-ai-review-findings', args=[*self.args, review['id']]),
            reverse('api-ai-glossary', args=[self.workspace.id]),
        ):
            self.assertEqual(self.client.get(url).status_code, 404, url)
        self.assertEqual(self.client.post(reverse('api-ai-finding-comment', args=[*self.args, finding['id']]), {}, format='json').status_code, 404)
        self.client.force_authenticate(user=None)
        self.assertIn(self.client.get(reverse('api-ai-reviews', args=self.args)).status_code, (401, 403))

    def test_team_member_can_run(self):
        self.invite_and_accept()
        self.client.force_authenticate(self.member_user)
        response = self.client.post(reverse('api-ai-reviews', args=self.args), {}, format='json')
        self.assertEqual(response.status_code, 202, response.content)

    @override_settings(AI_VISUAL_QA_ENABLED=False)
    def test_feature_flag_off_hides_everything(self):
        self.assertEqual(self.client.get(reverse('api-ai-reviews', args=self.args)).status_code, 404)

    def test_general_worker_leaves_ai_jobs_to_the_dedicated_worker(self):
        self.client.post(reverse('api-ai-reviews', args=self.args), {}, format='json')
        call_command('run_outbox_worker', '--once', stdout=io.StringIO())
        self.assertEqual(AIReview.objects.get().status, 'QUEUED')
        call_command('run_ai_qa_worker', '--once', '--no-warm', stdout=io.StringIO())
        self.assertEqual(AIReview.objects.get().status, 'SUCCEEDED')
        self.assertFalse(OutboxEvent.objects.filter(topic='ai_visual_qa.run', status='PENDING').exists())
