from django.conf import settings
from django.core.checks import Error, register
from django.utils.module_loading import import_string


@register()
def file_processing_configuration(app_configs, **kwargs):
    errors = []
    try:
        scanner_class = import_string(settings.FILE_SECURITY_SCANNER)
        scanner = scanner_class()
    except Exception as exc:
        errors.append(Error(
            f'FILE_SECURITY_SCANNER cannot be loaded: {exc}',
            id='blazeflow.E001',
        ))
    else:
        if not getattr(scanner, 'name', None) or not callable(getattr(scanner, 'scan', None)):
            errors.append(Error(
                'FILE_SECURITY_SCANNER must provide a name and scan(stream) method.',
                id='blazeflow.E002',
            ))
    return errors


@register()
def shared_cache_configuration(app_configs, **kwargs):
    """Throttles need a cache every worker shares; LocMem outside DEBUG/tests is a mistake."""
    from django.conf import settings
    from django.core.checks import Warning as CheckWarning

    backend = settings.CACHES.get('default', {}).get('BACKEND', '')
    if not settings.DEBUG and backend.endswith('LocMemCache') and getattr(settings, 'CACHE_BACKEND', '') == 'locmem':
        return [CheckWarning(
            'CACHE_BACKEND=locmem: rate limits are per gunicorn worker and reset on restart.',
            hint='Use CACHE_BACKEND=db (default) or redis in production.', id='blazeflow.W010',
        )]
    return []
