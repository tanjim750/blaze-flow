from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.urls import get_resolver, reverse
from rest_framework.permissions import IsAuthenticated, IsAuthenticatedOrReadOnly
from rest_framework.settings import api_settings

from app.throttles import LoginEmailThrottle, LoginThrottle, PasswordResetEmailThrottle, PasswordResetThrottle


def _drf_routes(patterns, prefix=''):
    for p in patterns:
        if hasattr(p, 'url_patterns'):
            yield from _drf_routes(p.url_patterns, prefix + str(p.pattern))
            continue
        cls = getattr(p.callback, 'cls', None)
        if cls is not None:
            yield prefix + str(p.pattern), cls


class DefaultPermissionTests(TestCase):
    def test_default_is_authenticated(self):
        self.assertEqual(list(api_settings.DEFAULT_PERMISSION_CLASSES), [IsAuthenticated])

    def test_no_view_is_read_only_for_anonymous(self):
        offenders = [path for path, cls in _drf_routes(get_resolver().url_patterns)
                     if IsAuthenticatedOrReadOnly in list(cls.permission_classes)]
        self.assertEqual(offenders, [])

    def test_health_is_public(self):
        self.assertEqual(self.client.get(reverse('api-health')).status_code, 200)

    def test_private_endpoint_needs_login(self):
        self.assertIn(self.client.get(reverse('api-current-user')).status_code, (401, 403))

    def test_json_only_without_debug(self):
        names = [r.__name__ for r in api_settings.DEFAULT_RENDERER_CLASSES]
        self.assertEqual(names, ['JSONRenderer'])
        response = self.client.get(reverse('api-health'), HTTP_ACCEPT='text/html')
        self.assertEqual(response['Content-Type'], 'application/json')


class PerEmailThrottleTests(TestCase):
    """Per-account limits apply across IPs and look the same for unknown accounts."""

    def setUp(self):
        cache.clear()
        get_user_model().objects.create_user(email='known@example.com', first_name='Kn', last_name='Own', password='Correct-horse-1')
        rates = {**api_settings.DEFAULT_THROTTLE_RATES, 'login': '1000/hour', 'password_reset': '1000/hour',
                 'login_email': '3/hour', 'password_reset_email': '2/hour'}
        self.patches = [mock.patch.object(cls, 'THROTTLE_RATES', rates)
                        for cls in (LoginThrottle, LoginEmailThrottle, PasswordResetThrottle, PasswordResetEmailThrottle)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        cache.clear()

    def _login(self, email, ip):
        return self.client.post(reverse('api-login'), {'email': email, 'password': 'wrong'},
                                content_type='application/json', REMOTE_ADDR=ip).status_code

    def test_login_limited_per_email_across_ips(self):
        codes = [self._login('known@example.com', f'10.0.0.{i}') for i in range(1, 5)]
        self.assertEqual(codes[-1], 429)
        self.assertNotIn(429, codes[:3])
        # Case and whitespace don't make a fresh bucket.
        self.assertEqual(self._login('  KNOWN@example.com ', '10.0.0.9'), 429)
        # Another account is unaffected.
        self.assertNotEqual(self._login('other@example.com', '10.0.0.1'), 429)

    def test_unknown_email_behaves_identically(self):
        known = [self._login('known@example.com', f'10.1.0.{i}') for i in range(1, 5)]
        unknown = [self._login('ghost@example.com', f'10.2.0.{i}') for i in range(1, 5)]
        self.assertEqual(known, unknown)

    def test_password_reset_limited_per_email(self):
        url = reverse('api-password-reset-request')
        known = [self.client.post(url, {'email': 'known@example.com'}, content_type='application/json',
                                  REMOTE_ADDR=f'10.3.0.{i}').status_code for i in range(1, 4)]
        unknown = [self.client.post(url, {'email': 'ghost@example.com'}, content_type='application/json',
                                    REMOTE_ADDR=f'10.4.0.{i}').status_code for i in range(1, 4)]
        self.assertEqual(known, [202, 202, 429])
        self.assertEqual(unknown, known)


class HealthCheckTests(TestCase):
    def test_get_ok(self):
        response = self.client.get(reverse('api-health'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'message': 'ok'})

    def test_head_ok_without_body(self):
        response = self.client.head(reverse('api-health'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b'')

    def test_post_is_405_without_body(self):
        response = self.client.post(reverse('api-health'))
        self.assertEqual(response.status_code, 405)
        self.assertEqual(response.content, b'')

    def test_db_in_recovery_is_503(self):
        from unittest import mock
        from django.db import connection
        if connection.vendor != 'postgresql':
            self.skipTest('postgres only')
        real = connection.cursor

        class Cur:
            def __init__(self, c): self.c = c; self.last = None
            def __enter__(self): self.c.__enter__(); return self
            def __exit__(self, *a): return self.c.__exit__(*a)
            def execute(self, sql, *a): self.last = sql; return self.c.execute(sql, *a)
            def fetchone(self):
                return (True,) if 'recovery' in (self.last or '') else self.c.fetchone()

        with mock.patch.object(connection, 'cursor', lambda: Cur(real())):
            response = self.client.get(reverse('api-health'))
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()['database'], 'recovery')
