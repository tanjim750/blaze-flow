from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.core.validators import validate_email
from django.core.exceptions import ValidationError
from django.utils import timezone

from app.services.mailer import send_templated_email


class Command(BaseCommand):
    help = 'Send a branded test email to <to> using the configured email backend.'

    def add_arguments(self, parser):
        parser.add_argument('to')

    def handle(self, *args, **options):
        to = options['to'].strip()
        try:
            validate_email(to)
        except ValidationError as exc:
            raise CommandError(f'{to!r} is not a valid email address.') from exc
        backend = settings.EMAIL_BACKEND
        try:
            sent = send_templated_email(
                template='test', to=to,
                context={'sent_at': timezone.now(), 'backend': backend.rsplit('.', 2)[-2]},
            )
        except Exception as exc:  # noqa: BLE001
            raise CommandError(f'Sending failed via {backend}: {exc}') from exc
        if sent != 1:
            raise CommandError('The email backend did not accept the message.')
        self.stdout.write(self.style.SUCCESS(
            f'Sent test email to {to} from {settings.DEFAULT_FROM_EMAIL} via {backend}.'
        ))
        if backend.endswith('console.EmailBackend'):
            self.stdout.write(self.style.WARNING(
                'Console backend: nothing left this machine. Set RESEND_API_KEY to send for real.'
            ))
