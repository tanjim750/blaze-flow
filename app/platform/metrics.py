"""Platform-wide numbers for the /platform overview. Plain ORM; fine at early-stage volumes."""
from datetime import timedelta

from django.conf import settings
from django.db.models import Count, Q
from django.db.models.functions import TruncDate
from django.utils import timezone

from app.models import (
    AIReview, AIReviewStatus, AuditLog, OutboxEvent, OutboxEventStatus, SubscriptionPlan,
    SubscriptionStatus, SupportTicket, SupportTicketStatus, User, UserSubscription, Workspace,
    WorkspaceStatus,
)

DEMO_EMAIL_SUFFIX = '@demo.blazeflow.test'

# Backends that actually deliver mail, with the label shown on the platform overview.
_SENDING_BACKENDS = {
    'blazeflow.email_backends.resend.EmailBackend': 'Resend API',
    'django.core.mail.backends.smtp.EmailBackend': 'SMTP',
}


def email_status():
    """Short backend name, a human transport label and whether mail really leaves."""
    path = settings.EMAIL_BACKEND
    label = _SENDING_BACKENDS.get(path)
    if label == 'SMTP' and getattr(settings, 'EMAIL_HOST', '') == 'smtp.resend.com':
        label = 'Resend SMTP'
    return {
        'email_backend': path.rsplit('.', 2)[-2],
        'email_transport': label or path.rsplit('.', 2)[-2],
        'email_sending': label is not None,
    }
CURRENT = (SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE)


def media_minutes(usage):
    return ((usage or {}).get('duration_ms_media') or 0) / 60000


def overview(*, days=30, now=None):
    now = now or timezone.now()
    since = now - timedelta(days=days)
    users = User.objects.all()
    current = UserSubscription.objects.filter(status__in=CURRENT)
    pro = current.filter(plan=SubscriptionPlan.PRO)
    trialing = pro.filter(status=SubscriptionStatus.ACTIVE, trial_ends_at__gt=now)
    paying = pro.exclude(id__in=trialing.values('id'))
    users_total = users.count()
    pro_users = pro.values('user').distinct().count()
    churned = UserSubscription.objects.filter(plan=SubscriptionPlan.PRO).filter(
        Q(status=SubscriptionStatus.CANCELLED, cancelled_at__gte=since)
        | Q(status=SubscriptionStatus.EXPIRED, updated_at__gte=since)
    ).count()
    paying_count = paying.count()
    trials_ended = UserSubscription.objects.filter(plan=SubscriptionPlan.PRO, trial_ends_at__gte=since, trial_ends_at__lte=now)
    converted = trials_ended.filter(status__in=CURRENT).count()
    ended = trials_ended.count()
    reviews = list(AIReview.objects.filter(created_at__gte=since).values('status', 'usage'))
    workspaces_total = Workspace.objects.filter(status=WorkspaceStatus.ACTIVE).count()
    active_ws = AuditLog.objects.filter(created_at__gte=since, workspace__isnull=False).values('workspace').distinct().count()
    series = {
        row['day'].isoformat(): row['n']
        for row in users.filter(created_at__gte=since).annotate(day=TruncDate('created_at')).values('day').annotate(n=Count('id'))
        if row['day']
    }
    signups_by_day = [
        {'date': (since + timedelta(days=i + 1)).date().isoformat(), 'count': series.get((since + timedelta(days=i + 1)).date().isoformat(), 0)}
        for i in range(days)
    ]
    dead = OutboxEvent.objects.filter(status=OutboxEventStatus.DEAD_LETTER).count()
    failed = OutboxEvent.objects.filter(status=OutboxEventStatus.FAILED).count()
    ai_failed = AIReview.objects.filter(status=AIReviewStatus.FAILED, created_at__gte=since).count()
    new_tickets = SupportTicket.objects.filter(status=SupportTicketStatus.NEW).count()
    past_due = current.filter(status=SubscriptionStatus.PAST_DUE).count()
    attention = [
        item for item in (
            {'code': 'dead_letters', 'severity': 'critical', 'count': dead, 'label': 'Emails/jobs gave up (dead letter)', 'href': '/platform/jobs?kind=outbox&status=DEAD_LETTER'},
            {'code': 'outbox_failed', 'severity': 'warning', 'count': failed, 'label': 'Jobs failing and retrying', 'href': '/platform/jobs?kind=outbox&status=FAILED'},
            {'code': 'ai_qa_failed', 'severity': 'warning', 'count': ai_failed, 'label': 'AI QA checks failed', 'href': '/platform/jobs?kind=ai_qa'},
            {'code': 'new_tickets', 'severity': 'info', 'count': new_tickets, 'label': 'New support tickets', 'href': '/platform/support?status=NEW'},
            {'code': 'past_due', 'severity': 'warning', 'count': past_due, 'label': 'Subscriptions past due', 'href': '/platform/users'},
        ) if item['count']
    ]
    return {
        'signup_mode': settings.SIGNUP_MODE,
        **email_status(),
        'range_days': days,
        'generated_at': now,
        'currency': settings.PLATFORM_CURRENCY,
        'pro_price_minor': settings.PLATFORM_PRO_PRICE_MINOR,
        'mrr_is_estimate': True,
        'demo_users': users.filter(email__endswith=DEMO_EMAIL_SUFFIX).count(),
        'users': {
            'total': users_total,
            'signups': users.filter(created_at__gte=since).count(),
            'verified': users.filter(email_verified_at__isnull=False).count(),
            'signups_by_day': signups_by_day,
        },
        'workspaces': {'total': workspaces_total, 'active': active_ws},
        'plans': {'free': max(users_total - pro_users, 0), 'pro': pro_users, 'pro_paying': paying_count, 'trialing': trialing.count()},
        'revenue': {
            'mrr_minor': paying_count * settings.PLATFORM_PRO_PRICE_MINOR,
            'new_pro': UserSubscription.objects.filter(plan=SubscriptionPlan.PRO, started_at__gte=since).count(),
            'churned': churned,
            'churn_rate': round(churned / (paying_count + churned), 4) if (paying_count + churned) else 0,
            'cancelling': pro.filter(cancel_at_period_end=True).count(),
            'trials_ended': ended,
            'trials_converted': converted,
            'trial_conversion_rate': round(converted / ended, 4) if ended else None,
        },
        'ai_qa': {
            'runs': len(reviews),
            'failed': sum(1 for r in reviews if r['status'] == AIReviewStatus.FAILED),
            'minutes': round(sum(media_minutes(r['usage']) for r in reviews), 1),
        },
        'attention': attention,
    }
