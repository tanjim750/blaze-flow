from unittest import mock

from django.db import InterfaceError, OperationalError
from django.test import RequestFactory, SimpleTestCase

from app.middleware import DatabaseUnavailableMiddleware


class DatabaseUnavailableMiddlewareTests(SimpleTestCase):
    def setUp(self):
        self.mw = DatabaseUnavailableMiddleware(lambda request: None)
        self.request = RequestFactory().get('/api/auth/me/')

    def test_operational_error_becomes_json_503(self):
        with mock.patch('django.db.connections.all', return_value=[]):
            response = self.mw.process_exception(self.request, OperationalError('could not translate host name "db"'))
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response['Retry-After'], '2')
        self.assertIn(b'service_unavailable', response.content)

    def test_interface_error_closes_connections(self):
        conn = mock.Mock()
        with mock.patch('django.db.connections.all', return_value=[conn]):
            response = self.mw.process_exception(self.request, InterfaceError('connection already closed'))
        self.assertEqual(response.status_code, 503)
        conn.close.assert_called_once()

    def test_other_errors_are_left_alone(self):
        self.assertIsNone(self.mw.process_exception(self.request, ValueError('bug')))

    def test_installed_last(self):
        from django.conf import settings
        self.assertEqual(settings.MIDDLEWARE[-1], 'app.middleware.DatabaseUnavailableMiddleware')
