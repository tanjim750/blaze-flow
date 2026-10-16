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
