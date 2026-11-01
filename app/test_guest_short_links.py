import re
import shutil
import tempfile
from datetime import timedelta
from importlib import import_module

from django.apps import apps as global_apps
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .models import GuestInvite
from .services.guest_access import SHORT_CODE_LENGTH, generate_short_code, is_short_code
from .services.guest_access import GuestAccessError
from .test_access_projects import WorkspaceAccessSetupMixin

CODE = re.compile(r'^[A-Za-z0-9]{8}$')


class ShortCodeUnitTests(TestCase):
    def test_codes_are_8_char_base62_and_random(self):
        codes = {generate_short_code() for _ in range(200)}
        self.assertEqual(len(codes), 200)
        self.assertTrue(all(CODE.match(code) for code in codes))
        self.assertEqual(SHORT_CODE_LENGTH, 8)

    def test_collision_is_retried_and_eventually_gives_up(self):
        seen = []
        code = generate_short_code(exists=lambda c: (seen.append(c), len(seen) < 3)[1])
        self.assertEqual(len(seen), 3)
        self.assertEqual(code, seen[-1])
        with self.assertRaises(GuestAccessError):
            generate_short_code(exists=lambda c: True)

    def test_is_short_code_rejects_long_tokens(self):
        self.assertTrue(is_short_code('Z70ayQFE'))
        self.assertFalse(is_short_code('Z70ayQF-'))
        self.assertFalse(is_short_code('x' * 43))


class ShortLinkApiTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='bf-shortlinks-')
        self.override = override_settings(MEDIA_ROOT=self.media_root)
        self.override.enable()
        super().setUp()
        self.client.force_authenticate(self.owner)
        self.project_id = self.client.post(reverse('api-projects', args=[self.workspace.id]), {'name': 'Short'}, format='json').json()['id']
        self.list_url = reverse('api-project-guest-invites', args=[self.workspace.id, self.project_id])

    def tearDown(self):
        self.override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)
        super().tearDown()

    def create(self, **extra):
        response = self.client.post(self.list_url, {'permissions': ['media.read'], 'expires_in_hours': 24, **extra}, format='json')
        self.assertEqual(response.status_code, 201)
        return response.json()

    def exchange(self, credential):
        self.client.force_authenticate(user=None)
        return self.client.post(reverse('api-guest-exchange'), {'token': credential, 'name': 'G', 'email': 'g@example.com'}, format='json')

    def test_new_invite_has_short_code_and_url(self):
        data = self.create()
        self.assertRegex(data['short_code'], CODE)
        self.assertEqual(data['short_url'], f"https://krewsys.com/r/{data['short_code']}")
        listed = self.client.get(self.list_url).json()[0]
        self.assertEqual(listed['short_url'], data['short_url'])
        self.assertNotIn('token', listed)

    @override_settings(SHORT_LINK_BASE_URL='https://xyz.io')
    def test_short_link_base_is_configurable(self):
        data = self.create()
        self.assertEqual(data['short_url'], f"https://xyz.io/{data['short_code']}")

    def test_short_code_and_long_token_both_redeem(self):
        data = self.create()
        self.assertEqual(self.exchange(data['short_code']).status_code, 201)
        self.assertEqual(self.exchange(data['token']).status_code, 201)

    def test_unknown_revoked_and_expired_codes_fail_alike(self):
        data = self.create()
        self.assertEqual(self.exchange('AAAAAAAA').status_code, 400)
        self.client.force_authenticate(self.owner)
        self.client.delete(reverse('api-project-guest-invite-detail', args=[self.workspace.id, self.project_id, data['id']]))
        self.assertEqual(self.exchange(data['short_code']).status_code, 400)
        self.client.force_authenticate(self.owner)
        other = self.create()
        GuestInvite.objects.filter(id=other['id']).update(expires_at=timezone.now() - timedelta(minutes=1))
        response = self.exchange(other['short_code'])
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['detail'], 'This guest invitation is invalid or expired.')

    def test_file_share_remembers_its_cut_for_the_short_link(self):
        upload = self.client.post(
            reverse('api-media-versions', args=[self.workspace.id, self.project_id]),
            {'file': SimpleUploadedFile('f.png', b'\x89PNG\r\n\x1a\nx', content_type='image/png'), 'title': 'F'},
            format='multipart',
        ).json()
        data = self.create()
        GuestInvite.objects.filter(id=data['id']).update(shared_media_version_id=upload['id'])
        response = self.exchange(data['short_code'])
        self.assertEqual(response.json()['media_version_id'], upload['id'])

    def test_migration_backfill_only_adds_missing_codes_and_old_tokens_still_work(self):
        module = import_module('app.migrations.0063_guest_invite_short_code')
        old, kept = self.create(), self.create()
        GuestInvite.objects.filter(id=old['id']).update(short_code=None)
        module.backfill_short_codes(global_apps, None)
        filled = GuestInvite.objects.get(id=old['id']).short_code
        self.assertRegex(filled, CODE)
        self.assertEqual(GuestInvite.objects.get(id=kept['id']).short_code, kept['short_code'])
        self.assertEqual(self.exchange(old['token']).status_code, 201)
        self.assertEqual(self.exchange(filled).status_code, 201)

    def test_permissions_are_kept(self):
        data = self.create()
        key = self.exchange(data['short_code']).json()['access_key']
        review = self.client.get(reverse('api-guest-review', args=[self.project_id]), HTTP_X_GUEST_ACCESS_KEY=key)
        self.assertEqual(review.status_code, 200)
        self.assertFalse(review.json()['viewer']['can_comment'])

    def upload(self, name):
        self.client.force_authenticate(self.owner)
        return self.client.post(
            reverse('api-media-versions', args=[self.workspace.id, self.project_id]),
            {'file': SimpleUploadedFile(name, b'\x89PNG\r\n\x1a\nx', content_type='image/png'), 'title': name},
            format='multipart',
        ).json()['id']

    def guest(self, permissions, shared=None):
        self.client.force_authenticate(self.owner)
        data = self.create(permissions=permissions)
        if shared:
            GuestInvite.objects.filter(id=data['id']).update(shared_media_version_id=shared)
        key = self.exchange(data['short_code']).json()['access_key']
        return {'HTTP_X_GUEST_ACCESS_KEY': key}

    def test_file_scoped_link_sees_only_its_file(self):
        shared, other = self.upload('a.png'), self.upload('b.png')
        headers = self.guest(['media.read', 'review.comment.read', 'annotation.read'], shared=shared)
        review = self.client.get(reverse('api-guest-review', args=[self.project_id]), **headers).json()
        self.assertEqual([item['id'] for item in review['media_versions']], [shared])
        self.assertTrue(review['viewer']['scoped_to_file'])
        for name in ('api-guest-comments', 'api-guest-annotations', 'api-guest-playback'):
            blocked = self.client.get(reverse(name, args=[self.project_id, other]), **headers)
            self.assertEqual(blocked.status_code, 404, name)
        self.assertEqual(self.client.get(reverse('api-guest-comments', args=[self.project_id, shared]), **headers).status_code, 200)

    def test_project_link_still_sees_the_whole_project(self):
        first, second = self.upload('a.png'), self.upload('b.png')
        headers = self.guest(['media.read', 'review.comment.read'])
        review = self.client.get(reverse('api-guest-review', args=[self.project_id]), **headers).json()
        self.assertEqual({item['id'] for item in review['media_versions']}, {first, second})
        self.assertFalse(review['viewer']['scoped_to_file'])
        self.assertEqual(self.client.get(reverse('api-guest-comments', args=[self.project_id, second]), **headers).status_code, 200)

    def test_viewer_says_what_the_link_may_read(self):
        self.upload('a.png')
        headers = self.guest(['media.read'])
        viewer = self.client.get(reverse('api-guest-review', args=[self.project_id]), **headers).json()['viewer']
        self.assertFalse(viewer['can_read_comments'])
        self.assertFalse(viewer['can_read_annotations'])
        headers = self.guest(['media.read', 'review.comment.read', 'annotation.read'])
        viewer = self.client.get(reverse('api-guest-review', args=[self.project_id]), **headers).json()['viewer']
        self.assertTrue(viewer['can_read_comments'] and viewer['can_read_annotations'])


class ExchangeThrottleTests(TestCase):
    def setUp(self):
        cache.clear()

    def tearDown(self):
        cache.clear()

    def test_exchange_is_rate_limited(self):
        from rest_framework.settings import api_settings
        rates = {**api_settings.DEFAULT_THROTTLE_RATES, 'guest_exchange': '3/hour'}
        from app.throttles import GuestExchangeThrottle
        original = GuestExchangeThrottle.THROTTLE_RATES
        GuestExchangeThrottle.THROTTLE_RATES = rates
        try:
            codes = [self.client.post(reverse('api-guest-exchange'), {'token': 'AAAAAAAA', 'name': 'G', 'email': 'g@example.com'}, content_type='application/json').status_code for _ in range(4)]
        finally:
            GuestExchangeThrottle.THROTTLE_RATES = original
        self.assertEqual(codes, [400, 400, 400, 429])


