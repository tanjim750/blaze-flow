"""Long videos get a real proxy or a visible failure, never a silent review card."""
import shutil
import subprocess
import tempfile
from io import StringIO
from types import SimpleNamespace
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .models import FileVariant, MediaVersion, OutboxEvent, Project
from .services import file_processing
from .services.file_processing import (
    VideoProxyFailed, generate_preview, video_proxy_max_output_bytes, video_proxy_timeout_seconds,
)
from .services.outbox import process_outbox_events
from .services.preview_state import FAILED, PENDING, PROCESSING, READY, RETRYING, preview_status
from .test_access_projects import WorkspaceAccessSetupMixin
from .test_media import _make_test_clip


def _file(duration_ms=None, mime='video/mp4'):
    return SimpleNamespace(id='f', mime_type=mime, metadata={'duration_ms': duration_ms} if duration_ms else {})


@override_settings(
    VIDEO_PROXY_TIMEOUT_SECONDS=600, VIDEO_PROXY_TIMEOUT_PER_SECOND=2, VIDEO_PROXY_TIMEOUT_MARGIN_SECONDS=300,
    VIDEO_PROXY_TIMEOUT_MAX_SECONDS=14400, VIDEO_PROXY_MAX_OUTPUT_BYTES=200 * 1024 * 1024,
    VIDEO_PROXY_AUDIO_BITRATE='128k', VIDEO_PROXY_OUTPUT_HEADROOM=1.25,
)
class ScalingTests(TestCase):
    def test_timeout_scales_with_runtime_and_keeps_its_floor_and_ceiling(self):
        self.assertEqual(video_proxy_timeout_seconds(_file()), 600)
        self.assertEqual(video_proxy_timeout_seconds(_file(60_000)), 600)
        # The 12:07 cut that failed: 2x runtime plus five minutes.
        self.assertEqual(video_proxy_timeout_seconds(_file(726_960)), 1753)
        self.assertEqual(video_proxy_timeout_seconds(_file(10 * 3600_000)), 14400)

    def test_output_cap_scales_with_runtime(self):
        floor = 200 * 1024 * 1024
        self.assertEqual(video_proxy_max_output_bytes(_file(), '5M'), floor)
        self.assertEqual(video_proxy_max_output_bytes(_file(60_000), '5M'), floor)
        long_cap = video_proxy_max_output_bytes(_file(726_960), '5M')
        self.assertEqual(long_cap, int((5_000_000 + 128_000) * 726.96 / 8 * 1.25))
        self.assertGreater(long_cap, floor)

    def test_preset_defaults_to_veryfast(self):
        from django.conf import settings
        self.assertEqual(settings.VIDEO_PROXY_PRESET, 'veryfast')


class PreviewStatusTests(TestCase):
    def event(self, status, **payload):
        return SimpleNamespace(status=status, payload=payload)

    def test_video_states(self):
        video = _file()
        self.assertEqual(preview_status(video, [('VIDEO_PROXY', 'READY')], self.event('PUBLISHED')), READY)
        self.assertEqual(preview_status(video, [], self.event('PENDING')), PENDING)
        self.assertEqual(preview_status(video, [], self.event('PROCESSING')), PROCESSING)
        self.assertEqual(preview_status(video, [], self.event('FAILED')), RETRYING)
        self.assertEqual(preview_status(video, [], self.event('DEAD_LETTER')), FAILED)
        # The production case: a card left behind and the job marked done.
        self.assertEqual(preview_status(video, [('REVIEW_CARD', 'READY')], self.event('PUBLISHED')), FAILED)
        self.assertEqual(preview_status(video, [('REVIEW_CARD', 'READY')], None), FAILED)

    def test_images_still_count_the_card(self):
        image = _file(mime='image/png')
        self.assertEqual(preview_status(image, [('REVIEW_CARD', 'READY')], self.event('PUBLISHED')), READY)


