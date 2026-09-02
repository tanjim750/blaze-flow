from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from app.events import DomainEvent, dispatch
from app.models import OutboxEvent, OutboxEventStatus


def process_outbox_events(
    *, limit=100, event_dispatcher=dispatch, reclaim_after_seconds=300,
    max_attempts=None, retry_base_seconds=None, retry_max_seconds=None
):
    max_attempts = max_attempts or settings.OUTBOX_MAX_ATTEMPTS
    retry_base_seconds = settings.OUTBOX_RETRY_BASE_SECONDS if retry_base_seconds is None else retry_base_seconds
    retry_max_seconds = settings.OUTBOX_RETRY_MAX_SECONDS if retry_max_seconds is None else retry_max_seconds
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
    dead_lettered = 0
    for event in events:
        try:
            event_dispatcher(DomainEvent(name=event.topic, payload=event.payload))
        except Exception as exc:
            is_dead_letter = event.attempts >= max_attempts
            failed += 0 if is_dead_letter else 1
            dead_lettered += 1 if is_dead_letter else 0
            retry_delay = min(
                retry_max_seconds,
                retry_base_seconds * (2 ** max(event.attempts - 1, 0)),
            )
            failed_at = timezone.now()
            OutboxEvent.objects.filter(
                id=event.id,
                status=OutboxEventStatus.PROCESSING,
            ).update(
                status=OutboxEventStatus.DEAD_LETTER if is_dead_letter else OutboxEventStatus.FAILED,
                locked_at=None,
                last_error=str(exc)[:4000],
                available_at=failed_at + timedelta(seconds=retry_delay),
                updated_at=failed_at,
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
    return {
        'claimed': len(events),
        'published': published,
        'failed': failed,
        'dead_lettered': dead_lettered,
    }


@transaction.atomic
def requeue_dead_letter_events(*, limit=100, event_id=None):
    events = OutboxEvent.objects.select_for_update().filter(
        status=OutboxEventStatus.DEAD_LETTER
    ).order_by('created_at')
    if event_id is not None:
        events = events.filter(id=event_id)
    event_ids = list(events.values_list('id', flat=True)[:limit])
    if not event_ids:
        return 0
    now = timezone.now()
    return OutboxEvent.objects.filter(id__in=event_ids).update(
        status=OutboxEventStatus.PENDING,
        attempts=0,
        available_at=now,
        locked_at=None,
        published_at=None,
        last_error=None,
        updated_at=now,
    )
