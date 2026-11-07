"""Test-only helpers. Database rollback does not reset Django's process cache."""
from django.core.cache import cache


class IsolatedCacheMixin:
    """Keep cache-backed API tests independent without changing real throttle rates.

    DRF's guest-exchange bucket is per IP. APIClient uses 127.0.0.1 across test
    cases, and LocMemCache survives TestCase's database rollback. Clear before
    fixtures run and on cleanup (also after failures), not between requests: a
    single test can still exercise the real rate limit.
    """

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        super().setUp()
