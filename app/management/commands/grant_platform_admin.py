from django.contrib.auth.models import Permission
from django.core.management.base import BaseCommand, CommandError

from app.models import User


class Command(BaseCommand):
    help = 'Give (or with --revoke, take away) access to the /platform admin for one user.'

    def add_arguments(self, parser):
        parser.add_argument('email')
        parser.add_argument('--revoke', action='store_true')

    def handle(self, *args, **options):
        user = User.objects.filter(email__iexact=options['email']).first()
        if user is None:
            raise CommandError('No user with that email.')
        perm = Permission.objects.get(content_type__app_label='app', codename='access_platform_admin')
        if options['revoke']:
            user.user_permissions.remove(perm)
            self.stdout.write(self.style.SUCCESS(f'Removed platform admin access from {user.email}.'))
        else:
            user.user_permissions.add(perm)
            self.stdout.write(self.style.SUCCESS(f'{user.email} can now open /platform.'))
