from django.apps import AppConfig


class BlazeFlowAppConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'app'

    def ready(self):
        from .events import handlers  # noqa: F401
