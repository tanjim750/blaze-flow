"""Which Django cache to use. Kept apart from settings.py so it can be unit tested."""
from django.core.exceptions import ImproperlyConfigured


def cache_settings(*, backend, cache_url=None, max_entries=20000, testing=False):
    backend = (backend or 'db').strip().lower()
    if testing or backend == 'locmem':
        return {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache', 'LOCATION': 'blazeflow'}}
    if backend == 'redis':
        if not cache_url:
            raise ImproperlyConfigured('CACHE_BACKEND=redis needs CACHE_URL (e.g. redis://redis:6379/1).')
        return {'default': {'BACKEND': 'django.core.cache.backends.redis.RedisCache', 'LOCATION': cache_url}}
    if backend == 'db':
        return {'default': {
            'BACKEND': 'django.core.cache.backends.db.DatabaseCache', 'LOCATION': 'django_cache',
            'OPTIONS': {'MAX_ENTRIES': int(max_entries), 'CULL_FREQUENCY': 4},
        }}
    raise ImproperlyConfigured(f'Unknown CACHE_BACKEND {backend!r}; use db, redis or locmem.')
