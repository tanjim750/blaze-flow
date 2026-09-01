from datetime import timedelta

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from app.events import DomainEvent, dispatch
from app.models import OutboxEvent, OutboxEventStatus


def process_outbox_events(
    *, limit=100, event_dispatcher=dispatch, reclaim_after_seconds=300
):
    now = timezone.now()
    stale_before = now - timedelta(seconds=reclaim_after_seconds)
    with transaction.atomic():
        events = list(
            OutboxEvent.objects.select_for_update(skip_locked=True).filter(
                Q(
                    status__in=[OutboxEventStatus.PENDING, OutboxEventStatus.FAILED],
                    available_at__lte=now,
                )
                | Q(
                    status=OutboxEventStatus.PROCESSING,
                    locked_at__lte=stale_before,
                )
            ).order_by('created_at')[:limit]
        )
        for event in events:
            event.status = OutboxEventStatus.PROCESSING
            event.attempts += 1
            event.locked_at = now
            event.updated_at = now
            event.save(update_fields=['status', 'attempts', 'locked_at', 'updated_at'])

    published = 0
    failed = 0
    for event in events:
        try:
            event_dispatcher(DomainEvent(name=event.topic, payload=event.payload))
        except Exception as exc:
            failed += 1
            OutboxEvent.objects.filter(
                id=event.id,
                status=OutboxEventStatus.PROCESSING,
            ).update(
                status=OutboxEventStatus.FAILED,
                locked_at=None,
                last_error=str(exc)[:4000],
                updated_at=timezone.now(),
            )
        else:
            published += 1
            completed_at = timezone.now()
            OutboxEvent.objects.filter(
                id=event.id,
                status=OutboxEventStatus.PROCESSING,
            ).update(
                status=OutboxEventStatus.PUBLISHED,
                locked_at=None,
                published_at=completed_at,
                last_error=None,
                updated_at=completed_at,
            )
    return {'claimed': len(events), 'published': published, 'failed': failed}
