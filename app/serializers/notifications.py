from rest_framework import serializers

from app.models import Notification, NotificationPreference


class NotificationSerializer(serializers.ModelSerializer):
    actor = serializers.SerializerMethodField()
    unread = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = (
            'id', 'kind', 'workspace_id', 'actor', 'entity_type', 'entity_id',
            'payload', 'unread', 'read_at', 'created_at',
        )

    def get_actor(self, notification):
        user = notification.actor_user
        if user is None:
            return None
        return {
            'id': str(user.id),
            'email': user.email,
            'name': user.get_full_name(),
        }

    def get_unread(self, notification):
        return notification.read_at is None


class NotificationPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationPreference
        fields = ('email_mentions_enabled', 'updated_at')
        read_only_fields = ('updated_at',)
