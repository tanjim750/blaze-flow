from django.core.management.base import BaseCommand, CommandError

from app.services.email_verification import purge_expired_auth_tokens


class Command(BaseCommand):
    help = 'Delete a bounded batch of expired password-reset and email-verification tokens.'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=1000)
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **options):
        if options['limit'] < 1:
            raise CommandError('--limit must be at least 1.')
        result = purge_expired_auth_tokens(
            limit=options['limit'], dry_run=options['dry_run']
        )
        action = 'Would delete' if options['dry_run'] else 'Deleted'
        self.stdout.write(
            f"{action} {result['password_reset_tokens']} password-reset token(s) and "
            f"{result['email_verification_tokens']} email-verification token(s)."
        )
