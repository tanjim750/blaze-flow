"""Support tickets: created from "Report a problem", answered from the platform admin.

A staff reply is emailed through the outbox (topic ``support.reply.email``), so a failed
send retries and ends up on the platform Jobs page like any other delivery.
"""
import uuid

from django.conf import settings
from django.core.mail import send_mail
from django.db import IntegrityError, transaction
from django.db.models import Max
from django.utils import timezone

from app.models import (
    OutboxEvent, OutboxEventStatus, SupportMessageKind, SupportTicket, SupportTicketMessage,
    SupportTicketStatus,
)
from app.services.subscriptions import get_effective_subscription

REPLY_TOPIC = 'support.reply.email'
CONTEXT_KEYS = ('url', 'user_agent', 'viewport', 'last_request_id')


def _clean_context(raw):
    raw = raw if isinstance(raw, dict) else {}
    return {key: str(raw[key])[:500] for key in CONTEXT_KEYS if raw.get(key)}


def create_ticket(*, user, workspace, category, subject, body, context=None, request_id=None, is_demo=False, at=None):
    subscription = get_effective_subscription(user=user)
    plan = subscription.plan
    if subscription.trial_ends_at and subscription.trial_ends_at > timezone.now():
        plan = f'{plan} (trial)'
    ctx = {**_clean_context(context), 'plan': plan, 'request_id': request_id}
    if workspace is not None:
        ctx.update({'workspace_name': workspace.name, 'workspace_slug': workspace.slug})
    for attempt in range(3):
        try:
            with transaction.atomic():
                number = (SupportTicket.objects.aggregate(n=Max('number'))['n'] or 0) + 1
                ticket = SupportTicket.objects.create(
                    number=number, user=user, workspace=workspace, category=category,
                    subject=subject.strip()[:200], context=ctx, is_demo=is_demo,
                )
                SupportTicketMessage.objects.create(ticket=ticket, author=user, kind=SupportMessageKind.CUSTOMER, body=body.strip())
                if at is not None:
                    SupportTicket.objects.filter(id=ticket.id).update(created_at=at, updated_at=at)
                    ticket.messages.update(created_at=at)
                return ticket
        except IntegrityError:
            if attempt == 2:
                raise
    return None


@transaction.atomic
def add_staff_message(*, ticket, staff, kind, body):
    message = SupportTicketMessage.objects.create(ticket=ticket, author=staff, kind=kind, body=body.strip())
    updates = {'updated_at': timezone.now()}
    if ticket.assignee_id is None:
        updates['assignee'] = staff
    if kind == SupportMessageKind.REPLY:
        if ticket.status in (SupportTicketStatus.NEW, SupportTicketStatus.OPEN):
            updates['status'] = SupportTicketStatus.WAITING
        now = timezone.now()
        OutboxEvent.objects.create(
            id=uuid.uuid4(), topic=REPLY_TOPIC, aggregate_type='support_ticket_message',
            aggregate_id=str(message.id), deduplication_key=f'{REPLY_TOPIC}:{message.id}',
            payload={'message_id': str(message.id)}, status=OutboxEventStatus.PENDING,
            available_at=now, created_at=now, updated_at=now,
        )
    elif ticket.status == SupportTicketStatus.NEW:
        updates['status'] = SupportTicketStatus.OPEN
    SupportTicket.objects.filter(id=ticket.id).update(**updates)
    return message


def deliver_reply_email(*, message_id):
    message = SupportTicketMessage.objects.select_related('ticket', 'ticket__user').get(id=message_id)
    if message.email_sent_at is not None:
        return message
    ticket = message.ticket
    body = (
        f'{message.body}\n\n'
        f'— Krewsys support\n'
        f'Ticket #{ticket.number}: {ticket.subject}\n'
        f'Reply to this email or use Help → Report a problem in the app.'
    )
    send_mail(
        f'Re: [Krewsys #{ticket.number}] {ticket.subject}', body,
        settings.SUPPORT_FROM_EMAIL or settings.DEFAULT_FROM_EMAIL, [ticket.user.email],
        fail_silently=False,
    )  # raises → the outbox retries, then dead-letters
    SupportTicketMessage.objects.filter(id=message.id).update(email_sent_at=timezone.now())
    return message
