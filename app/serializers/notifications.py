from urllib.parse import urlencode

from rest_framework import serializers

from app.models import Notification, NotificationPreference


def _initials(name):
    parts = [part for part in (name or '').split() if part]
    if not parts:
        return '?'
    first = parts[0][0]
    last = parts[-1][0] if len(parts) > 1 else ''
    return f'{first}{last}'.upper()


def notification_link(notification):
    """The page a notification opens. Stored on new rows; rebuilt for rows written before."""
    payload = notification.payload or {}
    link = payload.get('link')
    if isinstance(link, str) and link.startswith('/'):
        return link
    if notification.entity_type in ('task', 'task_assignee') and payload.get('task_id'):
        return f"/tasks?{urlencode({'task': payload['task_id']})}"
    if payload.get('project_id') and payload.get('media_version_id'):
        query = {'project': payload['project_id'], 'version': payload['media_version_id']}
        if payload.get('review_comment_id'):
            query['comment'] = payload['review_comment_id']
        return f'/review?{urlencode(query)}'
    return None


class NotificationSerializer(serializers.ModelSerializer):
    actor = serializers.SerializerMethodField()
    unread = serializers.SerializerMethodField()
    link = serializers.SerializerMethodField()
    snippet = serializers.SerializerMethodField()
    poster_url = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = (
            'id', 'kind', 'workspace_id', 'actor', 'entity_type', 'entity_id',
            'payload', 'link', 'snippet', 'poster_url', 'unread', 'read_at', 'created_at',
        )

    def get_actor(self, notification):
        user = notification.actor_user
        if user is None:
            guest_name = (notification.payload or {}).get('actor_name')
            if not guest_name:
                return None
            return {'id': None, 'email': None, 'name': guest_name, 'initials': _initials(guest_name), 'avatar_url': None, 'is_guest': True}
        name = user.get_full_name() or user.email
        return {
            'id': str(user.id),
            'email': user.email,
            'name': name,
            'initials': _initials(name),
            'avatar_url': user.avatar_url or None,
            'is_guest': False,
        }

    def get_unread(self, notification):
        return notification.read_at is None

    def get_link(self, notification):
        return notification_link(notification)

    def get_snippet(self, notification):
        payload = notification.payload or {}
        return payload.get('excerpt') or None

    def get_poster_url(self, notification):
        # Filled in bulk by the list view (one query for the page); absent elsewhere.
        posters = self.context.get('posters') or {}
        media_version_id = (notification.payload or {}).get('media_version_id')
        return posters.get(media_version_id)


class NotificationPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationPreference
        fields = ('email_mentions_enabled', 'updated_at')
        read_only_fields = ('updated_at',)
