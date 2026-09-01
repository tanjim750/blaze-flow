from datetime import timedelta

from django.conf import settings
from django.db.models import Count
from django.utils import timezone

from app.models import FileSecurityScan, NotificationDelivery, OutboxEvent, ReviewCommentContent


def workspace_operations_report(*, workspace):
    file_ids = ReviewCommentContent.objects.filter(
        review_comment__media_version__project__workspace=workspace,
        file__isnull=False,
    ).values_list('file_id', flat=True)
    # Notification uses related_name='+', so query through its workspace directly.
    from app.models import Notification
    notification_ids = Notification.objects.filter(workspace=workspace).values_list('id', flat=True)
    scans = FileSecurityScan.objects.filter(file_id__in=file_ids)
    scan_counts = dict(scans.values_list('status').annotate(count=Count('id')))
    delivery_counts = dict(NotificationDelivery.objects.filter(notification_id__in=notification_ids).values_list('status').annotate(count=Count('id')))
    aggregate_ids = [str(value) for value in file_ids] + [str(value) for value in notification_ids]
    outbox = OutboxEvent.objects.filter(aggregate_id__in=aggregate_ids)
    outbox_counts = dict(outbox.values_list('status').annotate(count=Count('id')))
    stale_before = timezone.now() - timedelta(minutes=settings.OPERATIONS_STALE_MINUTES)
    stale_scans = scans.filter(status='PENDING', created_at__lt=stale_before).count()
    alerts = []
    if scan_counts.get('INFECTED', 0):
        alerts.append({'severity': 'critical', 'code': 'infected_files', 'count': scan_counts['INFECTED']})
    if outbox_counts.get('DEAD_LETTER', 0):
        alerts.append({'severity': 'critical', 'code': 'dead_letter_events', 'count': outbox_counts['DEAD_LETTER']})
    if scan_counts.get('FAILED', 0):
        alerts.append({'severity': 'warning', 'code': 'failed_scans', 'count': scan_counts['FAILED']})
    if stale_scans:
        alerts.append({'severity': 'warning', 'code': 'stale_pending_scans', 'count': stale_scans})
    return {
        'workspace_id': str(workspace.id), 'scans': scan_counts,
        'deliveries': delivery_counts, 'outbox': outbox_counts,
        'alerts': alerts, 'status': 'critical' if any(a['severity'] == 'critical' for a in alerts) else ('warning' if alerts else 'healthy'),
        'checked_at': timezone.now(),
    }
