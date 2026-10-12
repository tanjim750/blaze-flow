from django.test import RequestFactory, TestCase, override_settings
from django.urls import reverse

from app.models import OutboxEvent
from app.throttles import LoginThrottle


class HealthEndpointTests(TestCase):
    def test_live_is_side_effect_free(self):
        before = OutboxEvent.objects.count()
        for _ in range(3):
            response = self.client.get(reverse('api-health-live'))
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {'status': 'ok'})
        self.assertEqual(OutboxEvent.objects.count(), before)

    def test_legacy_health_writes_nothing(self):
        before = OutboxEvent.objects.count()
        self.client.get(reverse('api-health'))
        self.assertEqual(OutboxEvent.objects.count(), before)

    def test_ready_checks_database(self):
        response = self.client.get(reverse('api-health-ready'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['database'], 'ok')

    def test_live_rejects_post(self):
        self.assertEqual(self.client.post(reverse('api-health-live')).status_code, 405)


class CloudflareThrottleIdentTests(TestCase):
    def _request(self):
        return RequestFactory().get(
            '/', REMOTE_ADDR='10.0.0.5', HTTP_CF_CONNECTING_IP='203.0.113.9',
        )

    @override_settings(THROTTLE_TRUST_CF_CONNECTING_IP=False)
    def test_header_ignored_by_default(self):
        self.assertEqual(LoginThrottle().get_ident(self._request()), '10.0.0.5')

    @override_settings(THROTTLE_TRUST_CF_CONNECTING_IP=True)
    def test_header_used_when_trusted(self):
        self.assertEqual(LoginThrottle().get_ident(self._request()), '203.0.113.9')

    @override_settings(THROTTLE_TRUST_CF_CONNECTING_IP=True)
    def test_invalid_header_falls_back(self):
        request = RequestFactory().get('/', REMOTE_ADDR='10.0.0.5', HTTP_CF_CONNECTING_IP='not-an-ip')
        self.assertEqual(LoginThrottle().get_ident(request), '10.0.0.5')
