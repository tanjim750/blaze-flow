from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase

from blazeflow.cache_config import cache_settings


class CacheConfigTests(SimpleTestCase):
    def test_default_is_the_shared_database_cache(self):
        default = cache_settings(backend=None)['default']
        self.assertEqual(default['BACKEND'], 'django.core.cache.backends.db.DatabaseCache')
        self.assertEqual(default['LOCATION'], 'django_cache')

    def test_tests_and_locmem_use_locmem(self):
        for kwargs in ({'backend': 'db', 'testing': True}, {'backend': 'locmem'}):
            self.assertTrue(cache_settings(**kwargs)['default']['BACKEND'].endswith('LocMemCache'))

    def test_redis_needs_a_url_and_unknown_backends_fail_loudly(self):
        self.assertEqual(cache_settings(backend='redis', cache_url='redis://r:6379/1')['default']['LOCATION'], 'redis://r:6379/1')
        with self.assertRaises(ImproperlyConfigured):
            cache_settings(backend='redis')
        with self.assertRaises(ImproperlyConfigured):
            cache_settings(backend='memcache')
