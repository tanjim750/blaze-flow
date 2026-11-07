import time
import unittest

from django.core.cache import cache
from django.test import SimpleTestCase

from .testing import IsolatedCacheMixin
from .throttles import GuestExchangeThrottle


class CacheIsolationTests(SimpleTestCase):
    def test_guest_exchange_history_is_isolated_before_and_after_each_case(self):
        key = GuestExchangeThrottle.cache_format % {
            'scope': GuestExchangeThrottle.scope, 'ident': '127.0.0.1',
        }

        class Probe(IsolatedCacheMixin, SimpleTestCase):
            def runTest(self):
                self.assertIsNone(cache.get(key))
                # Simulate a case exhausting the production bucket. Cleanup must
                # remove this history, even though the database is not involved.
                cache.set(key, [time.time()] * 60, timeout=3600)

        try:
            for _ in range(2):
                cache.set(key, [time.time()] * 60, timeout=3600)
                result = unittest.TestResult()
                Probe().run(result)
                self.assertTrue(result.wasSuccessful(), (result.errors, result.failures))
                self.assertEqual(result.testsRun, 1)
                self.assertIsNone(cache.get(key))
        finally:
            cache.clear()