class OutboxAttemptCapTests(TestCase):
    def test_video_proxy_failure_dead_letters_after_its_own_cap(self):
        now = timezone.now()
        event = OutboxEvent.objects.create(
            id='00000000-0000-0000-0000-0000000000a1', topic='test.proxy', aggregate_type='file', aggregate_id='x',
            deduplication_key='test.proxy:x', payload={}, available_at=now, created_at=now, updated_at=now,
        )

        def fail(_event):
            raise VideoProxyFailed('encode timed out')

        with override_settings(VIDEO_PROXY_MAX_ATTEMPTS=2):
            process_outbox_events(event_dispatcher=fail, max_attempts=5)
            event.refresh_from_db()
            self.assertEqual(event.status, 'FAILED')
            OutboxEvent.objects.filter(id=event.id).update(available_at=timezone.now())
            process_outbox_events(event_dispatcher=fail, max_attempts=5)
            event.refresh_from_db()
        self.assertEqual(event.status, 'DEAD_LETTER')
        self.assertEqual(event.attempts, 2)
        self.assertIn('timed out', event.last_error)


class VideoProxyJobTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='blazeflow-proxy-tests-')
        self.override = override_settings(MEDIA_ROOT=self.media_root, MAX_MEDIA_UPLOAD_BYTES=5 * 1024 * 1024)
        self.override.enable()
        super().setUp()
        self.client.force_authenticate(self.owner)
        response = self.client.post(reverse('api-projects', args=[self.workspace.id]), {'name': 'november'}, format='json')
        self.project = Project.objects.get(id=response.json()['id'])

    def tearDown(self):
        self.override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)
        super().tearDown()

    def upload_clip(self):
        response = self.client.post(
            reverse('api-media-versions', args=[self.workspace.id, self.project.id]),
            {'file': SimpleUploadedFile('draft 1 $5000.mp4', _make_test_clip(), content_type='video/mp4'), 'title': 'draft 1 $5000.mp4'},
            format='multipart',
        )
        self.assertEqual(response.status_code, 201, response.content)
        return MediaVersion.objects.select_related('original_file').get(id=response.json()['id'])

    def variant_types(self, media, live=True):
        rows = FileVariant.objects.filter(file=media.original_file)
        if live:
            rows = rows.filter(deleted_at__isnull=True)
        return sorted(row.metadata.get('variant_type') for row in rows)

    def leave_fallback_card(self, media):
        """What the old code left behind: a card, and the job marked done."""
        file_processing._store_variant(media.original_file, file_processing._review_card, types=('REVIEW_CARD',))
        OutboxEvent.objects.filter(topic='file.preview.requested', aggregate_id=str(media.original_file_id)).update(
            status='PUBLISHED', published_at=timezone.now(),
        )

    def test_timeout_raises_logs_stderr_and_stores_no_card(self):
        media = self.upload_clip()
        real_run = subprocess.run

        def run(command, *args, **kwargs):
            if '-c:v' in command and 'libx264' in command:
                raise subprocess.TimeoutExpired(command, kwargs.get('timeout'), stderr=b'frame= 100 speed=0.4x')
            return real_run(command, *args, **kwargs)

        with patch('app.services.file_processing.subprocess.run', side_effect=run), \
                self.assertLogs('app.services.file_processing', level='ERROR') as logs, \
                self.assertRaises(VideoProxyFailed):
            generate_preview(file_id=media.original_file_id)
        self.assertTrue(any('timed out' in line and 'speed=0.4x' in line for line in logs.output))
        self.assertNotIn('REVIEW_CARD', self.variant_types(media))
        self.assertNotIn('VIDEO_PROXY', self.variant_types(media))

    def test_encoder_error_is_logged_with_stderr(self):
        media = self.upload_clip()

        def run(command, *args, **kwargs):
            if '-c:v' in command and 'libx264' in command:
                raise subprocess.CalledProcessError(1, command, stderr=b'Invalid data found when processing input')
            return subprocess.CompletedProcess(command, 0, b'', b'')

        with patch('app.services.file_processing.subprocess.run', side_effect=run), \
                self.assertLogs('app.services.file_processing', level='ERROR') as logs, \
                self.assertRaises(VideoProxyFailed) as raised:
            file_processing._video_proxy(media.original_file)
        self.assertIn('Invalid data', raised.exception.args[0])
        self.assertTrue(any('Invalid data' in line for line in logs.output))

    def test_real_encode_stores_a_proxy(self):
        media = self.upload_clip()
        generate_preview(file_id=media.original_file_id)
        self.assertIn('VIDEO_PROXY', self.variant_types(media))
        self.assertNotIn('REVIEW_CARD', self.variant_types(media))

    def test_failed_proxy_is_reported_and_can_be_re_rendered(self):
        media = self.upload_clip()
        self.leave_fallback_card(media)
        listed = self.client.get(reverse('api-media-versions', args=[self.workspace.id, self.project.id])).json()
        row = next(item for item in listed if item['id'] == str(media.id))
        self.assertEqual(row['preview_status'], 'FAILED')
        self.assertNotIn('sd', row['preview_qualities'])
        # The preview route no longer hands the player an SVG.
        preview = self.client.get(reverse('api-media-version-preview', args=[self.workspace.id, self.project.id, media.id]))
        self.assertEqual(preview.status_code, 404)

        url = reverse('api-media-version-render-control', args=[self.workspace.id, self.project.id, media.id])
        retried = self.client.post(url, {'action': 'retry'}, format='json')
        self.assertEqual(retried.status_code, 200, retried.content)
        event = OutboxEvent.objects.filter(topic='file.preview.requested', aggregate_id=str(media.original_file_id)).order_by('-created_at').first()
        self.assertEqual(event.status, 'PENDING')

        generate_preview(file_id=media.original_file_id)
        self.assertIn('VIDEO_PROXY', self.variant_types(media))
        self.assertNotIn('REVIEW_CARD', self.variant_types(media))
        self.assertIn('REVIEW_CARD', self.variant_types(media, live=False))  # soft-deleted, not removed

    def test_rerender_command_only_adds_rows_and_soft_deletes_the_card(self):
        media = self.upload_clip()
        self.leave_fallback_card(media)
        events_before = list(OutboxEvent.objects.values_list('id', 'status', 'attempts').order_by('id'))
        variants_before = FileVariant.objects.count()

        out = StringIO()
        call_command('rerender_fallback_video_previews', '--dry-run', stdout=out)
        self.assertIn('would re-render', out.getvalue())
        self.assertIn('REVIEW_CARD', self.variant_types(media))
        self.assertEqual(OutboxEvent.objects.count(), len(events_before))

        out = StringIO()
        call_command('rerender_fallback_video_previews', '--file-id', str(media.original_file_id), stdout=out)
        self.assertIn('queued a proxy render', out.getvalue())
        self.assertNotIn('REVIEW_CARD', self.variant_types(media))
        self.assertEqual(FileVariant.objects.count(), variants_before)  # nothing hard-deleted
        for event_id, status, attempts in events_before:  # existing jobs untouched
            self.assertTrue(OutboxEvent.objects.filter(id=event_id, status=status, attempts=attempts).exists())
        new = OutboxEvent.objects.exclude(id__in=[row[0] for row in events_before]).get()
        self.assertEqual((new.topic, new.status, new.aggregate_id), ('file.preview.requested', 'PENDING', str(media.original_file_id)))

        # A second run finds the job in flight and adds nothing.
        call_command('rerender_fallback_video_previews', stdout=StringIO())
        self.assertEqual(OutboxEvent.objects.count(), len(events_before) + 1)

        process_outbox_events()
        self.assertIn('VIDEO_PROXY', self.variant_types(media))
        listed = self.client.get(reverse('api-media-versions', args=[self.workspace.id, self.project.id])).json()
        self.assertEqual(next(item for item in listed if item['id'] == str(media.id))['preview_status'], 'READY')
