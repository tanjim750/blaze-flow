"""Fills the /platform overview with clearly-marked demo data (local/staging only).

Every demo user has an ``@demo.blazeflow.test`` email and every demo workspace is named
"[Demo] …", so the platform admin can badge them and --purge can remove them. Idempotent:
re-running skips what already exists.
"""
import random
import uuid
from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from app.models import (
    AuditActorType, AuditLog, OutboxEvent, OutboxEventStatus, SubscriptionPlan,
    SubscriptionStatus, SupportTicket, SupportTicketCategory, User, UserSubscription,
    Workspace, WorkspaceMembership,
)
from app.platform.metrics import DEMO_EMAIL_SUFFIX
from app.platform.support import create_ticket
from app.services.workspaces import create_workspace

STUDIOS = [
    ('Kestrel Cuts', 'PRO'), ('Lumen Reel', 'PRO'), ('Halftone Studio', 'TRIAL'), ('Oxbow Motion', 'FREE'),
    ('Paper Plane Films', 'PRO'), ('Driftwood Edit', 'FREE'), ('Neon Harbour', 'TRIAL'), ('Quarry Post', 'CHURNED'),
    ('Saltmarsh Media', 'FREE'), ('Brightline Creative', 'PRO'), ('Fieldnote Video', 'FREE'), ('Copperleaf', 'FREE'),
]
TICKETS = [
    (SupportTicketCategory.BUG, 'Upload stops at 99%', 'Our 2 GB export gets to 99% and then just sits there. Tried twice in Chrome.', '/projects'),
    (SupportTicketCategory.BILLING, 'How do I add a second seat?', 'We hired an editor — do they need Pro too or is it per workspace?', '/settings'),
    (SupportTicketCategory.BUG, 'AI QA says "too long" for a 3 min cut', 'The video is 3:10 and the check refuses it.', '/review'),
]


