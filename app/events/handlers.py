from .dispatcher import subscribe


def handle_health_checked(event):
    return None


def handle_notification_created(event):
    from app.services.email_notifications import deliver_notification_email

    return deliver_notification_email(notification_id=event.payload['notification_id'])


def handle_file_security_scan(event):
    from app.services.file_processing import handle_security_scan_event
    return handle_security_scan_event(event)


def handle_file_preview(event):
    from app.services.file_processing import handle_preview_event
    return handle_preview_event(event)


def handle_ai_visual_qa_run(event):
    from app.ai_qa.pipeline import handle_run_event
    return handle_run_event(event)


subscribe('health.checked', handle_health_checked)
subscribe('notification.created', handle_notification_created)
subscribe('file.security-scan.requested', handle_file_security_scan)
subscribe('file.preview.requested', handle_file_preview)
subscribe('ai_visual_qa.run', handle_ai_visual_qa_run)
