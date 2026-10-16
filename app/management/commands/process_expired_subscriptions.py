from django.core.management.base import BaseCommand

from app.services import process_expired_subscriptions


class Command(BaseCommand):
    help = (
        'Downgrade PRO subscriptions to FREE once a scheduled cancellation period has ended. '
        'There is no payment-provider webhook driving this in the MVP, so it must be scheduled explicitly.'
    )

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **options):
        affected = process_expired_subscriptions(dry_run=options['dry_run'])
        verb = 'Would downgrade' if options['dry_run'] else 'Downgraded'
        self.stdout.write(self.style.SUCCESS(f'{verb} {len(affected)} expired subscription(s).'))
