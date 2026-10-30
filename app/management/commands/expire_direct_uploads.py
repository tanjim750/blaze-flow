from django.core.management.base import BaseCommand

from app.services.direct_uploads import direct_uploads_enabled, expire_stale


class Command(BaseCommand):
    help = 'Abort direct-to-storage uploads past their expiry and release their quota reservations.'

    def handle(self, *args, **options):
        if not direct_uploads_enabled():
            self.stdout.write('Direct uploads are disabled; nothing to do.')
            return
        self.stdout.write(f'Expired {expire_stale()} direct upload(s).')
