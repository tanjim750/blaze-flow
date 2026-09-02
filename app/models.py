import uuid

from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models.functions import Lower

from .managers import UserManager


class UserStatus(models.TextChoices):
    ACTIVE = 'ACTIVE'
    SUSPENDED = 'SUSPENDED'
    DELETED = 'DELETED'


class OAuthProvider(models.TextChoices):
    GOOGLE = 'GOOGLE'


class WorkspaceStatus(models.TextChoices):
    ACTIVE = 'ACTIVE'
    SUSPENDED = 'SUSPENDED'
    PENDING_DELETION = 'PENDING_DELETION'


class WorkspaceMemberType(models.TextChoices):
    INTERNAL = 'INTERNAL'
    CLIENT = 'CLIENT'


class WorkspaceMembershipStatus(models.TextChoices):
    ACTIVE = 'ACTIVE'
    SUSPENDED = 'SUSPENDED'
    REMOVED = 'REMOVED'


class RoleStatus(models.TextChoices):
    ACTIVE = 'ACTIVE'
    ARCHIVED = 'ARCHIVED'


class ProjectAccessMode(models.TextChoices):
    ALL = 'ALL'
    SELECTED = 'SELECTED'


class WorkspacePrincipalType(models.TextChoices):
    USER = 'USER'
    CLIENT_TEAM = 'CLIENT_TEAM'


class ProjectStatus(models.TextChoices):
    DRAFT = 'DRAFT'
    ACTIVE = 'ACTIVE'
    ON_HOLD = 'ON_HOLD'
    COMPLETED = 'COMPLETED'
    ARCHIVED = 'ARCHIVED'
    PENDING_DELETION = 'PENDING_DELETION'


class PriorityLevel(models.TextChoices):
    LOW = 'LOW'
    MEDIUM = 'MEDIUM'
    HIGH = 'HIGH'


class MediaVersionStatus(models.TextChoices):
    ACTIVE = 'ACTIVE'
    PENDING_DELETION = 'PENDING_DELETION'


class WorkflowStageStatusState(models.TextChoices):
    ACTIVE = 'ACTIVE'
    ARCHIVED = 'ARCHIVED'


class ReviewCommentContentType(models.TextChoices):
    TEXT = 'TEXT'
    AUDIO = 'AUDIO'
    IMAGE = 'IMAGE'
    FILE = 'FILE'


class ReviewReactionEmoji(models.TextChoices):
    THUMBS_UP = '👍', 'Thumbs up'
    HEART = '❤️', 'Heart'
    LAUGH = '😂', 'Laugh'
    SURPRISED = '😮', 'Surprised'
    SAD = '😢', 'Sad'
    CELEBRATE = '🎉', 'Celebrate'


class TaskStatus(models.TextChoices):
    TODO = 'TODO'
    IN_PROGRESS = 'IN_PROGRESS'
    COMPLETED = 'COMPLETED'
    CANCELLED = 'CANCELLED'


class FileStatus(models.TextChoices):
    PENDING = 'PENDING'
    READY = 'READY'
    FAILED = 'FAILED'


class FileSecurityScanStatus(models.TextChoices):
    PENDING = 'PENDING'
    CLEAN = 'CLEAN'
    INFECTED = 'INFECTED'
    FAILED = 'FAILED'


class StorageBackendStatus(models.TextChoices):
    ACTIVE = 'ACTIVE'
    DISABLED = 'DISABLED'


class ClientTeamStatus(models.TextChoices):
    ACTIVE = 'ACTIVE'
    ARCHIVED = 'ARCHIVED'
    DELETED = 'DELETED'


class ClientTeamMemberStatus(models.TextChoices):
    ACTIVE = 'ACTIVE'
    REMOVED = 'REMOVED'


class ClientTeamInviteType(models.TextChoices):
    EMAIL = 'EMAIL'
    LINK = 'LINK'


class AuditActorType(models.TextChoices):
    USER = 'USER'
    GUEST = 'GUEST'
    SYSTEM = 'SYSTEM'


class NotificationKind(models.TextChoices):
    REVIEW_COMMENT_MENTION = 'REVIEW_COMMENT_MENTION'


class OutboxEventStatus(models.TextChoices):
    PENDING = 'PENDING'
    PROCESSING = 'PROCESSING'
    PUBLISHED = 'PUBLISHED'
    FAILED = 'FAILED'
    DEAD_LETTER = 'DEAD_LETTER'


class NotificationDeliveryChannel(models.TextChoices):
    EMAIL = 'EMAIL'


class NotificationDeliveryStatus(models.TextChoices):
    PENDING = 'PENDING'
    SENT = 'SENT'
    SKIPPED = 'SKIPPED'
    FAILED = 'FAILED'


class SubscriptionPlan(models.TextChoices):
    FREE = 'FREE'
    PRO = 'PRO'


class SubscriptionStatus(models.TextChoices):
    ACTIVE = 'ACTIVE'
    CANCELLED = 'CANCELLED'
    EXPIRED = 'EXPIRED'
    PAST_DUE = 'PAST_DUE'


