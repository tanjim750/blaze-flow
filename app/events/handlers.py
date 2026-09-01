from .dispatcher import subscribe


def handle_health_checked(event):
    return None


def handle_notification_created(event):
    from app.services.email_notifications import deliver_notification_email

    return deliver_notification_email(notification_id=event.payload['notification_id'])


subscribe('health.checked', handle_health_checked)
subscribe('notification.created', handle_notification_created)
