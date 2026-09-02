from rest_framework import serializers

from app.models import UserSubscription


class SubscriptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserSubscription
        fields = (
            'plan',
            'status',
            'current_period_start',
            'current_period_end',
            'cancel_at_period_end',
            'cancelled_at',
        )