class User(AbstractBaseUser, PermissionsMixin):
    """The single identity used by the domain and Django authentication."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(max_length=255, unique=True)
    first_name = models.CharField(max_length=150)
    last_name = models.CharField(max_length=150)
    avatar_url = models.TextField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=UserStatus.choices, default=UserStatus.ACTIVE)
    email_verified_at = models.DateTimeField(null=True, blank=True)
    timezone = models.CharField(max_length=100, null=True, blank=True)
    is_staff = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = UserManager()

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['first_name', 'last_name']

    @property
    def is_active(self):
        return self.status == UserStatus.ACTIVE

    def get_full_name(self):
        return f'{self.first_name} {self.last_name}'.strip()

    def get_short_name(self):
        return self.first_name

    class Meta:
        db_table = 'users'
        constraints = [
            models.UniqueConstraint(Lower('email'), name='users_email_case_insensitive_uniq')
        ]


class OAuthIdentity(models.Model):
    id = models.UUIDField(primary_key=True)
    user = models.ForeignKey(User, on_delete=models.DO_NOTHING, db_column='user_id', related_name='+')
    provider = models.CharField(max_length=20, choices=OAuthProvider.choices)
    provider_subject = models.CharField(max_length=255)
    provider_email = models.CharField(max_length=255, null=True, blank=True)
    provider_email_verified = models.BooleanField(default=False)
    provider_first_name = models.CharField(max_length=150, null=True, blank=True)
    provider_last_name = models.CharField(max_length=150, null=True, blank=True)
    provider_avatar_url = models.TextField(null=True, blank=True)
    profile_metadata = models.JSONField(null=True, blank=True)
    linked_at = models.DateTimeField()
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        db_table = 'oauth_identities'
        constraints = [
            models.UniqueConstraint(fields=['provider', 'provider_subject'], name='oauth_identities_provider_subject_uniq'),
            models.UniqueConstraint(fields=['user', 'provider'], name='oauth_identities_user_provider_uniq'),
        ]


class PasswordResetToken(models.Model):
    id = models.UUIDField(primary_key=True)
    user = models.ForeignKey(User, on_delete=models.DO_NOTHING, db_column='user_id', related_name='+')
    token_hash = models.CharField(max_length=255, unique=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    invalidated_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField()

    class Meta:
        db_table = 'password_reset_tokens'
        indexes = [models.Index(fields=['user', 'created_at'])]


class EmailVerificationToken(models.Model):
    id = models.UUIDField(primary_key=True)
    user = models.ForeignKey(User, on_delete=models.DO_NOTHING, db_column='user_id', related_name='+')
    token_hash = models.CharField(max_length=255, unique=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    invalidated_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField()

    class Meta:
        db_table = 'email_verification_tokens'
        indexes = [models.Index(fields=['user', 'created_at'])]


class Workspace(models.Model):
    id = models.UUIDField(primary_key=True)
    name = models.CharField(max_length=150)
    slug = models.CharField(max_length=150, unique=True)
    created_by_user = models.ForeignKey(User, on_delete=models.DO_NOTHING, db_column='created_by_user_id', related_name='+')
    timezone = models.CharField(max_length=100)
    status = models.CharField(max_length=30, choices=WorkspaceStatus.choices, default=WorkspaceStatus.ACTIVE)
    deletion_scheduled_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        db_table = 'workspaces'
        indexes = [models.Index(fields=['created_by_user'])]


class WorkspaceProfile(models.Model):
    id = models.UUIDField(primary_key=True)
    workspace = models.OneToOneField(Workspace, on_delete=models.DO_NOTHING, db_column='workspace_id', related_name='+')
    business_name = models.CharField(max_length=200, null=True, blank=True)
    description = models.TextField(null=True, blank=True)
    email = models.CharField(max_length=255, null=True, blank=True)
    phone = models.CharField(max_length=50, null=True, blank=True)
    website_url = models.TextField(null=True, blank=True)
    address_line_1 = models.CharField(max_length=255, null=True, blank=True)
    address_line_2 = models.CharField(max_length=255, null=True, blank=True)
    city = models.CharField(max_length=100, null=True, blank=True)
    state = models.CharField(max_length=100, null=True, blank=True)
    postal_code = models.CharField(max_length=30, null=True, blank=True)
    country_code = models.CharField(max_length=2, null=True, blank=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        db_table = 'workspace_profiles'


class WorkspaceRetentionPolicy(models.Model):
    id = models.UUIDField(primary_key=True)
    workspace = models.OneToOneField(Workspace, on_delete=models.DO_NOTHING, db_column='workspace_id', related_name='+')
    review_file_cleanup_enabled = models.BooleanField(default=True)
    review_file_retention_days = models.PositiveIntegerField()
    updated_by_user = models.ForeignKey(User, on_delete=models.DO_NOTHING, db_column='updated_by_user_id', related_name='+')
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        db_table = 'workspace_retention_policies'


class GuestSession(models.Model):
    id = models.UUIDField(primary_key=True)
    workspace = models.ForeignKey(Workspace, on_delete=models.DO_NOTHING, db_column='workspace_id', related_name='+')
    name = models.CharField(max_length=150)
    email = models.CharField(max_length=255)
    access_key_hash = models.CharField(max_length=255, unique=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        db_table = 'guest_sessions'
        indexes = [
            models.Index(fields=['workspace']),
            models.Index(fields=['workspace', 'email']),
        ]


class StorageBackend(models.Model):
    id = models.UUIDField(primary_key=True)
    name = models.CharField(max_length=150)
    provider = models.CharField(max_length=100)
    config = models.JSONField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=StorageBackendStatus.choices, default=StorageBackendStatus.ACTIVE)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        db_table = 'storage_backends'
        indexes = [
            models.Index(fields=['provider']),
            models.Index(fields=['status']),
        ]


class File(models.Model):
    id = models.UUIDField(primary_key=True)
    workspace = models.ForeignKey(Workspace, on_delete=models.DO_NOTHING, db_column='workspace_id', related_name='+')
    storage_backend = models.ForeignKey(StorageBackend, on_delete=models.DO_NOTHING, db_column='storage_backend_id', related_name='+')
    object_key = models.CharField(max_length=1024)
    original_name = models.CharField(max_length=512)
    mime_type = models.CharField(max_length=255)
    size_bytes = models.BigIntegerField()
    checksum = models.CharField(max_length=512, null=True, blank=True)
    checksum_algorithm = models.CharField(max_length=50, null=True, blank=True)
    metadata = models.JSONField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=FileStatus.choices, default=FileStatus.PENDING)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        db_table = 'files'
        constraints = [models.UniqueConstraint(fields=['storage_backend', 'object_key'], name='files_storage_backend_object_key_uniq')]
        indexes = [
            models.Index(fields=['workspace']),
            models.Index(fields=['storage_backend']),
            models.Index(fields=['mime_type']),
            models.Index(fields=['status']),
            models.Index(fields=['deleted_at']),
        ]


class Role(models.Model):
    id = models.UUIDField(primary_key=True)
    workspace = models.ForeignKey(Workspace, on_delete=models.DO_NOTHING, db_column='workspace_id', related_name='+')
    name = models.CharField(max_length=100)
    description = models.TextField(null=True, blank=True)
    is_system = models.BooleanField(default=False)
    status = models.CharField(max_length=20, choices=RoleStatus.choices, default=RoleStatus.ACTIVE)
    created_by_user = models.ForeignKey(User, on_delete=models.DO_NOTHING, db_column='created_by_user_id', related_name='+')
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        db_table = 'roles'
        constraints = [
            models.UniqueConstraint(fields=['workspace', 'name'], name='roles_workspace_name_uniq'),
            models.UniqueConstraint(
                models.F('workspace'),
                Lower('name'),
                name='roles_workspace_name_case_insensitive_uniq',
            ),
        ]


class RolePermission(models.Model):
    # The SQL reference uses PRIMARY KEY (role_id, permission_key).
    # Django 4.2 requires a single ORM primary key, so id is an ORM surrogate.
    id = models.BigAutoField(primary_key=True)
    role = models.ForeignKey(Role, on_delete=models.DO_NOTHING, db_column='role_id', related_name='+')
    permission_key = models.CharField(max_length=100)

    class Meta:
        db_table = 'role_permissions'
        constraints = [models.UniqueConstraint(fields=['role', 'permission_key'], name='role_permissions_role_permission_key_uniq')]


class ClientTeam(models.Model):
    id = models.UUIDField(primary_key=True)
    workspace = models.ForeignKey(Workspace, on_delete=models.DO_NOTHING, db_column='workspace_id', related_name='+')
    created_by_workspace_membership = models.ForeignKey('WorkspaceMembership', on_delete=models.DO_NOTHING, db_column='created_by_workspace_membership_id', null=True, blank=True, related_name='+')
    name = models.CharField(max_length=255)
    description = models.TextField(null=True, blank=True)
    logo_file = models.ForeignKey(File, on_delete=models.DO_NOTHING, db_column='logo_file_id', null=True, blank=True, related_name='+')
    website = models.CharField(max_length=500, null=True, blank=True)
    email = models.CharField(max_length=255, null=True, blank=True)
    phone = models.CharField(max_length=100, null=True, blank=True)
    address_line_1 = models.CharField(max_length=255, null=True, blank=True)
    address_line_2 = models.CharField(max_length=255, null=True, blank=True)
    city = models.CharField(max_length=150, null=True, blank=True)
    state_region = models.CharField(max_length=150, null=True, blank=True)
    postal_code = models.CharField(max_length=50, null=True, blank=True)
    country_code = models.CharField(max_length=10, null=True, blank=True)
    metadata = models.JSONField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=ClientTeamStatus.choices, default=ClientTeamStatus.ACTIVE)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        db_table = 'client_teams'
        indexes = [
            models.Index(fields=['workspace']),
            models.Index(fields=['status']),
        ]


class WorkspaceMembership(models.Model):
    id = models.UUIDField(primary_key=True)
    workspace = models.ForeignKey(Workspace, on_delete=models.DO_NOTHING, db_column='workspace_id', related_name='+')
    principal_type = models.CharField(max_length=20, choices=WorkspacePrincipalType.choices)
    user = models.ForeignKey(User, on_delete=models.DO_NOTHING, db_column='user_id', null=True, blank=True, related_name='+')
    client_team = models.ForeignKey(ClientTeam, on_delete=models.DO_NOTHING, db_column='client_team_id', null=True, blank=True, related_name='+')
    role = models.ForeignKey(Role, on_delete=models.DO_NOTHING, db_column='role_id', null=True, blank=True, related_name='+')
    project_access_mode = models.CharField(max_length=20, choices=ProjectAccessMode.choices, default=ProjectAccessMode.SELECTED)
    is_primary_owner = models.BooleanField(default=False)
    status = models.CharField(max_length=20, choices=WorkspaceMembershipStatus.choices)
    joined_at = models.DateTimeField()
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        db_table = 'workspace_memberships'
        constraints = [
            models.UniqueConstraint(fields=['workspace', 'user'], name='workspace_memberships_workspace_user_uniq'),
            models.UniqueConstraint(fields=['workspace', 'client_team'], name='workspace_memberships_workspace_client_team_uniq'),
            models.CheckConstraint(
                check=(
                    models.Q(
                        principal_type=WorkspacePrincipalType.USER,
                        user__isnull=False,
                        client_team__isnull=True,
                    )
                    | models.Q(
                        principal_type=WorkspacePrincipalType.CLIENT_TEAM,
                        user__isnull=True,
                        client_team__isnull=False,
                    )
                ),
                name='workspace_memberships_principal_matches_type',
            ),
            models.CheckConstraint(
                check=(
                    models.Q(is_primary_owner=False)
                    | models.Q(
                        principal_type=WorkspacePrincipalType.USER,
                        user__isnull=False,
                        client_team__isnull=True,
                        status=WorkspaceMembershipStatus.ACTIVE,
                    )
                ),
                name='workspace_memberships_owner_is_active_user',
            ),
            models.UniqueConstraint(
                fields=['workspace'],
                condition=models.Q(
                    is_primary_owner=True,
                    status=WorkspaceMembershipStatus.ACTIVE,
                ),
                name='workspace_memberships_one_active_owner',
            ),
        ]
        indexes = [
            models.Index(fields=['workspace']),
            models.Index(fields=['user']),
            models.Index(fields=['client_team']),
        ]

    def clean(self):
        errors = {}
        if self.role_id and self.workspace_id and self.role.workspace_id != self.workspace_id:
            errors['role'] = 'The role must belong to the membership workspace.'
        if (
            self.client_team_id
            and self.workspace_id
            and self.client_team.workspace_id != self.workspace_id
        ):
            errors['client_team'] = 'The client team must belong to the membership workspace.'
        if errors:
            raise ValidationError(errors)


class WorkspaceInvite(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.DO_NOTHING, related_name='+')
    email = models.EmailField(max_length=255)
    role = models.ForeignKey(Role, on_delete=models.DO_NOTHING, related_name='+')
    project_access_mode = models.CharField(
        max_length=20,
        choices=ProjectAccessMode.choices,
        default=ProjectAccessMode.ALL,
    )
    token_hash = models.CharField(max_length=64, unique=True)
    invited_by_membership = models.ForeignKey(
        WorkspaceMembership,
        on_delete=models.DO_NOTHING,
        related_name='+',
    )
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    accepted_by_user = models.ForeignKey(
        User,
        on_delete=models.DO_NOTHING,
        null=True,
        blank=True,
        related_name='+',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'workspace_invites'
        indexes = [
            models.Index(fields=['workspace', 'email']),
            models.Index(fields=['expires_at']),
        ]
        constraints = [
            models.CheckConstraint(
                check=(
                    models.Q(accepted_at__isnull=True, accepted_by_user__isnull=True)
                    | models.Q(accepted_at__isnull=False, accepted_by_user__isnull=False)
                ),
                name='workspace_invites_acceptance_pair',
            )
        ]

    def clean(self):
        errors = {}
        if self.role_id and self.workspace_id and self.role.workspace_id != self.workspace_id:
            errors['role'] = 'The role must belong to the invitation workspace.'
        if (
            self.invited_by_membership_id
            and self.workspace_id
            and self.invited_by_membership.workspace_id != self.workspace_id
        ):
            errors['invited_by_membership'] = 'The inviter must belong to the invitation workspace.'
        if errors:
            raise ValidationError(errors)


class Project(models.Model):
    id = models.UUIDField(primary_key=True)
    workspace = models.ForeignKey(Workspace, on_delete=models.DO_NOTHING, db_column='workspace_id', related_name='+')
    created_by_user = models.ForeignKey(User, on_delete=models.DO_NOTHING, db_column='created_by_user_id', related_name='+')
    name = models.CharField(max_length=200)
    description = models.TextField(null=True, blank=True)
    status = models.CharField(max_length=30, choices=ProjectStatus.choices, default=ProjectStatus.DRAFT)
    priority = models.CharField(max_length=20, choices=PriorityLevel.choices, default=PriorityLevel.MEDIUM)
    start_at = models.DateTimeField(null=True, blank=True)
    due_at = models.DateTimeField(null=True, blank=True)
    deletion_scheduled_at = models.DateTimeField(null=True, blank=True)
    next_media_version_number = models.IntegerField(default=1)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        db_table = 'projects'
        indexes = [
            models.Index(fields=['workspace']),
            models.Index(fields=['created_by_user']),
            models.Index(fields=['status']),
        ]


class ResourceAccess(models.Model):
    id = models.UUIDField(primary_key=True)
    workspace_membership = models.ForeignKey(WorkspaceMembership, on_delete=models.DO_NOTHING, db_column='workspace_membership_id', related_name='+')
    project = models.ForeignKey(Project, on_delete=models.DO_NOTHING, db_column='project_id', related_name='+')
    created_at = models.DateTimeField()

    class Meta:
        db_table = 'resource_access'
        constraints = [models.UniqueConstraint(fields=['workspace_membership', 'project'], name='resource_access_membership_project_uniq')]
        indexes = [models.Index(fields=['project'])]

    def clean(self):
        if (
            self.workspace_membership_id
            and self.project_id
            and self.workspace_membership.workspace_id != self.project.workspace_id
        ):
            raise ValidationError(
                {'project': 'The project and membership must belong to the same workspace.'}
            )


class WorkflowStage(models.Model):
    id = models.UUIDField(primary_key=True)
    workspace = models.ForeignKey(Workspace, on_delete=models.DO_NOTHING, db_column='workspace_id', related_name='+')
    name = models.CharField(max_length=100)
    slug = models.CharField(max_length=120)
    sort_order = models.IntegerField()
    created_by_user = models.ForeignKey(User, on_delete=models.DO_NOTHING, db_column='created_by_user_id', null=True, blank=True, related_name='+')
    status = models.CharField(max_length=20, choices=WorkflowStageStatusState.choices, default=WorkflowStageStatusState.ACTIVE)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        db_table = 'workflow_stages'
        constraints = [models.UniqueConstraint(fields=['workspace', 'slug'], name='workflow_stages_workspace_slug_uniq')]
        indexes = [
            models.Index(fields=['workspace']),
            models.Index(fields=['sort_order']),
        ]


class WorkflowStageStatus(models.Model):
    id = models.UUIDField(primary_key=True)
    workflow_stage = models.ForeignKey(WorkflowStage, on_delete=models.DO_NOTHING, db_column='workflow_stage_id', related_name='+')
    name = models.CharField(max_length=100)
    slug = models.CharField(max_length=120)
    sort_order = models.IntegerField()
    created_by_user = models.ForeignKey(User, on_delete=models.DO_NOTHING, db_column='created_by_user_id', null=True, blank=True, related_name='+')
    status = models.CharField(max_length=20, choices=WorkflowStageStatusState.choices, default=WorkflowStageStatusState.ACTIVE)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        db_table = 'workflow_stage_statuses'
        constraints = [models.UniqueConstraint(fields=['workflow_stage', 'slug'], name='workflow_stage_statuses_stage_slug_uniq')]
        indexes = [
            models.Index(fields=['workflow_stage']),
            models.Index(fields=['sort_order']),
        ]


class MediaVersion(models.Model):
    id = models.UUIDField(primary_key=True)
    project = models.ForeignKey(Project, on_delete=models.DO_NOTHING, db_column='project_id', related_name='+')
    original_file = models.ForeignKey(File, on_delete=models.DO_NOTHING, db_column='original_file_id', related_name='+')
    version_number = models.IntegerField()
    title = models.CharField(max_length=200)
    note = models.TextField(null=True, blank=True)
    priority = models.CharField(max_length=20, choices=PriorityLevel.choices, default=PriorityLevel.MEDIUM)
    allow_download = models.BooleanField(default=False)
    status = models.CharField(max_length=30, choices=MediaVersionStatus.choices, default=MediaVersionStatus.ACTIVE)
    deletion_scheduled_at = models.DateTimeField(null=True, blank=True)
    created_by_user = models.ForeignKey(User, on_delete=models.DO_NOTHING, db_column='created_by_user_id', related_name='+')
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        db_table = 'media_versions'
        constraints = [models.UniqueConstraint(fields=['project', 'version_number'], name='media_versions_project_version_number_uniq')]
        indexes = [
            models.Index(fields=['project']),
            models.Index(fields=['original_file']),
            models.Index(fields=['created_by_user']),
        ]


class MediaVersionStageEntry(models.Model):
    id = models.UUIDField(primary_key=True)
    media_version = models.ForeignKey(MediaVersion, on_delete=models.DO_NOTHING, db_column='media_version_id', related_name='+')
    workflow_stage = models.ForeignKey(WorkflowStage, on_delete=models.DO_NOTHING, db_column='workflow_stage_id', null=True, blank=True, related_name='+')
    workflow_stage_status = models.ForeignKey(WorkflowStageStatus, on_delete=models.DO_NOTHING, db_column='workflow_stage_status_id', null=True, blank=True, related_name='+')
    snapshot = models.JSONField()
    entered_at = models.DateTimeField()
    exited_at = models.DateTimeField(null=True, blank=True)
    changed_by_user = models.ForeignKey(User, on_delete=models.DO_NOTHING, db_column='changed_by_user_id', related_name='+')
    created_at = models.DateTimeField()

    class Meta:
        db_table = 'media_version_stage_entries'
        constraints = [
            models.UniqueConstraint(
                fields=['media_version'],
                condition=models.Q(exited_at__isnull=True),
                name='media_stage_entries_one_open_entry',
            )
        ]
        indexes = [
            models.Index(fields=['media_version']),
            models.Index(fields=['workflow_stage']),
            models.Index(fields=['workflow_stage_status']),
            models.Index(fields=['media_version', 'entered_at']),
        ]

    def clean(self):
        errors = {}
        project_workspace_id = self.media_version.project.workspace_id if self.media_version_id else None
        if (
            self.workflow_stage_id
            and project_workspace_id
            and self.workflow_stage.workspace_id != project_workspace_id
        ):
            errors['workflow_stage'] = 'The workflow stage must belong to the media workspace.'
        if (
            self.workflow_stage_status_id
            and self.workflow_stage_id
            and self.workflow_stage_status.workflow_stage_id != self.workflow_stage_id
        ):
            errors['workflow_stage_status'] = 'The status must belong to the selected stage.'
        if errors:
            raise ValidationError(errors)


class ReviewComment(models.Model):
    id = models.UUIDField(primary_key=True)
    media_version = models.ForeignKey(MediaVersion, on_delete=models.DO_NOTHING, db_column='media_version_id', related_name='+')
    parent_comment = models.ForeignKey('self', on_delete=models.DO_NOTHING, db_column='parent_comment_id', null=True, blank=True, related_name='+')
    author_user = models.ForeignKey(User, on_delete=models.DO_NOTHING, db_column='author_user_id', null=True, blank=True, related_name='+')
    author_guest_session = models.ForeignKey(GuestSession, on_delete=models.DO_NOTHING, db_column='author_guest_session_id', null=True, blank=True, related_name='+')
    start_time_ms = models.BigIntegerField(null=True, blank=True)
    end_time_ms = models.BigIntegerField(null=True, blank=True)
    resolved = models.BooleanField(default=False)
    resolved_by_user = models.ForeignKey(User, on_delete=models.DO_NOTHING, db_column='resolved_by_user_id', null=True, blank=True, related_name='+')
    resolved_at = models.DateTimeField(null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by_user = models.ForeignKey(User, on_delete=models.DO_NOTHING, db_column='deleted_by_user_id', null=True, blank=True, related_name='+')
    deleted_by_guest_session = models.ForeignKey(GuestSession, on_delete=models.DO_NOTHING, db_column='deleted_by_guest_session_id', null=True, blank=True, related_name='+')
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        db_table = 'review_comments'
        constraints = [
            models.CheckConstraint(
                check=(
                    models.Q(author_user__isnull=False, author_guest_session__isnull=True)
                    | models.Q(author_user__isnull=True, author_guest_session__isnull=False)
                ),
                name='review_comments_exactly_one_author',
            )
        ]
        indexes = [
            models.Index(fields=['media_version']),
            models.Index(fields=['parent_comment']),
            models.Index(fields=['author_user']),
            models.Index(fields=['author_guest_session']),
            models.Index(fields=['resolved']),
            models.Index(fields=['deleted_at']),
        ]


class ReviewCommentContent(models.Model):
    id = models.UUIDField(primary_key=True)
    review_comment = models.ForeignKey(ReviewComment, on_delete=models.DO_NOTHING, db_column='review_comment_id', related_name='+')
    content_type = models.CharField(max_length=20, choices=ReviewCommentContentType.choices)
    text_content = models.TextField(null=True, blank=True)
    file = models.ForeignKey(File, on_delete=models.DO_NOTHING, db_column='file_id', null=True, blank=True, related_name='+')
    sort_order = models.IntegerField(default=0)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by_user = models.ForeignKey(User, on_delete=models.DO_NOTHING, db_column='deleted_by_user_id', null=True, blank=True, related_name='+')
    deleted_by_guest_session = models.ForeignKey(GuestSession, on_delete=models.DO_NOTHING, db_column='deleted_by_guest_session_id', null=True, blank=True, related_name='+')
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        db_table = 'review_comment_contents'
        indexes = [
            models.Index(fields=['review_comment']),
            models.Index(fields=['file']),
            models.Index(fields=['review_comment', 'sort_order']),
            models.Index(fields=['deleted_at']),
        ]


class ReviewCommentRevision(models.Model):
    id = models.UUIDField(primary_key=True)
    review_comment = models.ForeignKey(ReviewComment, on_delete=models.DO_NOTHING, db_column='review_comment_id', related_name='+')
    edited_by_user = models.ForeignKey(User, on_delete=models.DO_NOTHING, db_column='edited_by_user_id', null=True, blank=True, related_name='+')
    edited_by_guest_session = models.ForeignKey(GuestSession, on_delete=models.DO_NOTHING, db_column='edited_by_guest_session_id', null=True, blank=True, related_name='+')
    snapshot = models.JSONField()
    created_at = models.DateTimeField()

    class Meta:
        db_table = 'review_comment_revisions'
        indexes = [
            models.Index(fields=['review_comment']),
            models.Index(fields=['edited_by_user']),
            models.Index(fields=['edited_by_guest_session']),
        ]


class ReviewCommentMention(models.Model):
    id = models.UUIDField(primary_key=True)
    review_comment = models.ForeignKey(ReviewComment, on_delete=models.DO_NOTHING, db_column='review_comment_id', related_name='+')
    user = models.ForeignKey(User, on_delete=models.DO_NOTHING, db_column='user_id', related_name='+')
    created_at = models.DateTimeField()

    class Meta:
        db_table = 'review_comment_mentions'
        constraints = [
            models.UniqueConstraint(
                fields=['review_comment', 'user'],
                name='review_comment_mentions_comment_user_uniq',
            )
        ]
        indexes = [
            models.Index(fields=['review_comment']),
            models.Index(fields=['user', 'created_at']),
        ]


class ReviewCommentReaction(models.Model):
    id = models.UUIDField(primary_key=True)
    review_comment = models.ForeignKey(ReviewComment, on_delete=models.DO_NOTHING, db_column='review_comment_id', related_name='+')
    emoji = models.CharField(max_length=16, choices=ReviewReactionEmoji.choices)
    reacted_by_user = models.ForeignKey(User, on_delete=models.DO_NOTHING, db_column='reacted_by_user_id', null=True, blank=True, related_name='+')
    reacted_by_guest_session = models.ForeignKey(GuestSession, on_delete=models.DO_NOTHING, db_column='reacted_by_guest_session_id', null=True, blank=True, related_name='+')
    created_at = models.DateTimeField()

    class Meta:
        db_table = 'review_comment_reactions'
        constraints = [
            models.CheckConstraint(
                check=(
                    models.Q(reacted_by_user__isnull=False, reacted_by_guest_session__isnull=True)
                    | models.Q(reacted_by_user__isnull=True, reacted_by_guest_session__isnull=False)
                ),
                name='review_reactions_exactly_one_actor',
            ),
            models.UniqueConstraint(
                fields=['review_comment', 'emoji', 'reacted_by_user'],
                condition=models.Q(reacted_by_user__isnull=False),
                name='review_reactions_comment_emoji_user_uniq',
            ),
            models.UniqueConstraint(
                fields=['review_comment', 'emoji', 'reacted_by_guest_session'],
                condition=models.Q(reacted_by_guest_session__isnull=False),
                name='review_reactions_comment_emoji_guest_uniq',
            ),
        ]
        indexes = [
            models.Index(fields=['review_comment', 'emoji']),
            models.Index(fields=['reacted_by_user']),
            models.Index(fields=['reacted_by_guest_session']),
        ]


class Annotation(models.Model):
    id = models.UUIDField(primary_key=True)
    media_version = models.ForeignKey(MediaVersion, on_delete=models.DO_NOTHING, db_column='media_version_id', related_name='+')
    review_comment = models.ForeignKey(ReviewComment, on_delete=models.DO_NOTHING, db_column='review_comment_id', null=True, blank=True, related_name='+')
    author_user = models.ForeignKey(User, on_delete=models.DO_NOTHING, db_column='author_user_id', null=True, blank=True, related_name='+')
    author_guest_session = models.ForeignKey(GuestSession, on_delete=models.DO_NOTHING, db_column='author_guest_session_id', null=True, blank=True, related_name='+')
    start_time_ms = models.BigIntegerField(null=True, blank=True)
    end_time_ms = models.BigIntegerField(null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by_user = models.ForeignKey(User, on_delete=models.DO_NOTHING, db_column='deleted_by_user_id', null=True, blank=True, related_name='+')
    deleted_by_guest_session = models.ForeignKey(GuestSession, on_delete=models.DO_NOTHING, db_column='deleted_by_guest_session_id', null=True, blank=True, related_name='+')
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        db_table = 'annotations'
        constraints = [
            models.CheckConstraint(
                check=(
                    models.Q(author_user__isnull=False, author_guest_session__isnull=True)
                    | models.Q(author_user__isnull=True, author_guest_session__isnull=False)
                ),
                name='annotations_exactly_one_author',
            )
        ]
        indexes = [
            models.Index(fields=['media_version']),
            models.Index(fields=['review_comment']),
            models.Index(fields=['author_user']),
            models.Index(fields=['author_guest_session']),
            models.Index(fields=['deleted_at']),
        ]


class AnnotationElement(models.Model):
    id = models.UUIDField(primary_key=True)
    annotation = models.ForeignKey(Annotation, on_delete=models.DO_NOTHING, db_column='annotation_id', related_name='+')
    element_type = models.CharField(max_length=100)
    sort_order = models.IntegerField(default=0)
    geometry = models.JSONField(null=True, blank=True)
    style = models.JSONField(null=True, blank=True)
    payload = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        db_table = 'annotation_elements'
        indexes = [
            models.Index(fields=['annotation']),
            models.Index(fields=['element_type']),
            models.Index(fields=['annotation', 'sort_order']),
        ]


class AnnotationRevision(models.Model):
    id = models.UUIDField(primary_key=True)
    annotation = models.ForeignKey(Annotation, on_delete=models.DO_NOTHING, db_column='annotation_id', related_name='+')
    edited_by_user = models.ForeignKey(User, on_delete=models.DO_NOTHING, db_column='edited_by_user_id', null=True, blank=True, related_name='+')
    edited_by_guest_session = models.ForeignKey(GuestSession, on_delete=models.DO_NOTHING, db_column='edited_by_guest_session_id', null=True, blank=True, related_name='+')
    snapshot = models.JSONField()
    created_at = models.DateTimeField()

    class Meta:
        db_table = 'annotation_revisions'
        indexes = [
            models.Index(fields=['annotation']),
            models.Index(fields=['edited_by_user']),
            models.Index(fields=['edited_by_guest_session']),
        ]


class Task(models.Model):
    id = models.UUIDField(primary_key=True)
    workspace = models.ForeignKey(Workspace, on_delete=models.DO_NOTHING, db_column='workspace_id', related_name='+')
    project = models.ForeignKey(Project, on_delete=models.DO_NOTHING, db_column='project_id', null=True, blank=True, related_name='+')
    created_by_workspace_membership = models.ForeignKey(WorkspaceMembership, on_delete=models.DO_NOTHING, db_column='created_by_workspace_membership_id', related_name='+')
    title = models.CharField(max_length=255)
    description = models.TextField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=TaskStatus.choices, default=TaskStatus.TODO)
    priority = models.CharField(max_length=20, choices=PriorityLevel.choices, default=PriorityLevel.MEDIUM)
    start_at = models.DateTimeField(null=True, blank=True)
    due_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    sort_order = models.IntegerField(default=0)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        db_table = 'tasks'
        indexes = [
            models.Index(fields=['workspace']),
            models.Index(fields=['project']),
            models.Index(fields=['created_by_workspace_membership']),
            models.Index(fields=['status']),
            models.Index(fields=['priority']),
            models.Index(fields=['due_at']),
            models.Index(fields=['deleted_at']),
            models.Index(fields=['workspace', 'status']),
            models.Index(fields=['project', 'status']),
        ]

    def clean(self):
        errors = {}
        if self.project_id and self.workspace_id and self.project.workspace_id != self.workspace_id:
            errors['project'] = 'The project must belong to the task workspace.'
        if (
            self.created_by_workspace_membership_id
            and self.workspace_id
            and self.created_by_workspace_membership.workspace_id != self.workspace_id
        ):
            errors['created_by_workspace_membership'] = (
                'The creator membership must belong to the task workspace.'
            )
        if errors:
            raise ValidationError(errors)


class TaskAssignee(models.Model):
    id = models.UUIDField(primary_key=True)
    task = models.ForeignKey(Task, on_delete=models.DO_NOTHING, db_column='task_id', related_name='+')
    workspace_membership = models.ForeignKey(WorkspaceMembership, on_delete=models.DO_NOTHING, db_column='workspace_membership_id', related_name='+')
    assigned_at = models.DateTimeField()

    class Meta:
        db_table = 'task_assignees'
        constraints = [models.UniqueConstraint(fields=['task', 'workspace_membership'], name='task_assignees_task_membership_uniq')]
        indexes = [
            models.Index(fields=['task']),
            models.Index(fields=['workspace_membership']),
        ]

    def clean(self):
        if (
            self.task_id
            and self.workspace_membership_id
            and self.task.workspace_id != self.workspace_membership.workspace_id
        ):
            raise ValidationError(
                {'workspace_membership': 'The assignee must belong to the task workspace.'}
            )


class TaskAttachment(models.Model):
    id = models.UUIDField(primary_key=True)
    task = models.ForeignKey(Task, on_delete=models.DO_NOTHING, db_column='task_id', related_name='+')
    file = models.ForeignKey(File, on_delete=models.DO_NOTHING, db_column='file_id', related_name='+')
    attached_by_workspace_membership = models.ForeignKey(WorkspaceMembership, on_delete=models.DO_NOTHING, db_column='attached_by_workspace_membership_id', related_name='+')
    attached_at = models.DateTimeField()

    class Meta:
        db_table = 'task_attachments'
        constraints = [models.UniqueConstraint(fields=['task', 'file'], name='task_attachments_task_file_uniq')]
        indexes = [
            models.Index(fields=['task']),
            models.Index(fields=['file']),
            models.Index(fields=['attached_by_workspace_membership']),
        ]

    def clean(self):
        if (
            self.task_id
            and self.attached_by_workspace_membership_id
            and self.task.workspace_id != self.attached_by_workspace_membership.workspace_id
        ):
            raise ValidationError(
                {'attached_by_workspace_membership': 'The attaching member must belong to the task workspace.'}
            )


class FileVariant(models.Model):
    id = models.UUIDField(primary_key=True)
    file = models.ForeignKey(File, on_delete=models.DO_NOTHING, db_column='file_id', related_name='+')
    storage_backend = models.ForeignKey(StorageBackend, on_delete=models.DO_NOTHING, db_column='storage_backend_id', related_name='+')
    object_key = models.CharField(max_length=1024)
    original_name = models.CharField(max_length=512)
    mime_type = models.CharField(max_length=255)
    size_bytes = models.BigIntegerField()
    checksum = models.CharField(max_length=512, null=True, blank=True)
    checksum_algorithm = models.CharField(max_length=50, null=True, blank=True)
    metadata = models.JSONField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=FileStatus.choices, default=FileStatus.PENDING)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        db_table = 'file_variants'
        constraints = [models.UniqueConstraint(fields=['storage_backend', 'object_key'], name='file_variants_storage_backend_object_key_uniq')]
        indexes = [
            models.Index(fields=['file']),
            models.Index(fields=['storage_backend']),
            models.Index(fields=['mime_type']),
            models.Index(fields=['status']),
            models.Index(fields=['deleted_at']),
        ]


class FileSecurityScan(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    file = models.OneToOneField(File, on_delete=models.DO_NOTHING, related_name='security_scan')
    engine = models.CharField(max_length=255)
    status = models.CharField(
        max_length=20,
        choices=FileSecurityScanStatus.choices,
        default=FileSecurityScanStatus.PENDING,
    )
    result = models.JSONField(default=dict)
    scanned_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'file_security_scans'
        indexes = [models.Index(fields=['status', 'created_at'])]


class ProjectFolder(models.Model):
    id = models.UUIDField(primary_key=True)
    project = models.ForeignKey(Project, on_delete=models.DO_NOTHING, db_column='project_id', related_name='+')
    parent_folder = models.ForeignKey('self', on_delete=models.DO_NOTHING, db_column='parent_folder_id', null=True, blank=True, related_name='+')
    name = models.CharField(max_length=255)
    created_by_workspace_membership = models.ForeignKey(WorkspaceMembership, on_delete=models.DO_NOTHING, db_column='created_by_workspace_membership_id', related_name='+')
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        db_table = 'project_folders'
        constraints = [
            models.UniqueConstraint(fields=['project', 'parent_folder', 'name'], name='project_folders_project_parent_name_uniq'),
            models.UniqueConstraint(
                fields=['project', 'name'],
                condition=models.Q(parent_folder__isnull=True),
                name='project_folders_root_name_uniq',
            ),
        ]
        indexes = [
            models.Index(fields=['project']),
            models.Index(fields=['parent_folder']),
            models.Index(fields=['created_by_workspace_membership']),
            models.Index(fields=['deleted_at']),
        ]

    def clean(self):
        errors = {}
        if self.parent_folder_id and self.project_id and self.parent_folder.project_id != self.project_id:
            errors['parent_folder'] = 'The parent folder must belong to the same project.'
        if (
            self.created_by_workspace_membership_id
            and self.project_id
            and self.created_by_workspace_membership.workspace_id != self.project.workspace_id
        ):
            errors['created_by_workspace_membership'] = (
                'The creator membership must belong to the project workspace.'
            )
        if errors:
            raise ValidationError(errors)


class ProjectFile(models.Model):
    id = models.UUIDField(primary_key=True)
    project = models.ForeignKey(Project, on_delete=models.DO_NOTHING, db_column='project_id', related_name='+')
    folder = models.ForeignKey(ProjectFolder, on_delete=models.DO_NOTHING, db_column='folder_id', null=True, blank=True, related_name='+')
    file = models.ForeignKey(File, on_delete=models.DO_NOTHING, db_column='file_id', related_name='+')
    added_by_workspace_membership = models.ForeignKey(WorkspaceMembership, on_delete=models.DO_NOTHING, db_column='added_by_workspace_membership_id', related_name='+')
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        db_table = 'project_files'
        constraints = [models.UniqueConstraint(fields=['project', 'file'], name='project_files_project_file_uniq')]
        indexes = [
            models.Index(fields=['project']),
            models.Index(fields=['folder']),
            models.Index(fields=['file']),
            models.Index(fields=['added_by_workspace_membership']),
            models.Index(fields=['deleted_at']),
        ]

    def clean(self):
        errors = {}
        if self.folder_id and self.project_id and self.folder.project_id != self.project_id:
            errors['folder'] = 'The folder must belong to the same project.'
        if (
            self.added_by_workspace_membership_id
            and self.project_id
            and self.added_by_workspace_membership.workspace_id != self.project.workspace_id
        ):
            errors['added_by_workspace_membership'] = (
                'The adding membership must belong to the project workspace.'
            )
        if errors:
            raise ValidationError(errors)


class ClientTeamMember(models.Model):
    id = models.UUIDField(primary_key=True)
    client_team = models.ForeignKey(ClientTeam, on_delete=models.DO_NOTHING, db_column='client_team_id', related_name='+')
    user = models.ForeignKey(User, on_delete=models.DO_NOTHING, db_column='user_id', related_name='+')
    title = models.CharField(max_length=255, null=True, blank=True)
    status = models.CharField(max_length=20, choices=ClientTeamMemberStatus.choices, default=ClientTeamMemberStatus.ACTIVE)
    joined_at = models.DateTimeField()
    removed_at = models.DateTimeField(null=True, blank=True)
    added_by_workspace_membership = models.ForeignKey(WorkspaceMembership, on_delete=models.DO_NOTHING, db_column='added_by_workspace_membership_id', null=True, blank=True, related_name='+')
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        db_table = 'client_team_members'
        constraints = [models.UniqueConstraint(fields=['client_team', 'user'], name='client_team_members_team_user_uniq')]
        indexes = [
            models.Index(fields=['client_team']),
            models.Index(fields=['user']),
            models.Index(fields=['status']),
        ]


class ClientTeamInvite(models.Model):
    id = models.UUIDField(primary_key=True)
    client_team = models.ForeignKey(ClientTeam, on_delete=models.DO_NOTHING, db_column='client_team_id', related_name='+')
    invite_type = models.CharField(max_length=20, choices=ClientTeamInviteType.choices)
    recipient_email = models.CharField(max_length=255, null=True, blank=True)
    label = models.CharField(max_length=255, null=True, blank=True)
    token_hash = models.CharField(max_length=255, unique=True)
    max_uses = models.IntegerField(null=True, blank=True)
    use_count = models.IntegerField(default=0)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)
    created_by_workspace_membership = models.ForeignKey(WorkspaceMembership, on_delete=models.DO_NOTHING, db_column='created_by_workspace_membership_id', null=True, blank=True, related_name='+')
    revoked_by_workspace_membership = models.ForeignKey(WorkspaceMembership, on_delete=models.DO_NOTHING, db_column='revoked_by_workspace_membership_id', null=True, blank=True, related_name='+')
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        db_table = 'client_team_invites'
        indexes = [
            models.Index(fields=['client_team']),
            models.Index(fields=['recipient_email']),
            models.Index(fields=['expires_at']),
            models.Index(fields=['revoked_at']),
        ]


class ClientTeamInviteAcceptance(models.Model):
    id = models.UUIDField(primary_key=True)
    invite = models.ForeignKey(ClientTeamInvite, on_delete=models.DO_NOTHING, db_column='invite_id', related_name='+')
    user = models.ForeignKey(User, on_delete=models.DO_NOTHING, db_column='user_id', related_name='+')
    client_team_member = models.ForeignKey(ClientTeamMember, on_delete=models.DO_NOTHING, db_column='client_team_member_id', related_name='+')
    accepted_at = models.DateTimeField()

    class Meta:
        db_table = 'client_team_invite_acceptances'
        constraints = [models.UniqueConstraint(fields=['invite', 'user'], name='client_team_invite_acceptances_invite_user_uniq')]
        indexes = [
            models.Index(fields=['invite']),
            models.Index(fields=['user']),
            models.Index(fields=['client_team_member']),
        ]


class GuestInvite(models.Model):
    id = models.UUIDField(primary_key=True)
    project = models.ForeignKey(Project, on_delete=models.DO_NOTHING, db_column='project_id', related_name='+')
    label = models.CharField(max_length=255, null=True, blank=True)
    token_hash = models.CharField(max_length=255, unique=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    created_by_workspace_membership = models.ForeignKey(WorkspaceMembership, on_delete=models.DO_NOTHING, db_column='created_by_workspace_membership_id', related_name='+')
    revoked_by_workspace_membership = models.ForeignKey(WorkspaceMembership, on_delete=models.DO_NOTHING, db_column='revoked_by_workspace_membership_id', null=True, blank=True, related_name='+')
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        db_table = 'guest_invites'
        indexes = [
            models.Index(fields=['project']),
            models.Index(fields=['expires_at']),
            models.Index(fields=['revoked_at']),
        ]


class GuestInvitePermission(models.Model):
    # The SQL reference uses PRIMARY KEY (guest_invite_id, permission_key).
    # Django 4.2 requires a single ORM primary key, so id is an ORM surrogate.
    id = models.BigAutoField(primary_key=True)
    guest_invite = models.ForeignKey(GuestInvite, on_delete=models.DO_NOTHING, db_column='guest_invite_id', related_name='+')
    permission_key = models.CharField(max_length=255)
    created_at = models.DateTimeField()

    class Meta:
        db_table = 'guest_invite_permissions'
        constraints = [models.UniqueConstraint(fields=['guest_invite', 'permission_key'], name='guest_invite_permissions_invite_permission_uniq')]


class GuestReviewAccess(models.Model):
    id = models.UUIDField(primary_key=True)
    guest_invite = models.ForeignKey(GuestInvite, on_delete=models.DO_NOTHING, db_column='guest_invite_id', related_name='+')
    guest_session = models.ForeignKey(GuestSession, on_delete=models.DO_NOTHING, db_column='guest_session_id', related_name='+')
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_by_workspace_membership = models.ForeignKey(WorkspaceMembership, on_delete=models.DO_NOTHING, db_column='revoked_by_workspace_membership_id', null=True, blank=True, related_name='+')
    last_accessed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        db_table = 'guest_review_access'
        constraints = [models.UniqueConstraint(fields=['guest_session', 'guest_invite'], name='guest_review_access_session_invite_uniq')]
        indexes = [
            models.Index(fields=['guest_invite']),
            models.Index(fields=['guest_session']),
            models.Index(fields=['revoked_at']),
        ]


class GuestReviewAccessPermission(models.Model):
    # The SQL reference uses PRIMARY KEY (guest_review_access_id, permission_key).
    # Django 4.2 requires a single ORM primary key, so id is an ORM surrogate.
    id = models.BigAutoField(primary_key=True)
    guest_review_access = models.ForeignKey(GuestReviewAccess, on_delete=models.DO_NOTHING, db_column='guest_review_access_id', related_name='+')
    permission_key = models.CharField(max_length=255)
    created_at = models.DateTimeField()

    class Meta:
        db_table = 'guest_review_access_permissions'
        constraints = [models.UniqueConstraint(fields=['guest_review_access', 'permission_key'], name='guest_review_access_permissions_access_permission_uniq')]


class AuditLog(models.Model):
    id = models.UUIDField(primary_key=True)
    workspace = models.ForeignKey(Workspace, on_delete=models.DO_NOTHING, db_column='workspace_id', null=True, blank=True, related_name='+')
    actor_type = models.CharField(max_length=20, choices=AuditActorType.choices)
    actor_user = models.ForeignKey(User, on_delete=models.DO_NOTHING, db_column='actor_user_id', null=True, blank=True, related_name='+')
    actor_guest_session = models.ForeignKey(GuestSession, on_delete=models.DO_NOTHING, db_column='actor_guest_session_id', null=True, blank=True, related_name='+')
    action = models.CharField(max_length=255)
    entity_type = models.CharField(max_length=100, null=True, blank=True)
    entity_id = models.CharField(max_length=255, null=True, blank=True)
    request_method = models.CharField(max_length=10, null=True, blank=True)
    request_path = models.CharField(max_length=1000, null=True, blank=True)
    request_id = models.CharField(max_length=255, null=True, blank=True)
    metadata = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField()

    class Meta:
        db_table = 'audit_logs'
        indexes = [
            models.Index(fields=['workspace', 'created_at']),
            models.Index(fields=['entity_type', 'entity_id']),
            models.Index(fields=['actor_user']),
            models.Index(fields=['actor_guest_session']),
            models.Index(fields=['action']),
            models.Index(fields=['request_id']),
        ]


class Notification(models.Model):
    id = models.UUIDField(primary_key=True)
    recipient_user = models.ForeignKey(User, on_delete=models.DO_NOTHING, db_column='recipient_user_id', related_name='+')
    workspace = models.ForeignKey(Workspace, on_delete=models.DO_NOTHING, db_column='workspace_id', related_name='+')
    actor_user = models.ForeignKey(User, on_delete=models.DO_NOTHING, db_column='actor_user_id', null=True, blank=True, related_name='+')
    kind = models.CharField(max_length=100, choices=NotificationKind.choices)
    entity_type = models.CharField(max_length=100)
    entity_id = models.CharField(max_length=255)
    payload = models.JSONField(default=dict)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField()

    class Meta:
        db_table = 'notifications'
        constraints = [
            models.UniqueConstraint(
                fields=['recipient_user', 'kind', 'entity_type', 'entity_id'],
                name='notifications_recipient_kind_entity_uniq',
            )
        ]
        indexes = [
            models.Index(fields=['recipient_user', 'created_at']),
            models.Index(fields=['recipient_user', 'read_at']),
            models.Index(fields=['workspace', 'created_at']),
        ]


class NotificationPreference(models.Model):
    id = models.UUIDField(primary_key=True)
    user = models.OneToOneField(User, on_delete=models.DO_NOTHING, db_column='user_id', related_name='+')
    email_mentions_enabled = models.BooleanField(default=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        db_table = 'notification_preferences'


class NotificationDelivery(models.Model):
    id = models.UUIDField(primary_key=True)
    notification = models.ForeignKey(Notification, on_delete=models.DO_NOTHING, db_column='notification_id', related_name='+')
    channel = models.CharField(max_length=30, choices=NotificationDeliveryChannel.choices)
    status = models.CharField(max_length=20, choices=NotificationDeliveryStatus.choices, default=NotificationDeliveryStatus.PENDING)
    attempts = models.PositiveIntegerField(default=0)
    last_error = models.TextField(null=True, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        db_table = 'notification_deliveries'
        constraints = [
            models.UniqueConstraint(
                fields=['notification', 'channel'],
                name='notification_deliveries_notification_channel_uniq',
            )
        ]
        indexes = [
            models.Index(fields=['notification']),
            models.Index(fields=['status', 'updated_at']),
        ]


class OutboxEvent(models.Model):
    id = models.UUIDField(primary_key=True)
    topic = models.CharField(max_length=255)
    aggregate_type = models.CharField(max_length=100)
    aggregate_id = models.CharField(max_length=255)
    deduplication_key = models.CharField(max_length=500, unique=True)
    payload = models.JSONField(default=dict)
    status = models.CharField(max_length=20, choices=OutboxEventStatus.choices, default=OutboxEventStatus.PENDING)
    attempts = models.PositiveIntegerField(default=0)
    available_at = models.DateTimeField()
    locked_at = models.DateTimeField(null=True, blank=True)
    published_at = models.DateTimeField(null=True, blank=True)
    last_error = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        db_table = 'outbox_events'
        indexes = [
            models.Index(fields=['status', 'available_at']),
            models.Index(fields=['aggregate_type', 'aggregate_id']),
            models.Index(fields=['created_at']),
        ]


class UserSubscription(models.Model):
    id = models.UUIDField(primary_key=True)
    user = models.ForeignKey(User, on_delete=models.DO_NOTHING, db_column='user_id', related_name='+')
    plan = models.CharField(max_length=20, choices=SubscriptionPlan.choices, default=SubscriptionPlan.FREE)
    status = models.CharField(max_length=20, choices=SubscriptionStatus.choices, default=SubscriptionStatus.ACTIVE)
    started_at = models.DateTimeField()
    current_period_start = models.DateTimeField(null=True, blank=True)
    current_period_end = models.DateTimeField(null=True, blank=True)
    cancel_at_period_end = models.BooleanField(default=False)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    provider = models.CharField(max_length=100, null=True, blank=True)
    provider_subscription_id = models.CharField(max_length=255, null=True, blank=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()
    

    class Meta:
        db_table = 'user_subscriptions'
        constraints = [
            models.UniqueConstraint(
                fields=['user'],
                condition=models.Q(
                    status__in=[SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE]
                ),
                name='user_subscriptions_one_current',
            )
        ]
        indexes = [
            models.Index(fields=['user']),
            models.Index(fields=['provider_subscription_id']),
            models.Index(fields=['user', 'status']),
        ]