class Command(BaseCommand):
    help = 'Seed clearly-marked demo users/workspaces/subscriptions/tickets for the platform admin.'

    def add_arguments(self, parser):
        parser.add_argument('--purge', action='store_true', help='Delete demo tickets/outbox rows/subscriptions and suspend demo users instead.')

    def handle(self, *args, **options):
        if not settings.DEBUG and not options['purge']:
            raise CommandError('Demo data is for local/staging only (DJANGO_DEBUG=true).')
        if options['purge']:
            return self._purge()
        rng = random.Random(42)
        now = timezone.now()
        created = 0
        with transaction.atomic():
            for i, (studio, kind) in enumerate(STUDIOS):
                slug = 'demo-' + studio.lower().replace(' ', '-')
                email = f'owner.{slug[5:]}{DEMO_EMAIL_SUFFIX}'
                if User.objects.filter(email=email).exists():
                    continue
                joined = now - timedelta(days=rng.randint(1, 58), hours=rng.randint(0, 23))
                user = User.objects.create_user(email=email, password=None, first_name=studio.split()[0], last_name='(demo)')
                User.objects.filter(id=user.id).update(created_at=joined, email_verified_at=joined if i % 4 else None)
                ws, _ = create_workspace(owner=user, name=f'[Demo] {studio}', slug=slug, workspace_timezone='Europe/London')
                Workspace.objects.filter(id=ws.id).update(created_at=joined)
                self._subscription(user, kind, joined, now, rng)
                for d in range(rng.randint(0, 6)):
                    AuditLog.objects.create(
                        id=uuid.uuid4(), workspace=ws, actor_type=AuditActorType.USER, actor_user=user,
                        action='project.created' if d == 0 else 'media_version.created', entity_type='demo', entity_id=str(uuid.uuid4()),
                        metadata={'demo': True}, created_at=now - timedelta(days=rng.randint(0, 20), hours=rng.randint(0, 23)),
                    )
                created += 1
            demo_users = list(User.objects.filter(email__endswith=DEMO_EMAIL_SUFFIX).order_by('email'))
            if not SupportTicket.objects.filter(is_demo=True).exists() and demo_users:
                for n, (category, subject, body, url) in enumerate(TICKETS):
                    user = demo_users[n % len(demo_users)]
                    membership = WorkspaceMembership.objects.filter(user=user).select_related('workspace').first()
                    create_ticket(user=user, workspace=membership.workspace if membership else None, category=category, subject=subject,
                                  body=body, context={'url': f'http://localhost:3000{url}', 'user_agent': 'Demo browser'},
                                  request_id=uuid.uuid4().hex, is_demo=True, at=now - timedelta(hours=3 + n * 20))
            if not OutboxEvent.objects.filter(topic__startswith='demo.').exists():
                for n, (st, err) in enumerate([
                    (OutboxEventStatus.DEAD_LETTER, 'SMTPRecipientsRefused: 550 mailbox unavailable (demo)'),
                    (OutboxEventStatus.DEAD_LETTER, 'TimeoutError: SMTP connect timed out (demo)'),
                    (OutboxEventStatus.FAILED, 'ConnectionResetError: preview worker went away (demo)'),
                ]):
                    at = now - timedelta(hours=n + 1)
                    OutboxEvent.objects.create(
                        id=uuid.uuid4(), topic='demo.email.send' if n < 2 else 'demo.preview.render', aggregate_type='demo',
                        aggregate_id=str(uuid.uuid4()), deduplication_key=f'demo:{uuid.uuid4()}', payload={'demo': True},
                        status=st, attempts=5 if st == OutboxEventStatus.DEAD_LETTER else 2, last_error=err,
                        available_at=now + timedelta(days=3650), created_at=at, updated_at=at,
                    )
        self.stdout.write(self.style.SUCCESS(f'Seeded {created} demo studio(s). Demo emails end in {DEMO_EMAIL_SUFFIX}.'))

    def _subscription(self, user, kind, joined, now, rng):
        UserSubscription.objects.filter(user=user).delete()
        base = dict(id=uuid.uuid4(), user=user, created_at=joined, updated_at=now)
        if kind == 'FREE':
            UserSubscription.objects.create(**base, plan=SubscriptionPlan.FREE, status=SubscriptionStatus.ACTIVE, started_at=joined)
        elif kind == 'TRIAL':
            ends = now + timedelta(days=rng.randint(2, 12))
            UserSubscription.objects.create(**base, plan=SubscriptionPlan.PRO, status=SubscriptionStatus.ACTIVE, started_at=ends - timedelta(days=settings.SUBSCRIPTION_TRIAL_DAYS),
                                            trial_ends_at=ends, current_period_start=ends - timedelta(days=settings.SUBSCRIPTION_TRIAL_DAYS), current_period_end=ends)
        elif kind == 'PRO':
            start = joined + timedelta(days=1)
            trial_end = start + timedelta(days=settings.SUBSCRIPTION_TRIAL_DAYS)
            UserSubscription.objects.create(**base, plan=SubscriptionPlan.PRO, status=SubscriptionStatus.ACTIVE, started_at=start,
                                            trial_ends_at=trial_end if trial_end < now else None,
                                            current_period_start=now - timedelta(days=5), current_period_end=now + timedelta(days=25))
        else:  # CHURNED
            UserSubscription.objects.create(**base, plan=SubscriptionPlan.PRO, status=SubscriptionStatus.CANCELLED, started_at=joined,
                                            cancelled_at=now - timedelta(days=6), current_period_end=now - timedelta(days=6))
            UserSubscription.objects.create(**{**base, 'id': uuid.uuid4()}, plan=SubscriptionPlan.FREE, status=SubscriptionStatus.ACTIVE, started_at=now - timedelta(days=6))

    def _purge(self):
        with transaction.atomic():
            tickets = SupportTicket.objects.filter(is_demo=True).delete()[0]
            events = OutboxEvent.objects.filter(topic__startswith='demo.').delete()[0]
            users = User.objects.filter(email__endswith=DEMO_EMAIL_SUFFIX)
            UserSubscription.objects.filter(user__in=users).delete()
            Workspace.objects.filter(slug__startswith='demo-').update(status='SUSPENDED')
            count = users.update(status='SUSPENDED')
        self.stdout.write(self.style.SUCCESS(f'Removed {tickets} demo ticket rows, {events} demo jobs; suspended {count} demo users.'))
