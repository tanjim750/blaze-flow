from django.contrib.auth import get_user_model
from rest_framework import serializers

from app.models import (
    ClientTeam,
    ClientTeamInvite,
    ClientTeamInviteType,
    ClientTeamMember,
    ProjectAccessMode,
    UserStatus,
)

from .auth import UserSerializer

User = get_user_model()


class ClientTeamSerializer(serializers.ModelSerializer):
    class Meta:
        model = ClientTeam
        fields = (
            'id',
            'name',
            'description',
            'website',
            'email',
            'phone',
            'address_line_1',
            'address_line_2',
            'city',
            'state_region',
            'postal_code',
            'country_code',
            'metadata',
            'status',
            'created_at',
        )
        read_only_fields = fields


class ClientTeamWriteSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255)
    description = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    website = serializers.CharField(max_length=500, required=False, allow_blank=True, allow_null=True)
    email = serializers.EmailField(max_length=255, required=False, allow_null=True)
    phone = serializers.CharField(max_length=100, required=False, allow_blank=True, allow_null=True)
    address_line_1 = serializers.CharField(max_length=255, required=False, allow_blank=True, allow_null=True)
    address_line_2 = serializers.CharField(max_length=255, required=False, allow_blank=True, allow_null=True)
    city = serializers.CharField(max_length=150, required=False, allow_blank=True, allow_null=True)
    state_region = serializers.CharField(max_length=150, required=False, allow_blank=True, allow_null=True)
    postal_code = serializers.CharField(max_length=50, required=False, allow_blank=True, allow_null=True)
    country_code = serializers.CharField(max_length=10, required=False, allow_blank=True, allow_null=True)
    metadata = serializers.JSONField(required=False, allow_null=True)

    def validate_email(self, value):
        return value.lower() if value else value


class ClientTeamCreateSerializer(ClientTeamWriteSerializer):
    pass


class ClientTeamUpdateSerializer(ClientTeamWriteSerializer):
    name = serializers.CharField(max_length=255, required=False)


class ClientTeamMemberSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)

    class Meta:
        model = ClientTeamMember
        fields = ('id', 'user', 'title', 'status', 'joined_at', 'removed_at')
        read_only_fields = fields


class ClientTeamMemberCreateSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=255)
    title = serializers.CharField(max_length=255, required=False, allow_blank=True, allow_null=True)

    def validate(self, attrs):
        email = attrs['email'].lower()
        user = User.objects.filter(email__iexact=email, status=UserStatus.ACTIVE).first()
        if user is None:
            raise serializers.ValidationError(
                {'email': ['No active user was found with this email address.']}
            )
        attrs['user'] = user
        return attrs


class ClientTeamWorkspaceAccessCreateSerializer(serializers.Serializer):
    role_id = serializers.UUIDField()
    project_access_mode = serializers.ChoiceField(
        choices=ProjectAccessMode.choices,
        default=ProjectAccessMode.SELECTED,
    )


class ClientTeamInviteSerializer(serializers.ModelSerializer):
    class Meta:
        model = ClientTeamInvite
        fields = (
            'id',
            'invite_type',
            'recipient_email',
            'label',
            'max_uses',
            'use_count',
            'expires_at',
            'revoked_at',
            'created_at',
        )
        read_only_fields = fields


class ClientTeamInviteCreateSerializer(serializers.Serializer):
    invite_type = serializers.ChoiceField(choices=ClientTeamInviteType.choices)
    recipient_email = serializers.EmailField(max_length=255, required=False, allow_null=True)
    label = serializers.CharField(max_length=255, required=False, allow_blank=True, allow_null=True)
    max_uses = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    expires_in_days = serializers.IntegerField(min_value=1, max_value=90, default=14)

    def validate_recipient_email(self, value):
        return value.lower() if value else value

    def validate(self, attrs):
        invite_type = attrs['invite_type']
        if invite_type == ClientTeamInviteType.EMAIL and not attrs.get('recipient_email'):
            raise serializers.ValidationError(
                {'recipient_email': ['An EMAIL invitation requires a recipient email address.']}
            )
        if invite_type == ClientTeamInviteType.LINK and attrs.get('recipient_email'):
            raise serializers.ValidationError(
                {'recipient_email': ['A LINK invitation cannot target a recipient email address.']}
            )
        return attrs


class ClientTeamInviteAcceptSerializer(serializers.Serializer):
    token = serializers.CharField(min_length=32, max_length=200, trim_whitespace=False)
