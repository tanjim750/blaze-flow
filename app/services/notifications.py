import uuid

from django.db import transaction
from django.utils import timezone

from app.models import (
    Notification,
    ClientTeamMember,
    ClientTeamMemberStatus,
    NotificationKind,
    OutboxEvent,
    ReviewCommentMention,
    User,
    UserStatus,
)
from app.permissions import REVIEW_COMMENT_READ, has_project_permission


class NotificationError(Exception):
    pass


@transaction.atomic
def notify_client_task_ready(*, task, actor):
    """Create one in-app handoff notification per active client contact and task."""
    if not task.client_team_id:
        return 0
    now = timezone.now()
    recipients = User.objects.filter(
        id__in=ClientTeamMember.objects.filter(
            client_team_id=task.client_team_id,
            status=ClientTeamMemberStatus.ACTIVE,
        ).values('user_id'),
        status=UserStatus.ACTIVE,
    ).exclude(id=actor.id)
    created_count = 0
    for recipient in recipients:
        notification, created = Notification.objects.get_or_create(
            recipient_user=recipient,
            kind=NotificationKind.TASK_CLIENT_READY,
            entity_type='task',
            entity_id=str(task.id),
            defaults={
                'id': uuid.uuid4(),
                'workspace_id': task.workspace_id,
                'actor_user': actor,
                'payload': {
                    'task_id': str(task.id),
                    'project_id': str(task.project_id) if task.project_id else None,
                    'title': task.title,
                },
                'created_at': now,
            },
        )
        if not created:
            continue
        OutboxEvent.objects.create(
            id=uuid.uuid4(), topic='notification.created', aggregate_type='notification',
            aggregate_id=str(notification.id),
            deduplication_key=f'notification:{notification.id}:created',
            payload={
                'notification_id': str(notification.id),
                'recipient_user_id': str(recipient.id),
                'kind': notification.kind,
            },
            available_at=now, created_at=now, updated_at=now,
        )
        created_count += 1
    return created_count


def resolve_mention_users(*, project, actor, user_ids):
    requested_ids = {user_id for user_id in user_ids if user_id != actor.id}
    if not requested_ids:
        return []
    users = list(User.objects.filter(id__in=requested_ids, status=UserStatus.ACTIVE))
    if {user.id for user in users} != requested_ids:
        raise NotificationError('Every mentioned user must be an active project collaborator.')
    if any(
        not has_project_permission(
            user=user,
            project=project,
            permission_key=REVIEW_COMMENT_READ,
        )
        for user in users
    ):
        raise NotificationError('Every mentioned user must have permission to read this project.')
    return users


def _create_mention_notification(*, comment, actor, recipient, excerpt, now):
    notification, created = Notification.objects.get_or_create(
        recipient_user=recipient,
        kind=NotificationKind.REVIEW_COMMENT_MENTION,
        entity_type='review_comment',
        entity_id=str(comment.id),
        defaults={
            'id': uuid.uuid4(),
            'workspace': comment.media_version.project.workspace,
            'actor_user': actor,
            'payload': {
                'project_id': str(comment.media_version.project_id),
                'media_version_id': str(comment.media_version_id),
                'review_comment_id': str(comment.id),
                'excerpt': excerpt[:240],
            },
            'created_at': now,
        },
    )
    if created:
        OutboxEvent.objects.create(
            id=uuid.uuid4(),
            topic='notification.created',
            aggregate_type='notification',
            aggregate_id=str(notification.id),
            deduplication_key=f'notification:{notification.id}:created',
            payload={
                'notification_id': str(notification.id),
                'recipient_user_id': str(recipient.id),
                'kind': notification.kind,
            },
            available_at=now,
            created_at=now,
            updated_at=now,
        )
    return notification, created


def set_comment_mentions(*, comment, actor, users, excerpt):
    now = timezone.now()
    desired_ids = {user.id for user in users}
    existing_ids = set(
        ReviewCommentMention.objects.filter(review_comment=comment).values_list(
            'user_id', flat=True
        )
    )
    ReviewCommentMention.objects.filter(
        review_comment=comment,
        user_id__in=existing_ids - desired_ids,
    ).delete()
    for user in users:
        if user.id in existing_ids:
            continue
        ReviewCommentMention.objects.create(
            id=uuid.uuid4(),
            review_comment=comment,
            user=user,
            created_at=now,
        )
        _create_mention_notification(
            comment=comment,
            actor=actor,
            recipient=user,
            excerpt=excerpt,
            now=now,
        )
    return desired_ids


@transaction.atomic
def mark_notification_read(*, notification):
    locked = Notification.objects.select_for_update().get(id=notification.id)
    if locked.read_at is None:
        locked.read_at = timezone.now()
        locked.save(update_fields=['read_at'])
    return locked


@transaction.atomic
def mark_all_notifications_read(*, user):
    now = timezone.now()
    return Notification.objects.filter(recipient_user=user, read_at__isnull=True).update(
        read_at=now
    )
