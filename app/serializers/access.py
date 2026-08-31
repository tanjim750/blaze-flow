from rest_framework import serializers

from app.models import (
    ProjectAccessMode,
    Role,
    RolePermission,
    WorkspaceInvite,
    WorkspaceMembership,
    WorkspaceMembershipStatus,
    ResourceAccess,
)
from app.permissions import ALL_PERMISSION_KEYS

from .auth import UserSerializer


class RoleSerializer(serializers.ModelSerializer):
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = Role
        fields = ('id', 'name', 'description', 'is_system', 'status', 'permissions')

    def get_permissions(self, role):
        return list(
            RolePermission.objects.filter(role=role).values_list('permission_key', flat=True)
        )


class RoleCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=100)
    description = serializers.CharField(required=False, allow_blank=True)
    permission_keys = serializers.ListField(
        child=serializers.ChoiceField(choices=sorted(ALL_PERMISSION_KEYS)),
        allow_empty=True,
        default=list,
    )

    def validate_name(self, value):
        workspace = self.context['workspace']
        if Role.objects.filter(workspace=workspace, name__iexact=value).exists():
            raise serializers.ValidationError('A role with this name already exists.')
        return value


class RoleUpdateSerializer(RoleCreateSerializer):
    name = serializers.CharField(max_length=100, required=False)
    description = serializers.CharField(required=False, allow_blank=True)
    permission_keys = serializers.ListField(
        child=serializers.ChoiceField(choices=sorted(ALL_PERMISSION_KEYS)),
        allow_empty=True,
        required=False,
    )

    def validate_name(self, value):
        workspace = self.context['workspace']
        role = self.context['role']
        if Role.objects.filter(workspace=workspace, name__iexact=value).exclude(id=role.id).exists():
            raise serializers.ValidationError('A role with this name already exists.')
        return value


class WorkspaceMembershipSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    role = RoleSerializer(read_only=True)

    class Meta:
        model = WorkspaceMembership
        fields = (
            'id',
            'principal_type',
            'user',
            'role',
            'project_access_mode',
            'is_primary_owner',
            'status',
            'joined_at',
        )


class WorkspaceMembershipUpdateSerializer(serializers.Serializer):
    role_id = serializers.UUIDField(required=False)
    project_access_mode = serializers.ChoiceField(
        choices=ProjectAccessMode.choices,
        required=False,
    )
    status = serializers.ChoiceField(
        choices=WorkspaceMembershipStatus.choices,
        required=False,
    )


class WorkspaceInviteCreateSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=255)
    role_id = serializers.UUIDField()
    project_access_mode = serializers.ChoiceField(
        choices=ProjectAccessMode.choices,
        default=ProjectAccessMode.ALL,
    )
    expires_in_days = serializers.IntegerField(min_value=1, max_value=30, default=7)

    def validate_email(self, value):
        return value.lower()


class WorkspaceInviteSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkspaceInvite
        fields = ('id', 'email', 'role_id', 'project_access_mode', 'expires_at', 'created_at')


class WorkspaceInviteAcceptSerializer(serializers.Serializer):
    token = serializers.CharField(min_length=32, max_length=200, trim_whitespace=False)


class ResourceAccessCreateSerializer(serializers.Serializer):
    membership_id = serializers.UUIDField()


class ResourceAccessSerializer(serializers.ModelSerializer):
    membership = WorkspaceMembershipSerializer(source='workspace_membership', read_only=True)

    class Meta:
        model = ResourceAccess
        fields = ('id', 'membership', 'created_at')
