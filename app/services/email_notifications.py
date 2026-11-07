import uuid

from django.conf import settings
from django.utils import timezone

from app.models import (
    Notification,
    NotificationDelivery,
    NotificationDeliveryChannel,
    NotificationDeliveryStatus,
    NotificationKind,
    NotificationPreference,
)


def get_notification_preference(*, user):
    now = timezone.now()
    preference, _ = NotificationPreference.objects.get_or_create(
        user=user,
        defaults={'id': uuid.uuid4(), 'created_at': now, 'updated_at': now},
    )
    return preference


def update_notification_preference(*, user, email_mentions_enabled):
    preference = get_notification_preference(user=user)
    preference.email_mentions_enabled = email_mentions_enabled
    preference.updated_at = timezone.now()
    preference.save(update_fields=['email_mentions_enabled', 'updated_at'])
    return preference


def _mention_email(notification):
    actor_name = notification.actor_user.get_full_name() if notification.actor_user else 'A collaborator'
    actor_name = ' '.join(actor_name.splitlines()).strip() or 'A collaborator'
    payload = notification.payload
    link = (
        f"{settings.APP_BASE_URL}/workspaces/{notification.workspace_id}"
        f"/projects/{payload['project_id']}/media/{payload['media_version_id']}"
        f"?comment={payload['review_comment_id']}"
    )
    return {'actor_name': actor_name, 'excerpt': payload.get('excerpt', ''), 'action_url': link}


def deliver_notification_email(*, notification_id):
    notification = Notification.objects.select_related(
        'recipient_user', 'actor_user', 'workspace'
    ).get(id=notification_id)
    now = timezone.now()
    delivery, _ = NotificationDelivery.objects.get_or_create(
        notification=notification,
        channel=NotificationDeliveryChannel.EMAIL,
        defaults={'id': uuid.uuid4(), 'created_at': now, 'updated_at': now},
    )
    if delivery.status in (NotificationDeliveryStatus.SENT, NotificationDeliveryStatus.SKIPPED):
        return delivery

    preference = NotificationPreference.objects.filter(user=notification.recipient_user).first()
    email_enabled = preference is None or preference.email_mentions_enabled
    if not email_enabled or notification.kind != NotificationKind.REVIEW_COMMENT_MENTION:
        delivery.status = NotificationDeliveryStatus.SKIPPED
        delivery.last_error = None
        delivery.updated_at = timezone.now()
        delivery.save(update_fields=['status', 'last_error', 'updated_at'])
        return delivery

    try:
        from app.services.mailer import send_templated_email

        sent_count = send_templated_email(
            template='mention',
            to=notification.recipient_user.email,
            context=_mention_email(notification),
        )
        if sent_count != 1:
            raise RuntimeError('The email backend did not confirm delivery acceptance.')
    except Exception as exc:
        delivery.status = NotificationDeliveryStatus.FAILED
        delivery.attempts += 1
        delivery.last_error = str(exc)[:4000]
        delivery.updated_at = timezone.now()
        delivery.save(update_fields=['status', 'attempts', 'last_error', 'updated_at'])
        raise

    delivery.status = NotificationDeliveryStatus.SENT
    delivery.attempts += 1
    delivery.last_error = None
    delivery.sent_at = timezone.now()
    delivery.updated_at = delivery.sent_at
    delivery.save(update_fields=['status', 'attempts', 'last_error', 'sent_at', 'updated_at'])
    return delivery
