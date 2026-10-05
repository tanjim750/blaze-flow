import uuid

from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models.functions import Lower
from django.utils import timezone

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


class ReviewCommentVisibility(models.TextChoices):
    # Team notes are internal: never returned to guests or client-team members.
    TEAM = 'team'
    CLIENT = 'client'


class ReviewReactionEmoji(models.TextChoices):
    THUMBS_UP = '👍', 'Thumbs up'
    HEART = '❤️', 'Heart'
    LAUGH = '😂', 'Laugh'
    SURPRISED = '😮', 'Surprised'
    SAD = '😢', 'Sad'
    CELEBRATE = '🎉', 'Celebrate'


class TaskStatus(models.TextChoices):
    TODO = 'TODO'
    REVISIONS = 'REVISIONS'
    INTERNAL_QA = 'INTERNAL_QA'
    CLIENT = 'CLIENT'
    APPROVED = 'APPROVED'
    IN_PROGRESS = 'IN_PROGRESS'
    COMPLETED = 'COMPLETED'
    CANCELLED = 'CANCELLED'


class TaskStageKind(models.TextChoices):
    """What a task stage means to the product, independent of its (renamable) name."""
    TODO = 'todo'
    IN_PROGRESS = 'in_progress'
    REVIEW = 'review'
    CLIENT_REVIEW = 'client_review'
    REVISIONS = 'revisions'
    APPROVED = 'approved'
    CUSTOM = 'custom'


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
    TASK_CLIENT_READY = 'TASK_CLIENT_READY'
    # Someone commented on a cut you uploaded or are assigned to (through a task).
    REVIEW_COMMENT_NEW = 'REVIEW_COMMENT_NEW'
    REVIEW_COMMENT_REPLY = 'REVIEW_COMMENT_REPLY'
    # A new version of a file you commented on or are assigned to.
    MEDIA_VERSION_NEW = 'MEDIA_VERSION_NEW'
    TASK_ASSIGNED = 'TASK_ASSIGNED'
    MEDIA_APPROVED = 'MEDIA_APPROVED'
    MEDIA_CHANGES_REQUESTED = 'MEDIA_CHANGES_REQUESTED'
    # A client sent files through an upload link or the client portal.
    CLIENT_UPLOAD_RECEIVED = 'CLIENT_UPLOAD_RECEIVED'
    # A client asked for a new project from the portal (to the studio's owner).
    PROJECT_REQUEST_NEW = 'PROJECT_REQUEST_NEW'
    # The studio accepted or declined a project request (to the client who sent it).
    PROJECT_REQUEST_DECIDED = 'PROJECT_REQUEST_DECIDED'
    # New messages in a project thread you follow (one row per thread, counted up).
    PROJECT_MESSAGE_NEW = 'PROJECT_MESSAGE_NEW'
    # Someone @mentioned you in a project message.
    PROJECT_MESSAGE_MENTION = 'PROJECT_MESSAGE_MENTION'


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
    task_workflow_settings = models.JSONField(default=dict, blank=True)
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
    # Client portal branding: an accent colour (#RRGGBB), a logo image and a short welcome
    # line. Shown to clients on the portal and on public upload pages; the team UI keeps
    # Blaze Flow's own look.
    brand_color = models.CharField(max_length=7, null=True, blank=True)
    logo_object_key = models.CharField(max_length=500, null=True, blank=True)
    logo_mime_type = models.CharField(max_length=50, null=True, blank=True)
    logo_updated_at = models.DateTimeField(null=True, blank=True)
    portal_welcome = models.CharField(max_length=280, null=True, blank=True)
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
    client_team = models.ForeignKey(ClientTeam, on_delete=models.SET_NULL, db_column='client_team_id', null=True, blank=True, related_name='projects')
    name = models.CharField(max_length=200)
    description = models.TextField(null=True, blank=True)
    status = models.CharField(max_length=30, choices=ProjectStatus.choices, default=ProjectStatus.DRAFT)
    priority = models.CharField(max_length=20, choices=PriorityLevel.choices, default=PriorityLevel.MEDIUM)
    start_at = models.DateTimeField(null=True, blank=True)
    due_at = models.DateTimeField(null=True, blank=True)
    deletion_scheduled_at = models.DateTimeField(null=True, blank=True)
    next_media_version_number = models.IntegerField(default=1)
    # Structured deliverable specs for the Brief tab: aspect_ratio, target_length_seconds,
    # platform, resolution and notes. Shape is enforced by DeliverableSpecsSerializer.
    deliverable_specs = models.JSONField(default=dict, blank=True)
    # Billing (demo). What the client pays for the project as a whole; per-task prices are
    # added on top (see services/billing.py). Never serialised by ProjectSerializer: prices
    # only leave the API through the billing routes, which check billing.view.
    client_fee = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    client_fee_currency = models.CharField(max_length=3, null=True, blank=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        db_table = 'projects'
        indexes = [
            models.Index(fields=['workspace']),
            models.Index(fields=['client_team']),
            models.Index(fields=['created_by_user']),
            models.Index(fields=['status']),
        ]

    def clean(self):
        if self.client_team_id and self.workspace_id and self.client_team.workspace_id != self.workspace_id:
            raise ValidationError({'client_team': 'The client team must belong to the project workspace.'})


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
    # Exactly one of these says who moved the cut: a signed-in user, or (for a client decision
    # made from a review link) the guest session that made it.
    changed_by_user = models.ForeignKey(User, on_delete=models.DO_NOTHING, db_column='changed_by_user_id', null=True, blank=True, related_name='+')
    changed_by_guest_session = models.ForeignKey(GuestSession, on_delete=models.DO_NOTHING, db_column='changed_by_guest_session_id', null=True, blank=True, related_name='+')
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
    visibility = models.CharField(max_length=10, choices=ReviewCommentVisibility.choices, default=ReviewCommentVisibility.CLIENT)
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
            ),
            # A timed window never runs backwards and never has an end without a start.
            # The serializers already refuse both; this keeps imports and scripts honest too,
            # since the review player trusts [start, end] when deciding what to draw.
            models.CheckConstraint(
                check=models.Q(end_time_ms__isnull=True)
                | models.Q(start_time_ms__isnull=False, end_time_ms__gte=models.F('start_time_ms')),
                name='review_comments_end_after_start',
            ),
        ]
        indexes = [
            models.Index(fields=['media_version']),
            models.Index(fields=['parent_comment']),
            models.Index(fields=['author_user']),
            models.Index(fields=['author_guest_session']),
            models.Index(fields=['resolved']),
            models.Index(fields=['deleted_at']),
            models.Index(fields=['media_version', 'visibility'], name='review_comments_visibility_idx'),
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
            ),
            # A timed window never runs backwards and never has an end without a start.
            # The serializers already refuse both; this keeps imports and scripts honest too,
            # since the review player trusts [start, end] when deciding what to draw.
            models.CheckConstraint(
                check=models.Q(end_time_ms__isnull=True)
                | models.Q(start_time_ms__isnull=False, end_time_ms__gte=models.F('start_time_ms')),
                name='annotations_end_after_start',
            ),
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


class TaskStage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, db_column='workspace_id', related_name='task_stages')
    name = models.CharField(max_length=100)
    color = models.CharField(max_length=20, default='#89909d')
    sort_order = models.IntegerField(default=0)
    wip_limit = models.PositiveIntegerField(null=True, blank=True)
    is_done = models.BooleanField(default=False)
    automation_enabled = models.BooleanField(default=True)
    # Built-in meaning of the stage. Renaming a stage keeps its kind, so behaviour that used
    # to match on the name (the client-ready notification) keys off this instead.
    kind = models.CharField(max_length=20, choices=TaskStageKind.choices, default=TaskStageKind.CUSTOM)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'task_stages'
        ordering = ('sort_order', 'created_at')
        constraints = [models.UniqueConstraint(fields=['workspace', 'name'], name='task_stages_workspace_name_uniq')]
        indexes = [models.Index(fields=['workspace', 'sort_order'])]


class Task(models.Model):
    id = models.UUIDField(primary_key=True)
    workspace = models.ForeignKey(Workspace, on_delete=models.DO_NOTHING, db_column='workspace_id', related_name='+')
    project = models.ForeignKey(Project, on_delete=models.DO_NOTHING, db_column='project_id', null=True, blank=True, related_name='+')
    client_team = models.ForeignKey(ClientTeam, on_delete=models.SET_NULL, db_column='client_team_id', null=True, blank=True, related_name='+')
    task_stage = models.ForeignKey(TaskStage, on_delete=models.PROTECT, db_column='task_stage_id', related_name='tasks')
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
    # Billing (demo). Optional client price for this deliverable, on top of the project fee.
    # Kept out of TaskSerializer for the same reason as Project.client_fee.
    client_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    client_price_currency = models.CharField(max_length=3, null=True, blank=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        db_table = 'tasks'
        indexes = [
            models.Index(fields=['workspace']),
            models.Index(fields=['project']),
            models.Index(fields=['client_team']),
            models.Index(fields=['task_stage']),
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
        if self.task_stage_id and self.workspace_id and self.task_stage.workspace_id != self.workspace_id:
            errors['task_stage'] = 'The task stage must belong to the task workspace.'
        if self.project_id and self.workspace_id and self.project.workspace_id != self.workspace_id:
            errors['project'] = 'The project must belong to the task workspace.'
        if self.client_team_id and self.workspace_id and self.client_team.workspace_id != self.workspace_id:
            errors['client_team'] = 'The client must belong to the task workspace.'
        if self.project_id and self.client_team_id and self.project.client_team_id != self.client_team_id:
            errors['client_team'] = 'The client must match the selected project.'
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
    workspace = models.ForeignKey(Workspace, on_delete=models.DO_NOTHING, db_column='workspace_id', related_name='+')
    client_team = models.ForeignKey(ClientTeam, on_delete=models.SET_NULL, db_column='client_team_id', null=True, blank=True, related_name='+')
    project = models.ForeignKey(Project, on_delete=models.DO_NOTHING, db_column='project_id', null=True, blank=True, related_name='+')
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
            models.Index(fields=['workspace']),
            models.Index(fields=['client_team']),
            models.Index(fields=['project']),
            models.Index(fields=['parent_folder']),
            models.Index(fields=['created_by_workspace_membership']),
            models.Index(fields=['deleted_at']),
        ]

    def clean(self):
        errors = {}
        if self.project_id and self.workspace_id and self.project.workspace_id != self.workspace_id:
            errors['project'] = 'The project must belong to the folder workspace.'
        if self.client_team_id and self.workspace_id and self.client_team.workspace_id != self.workspace_id:
            errors['client_team'] = 'The client must belong to the folder workspace.'
        if self.project_id and self.client_team_id and self.project.client_team_id != self.client_team_id:
            errors['client_team'] = 'The client must match the selected project.'
        if self.parent_folder_id and (
            self.parent_folder.workspace_id != self.workspace_id
            or self.parent_folder.project_id != self.project_id
            or self.parent_folder.client_team_id != self.client_team_id
        ):
            errors['parent_folder'] = 'The parent folder must have the same workspace and relationships.'
        if (
            self.created_by_workspace_membership_id
            and self.workspace_id
            and self.created_by_workspace_membership.workspace_id != self.workspace_id
        ):
            errors['created_by_workspace_membership'] = (
                'The creator membership must belong to the project workspace.'
            )
        if errors:
            raise ValidationError(errors)


class MediaAsset(models.Model):
    """One creative asset, which its versions hang off.

    Deliberately thin. The spec this was built to puts the client, project and folder on the
    asset as well as the version, but every filter, board and tree in the app already reads
    those from `ProjectFile`, and a second copy is a second thing to keep in step — move an
    asset and you would have to update both, and a divergence would be silent. So the
    relationships stay on the versions, and `assign_media_asset` moves them together:
    versions of one asset are never in two different folders.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, db_column='workspace_id', related_name='media_assets')
    name = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'media_assets'
        ordering = ('-updated_at',)
        indexes = [models.Index(fields=['workspace', 'updated_at'])]

    def __str__(self):
        return self.name


class ProjectFile(models.Model):
    id = models.UUIDField(primary_key=True)
    workspace = models.ForeignKey(Workspace, on_delete=models.DO_NOTHING, db_column='workspace_id', related_name='+')
    client_team = models.ForeignKey(ClientTeam, on_delete=models.SET_NULL, db_column='client_team_id', null=True, blank=True, related_name='+')
    project = models.ForeignKey(Project, on_delete=models.DO_NOTHING, db_column='project_id', null=True, blank=True, related_name='+')
    folder = models.ForeignKey(ProjectFolder, on_delete=models.DO_NOTHING, db_column='folder_id', null=True, blank=True, related_name='+')
    file = models.ForeignKey(File, on_delete=models.DO_NOTHING, db_column='file_id', related_name='+')
    task_stage = models.ForeignKey('TaskStage', on_delete=models.PROTECT, db_column='task_stage_id', null=True, blank=True, related_name='+')
    # A row is one version of an asset. Null only for rows that predate versioning and
    # could not be grouped; those behave as a single-version asset of their own.
    media_asset = models.ForeignKey(MediaAsset, on_delete=models.CASCADE, db_column='media_asset_id', null=True, blank=True, related_name='versions')
    version_number = models.PositiveIntegerField(default=1)
    added_by_workspace_membership = models.ForeignKey(WorkspaceMembership, on_delete=models.DO_NOTHING, db_column='added_by_workspace_membership_id', related_name='+')
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        db_table = 'project_files'
        constraints = [
            models.UniqueConstraint(fields=['workspace', 'file'], name='project_files_workspace_file_uniq'),
            # Version numbers are dense and unique within an asset: V2 is never created twice.
            models.UniqueConstraint(fields=['media_asset', 'version_number'], name='project_files_asset_version_uniq'),
        ]
        indexes = [
            models.Index(fields=['workspace']),
            models.Index(fields=['media_asset']),
            models.Index(fields=['client_team']),
            models.Index(fields=['project']),
            models.Index(fields=['folder']),
            models.Index(fields=['file']),
            models.Index(fields=['task_stage']),
            models.Index(fields=['added_by_workspace_membership']),
            models.Index(fields=['deleted_at']),
        ]

    def clean(self):
        errors = {}
        if self.project_id and self.workspace_id and self.project.workspace_id != self.workspace_id:
            errors['project'] = 'The project must belong to the file workspace.'
        if self.client_team_id and self.workspace_id and self.client_team.workspace_id != self.workspace_id:
            errors['client_team'] = 'The client must belong to the file workspace.'
        if self.project_id and self.client_team_id and self.project.client_team_id != self.client_team_id:
            errors['client_team'] = 'The client must match the selected project.'
        if self.folder_id and (
            self.folder.workspace_id != self.workspace_id
            or self.folder.project_id != self.project_id
            or self.folder.client_team_id != self.client_team_id
        ):
            errors['folder'] = 'The folder must have the same workspace and relationships.'
        if self.file_id and self.workspace_id and self.file.workspace_id != self.workspace_id:
            errors['file'] = 'The stored file must belong to the same workspace.'
        if self.task_stage_id and self.workspace_id and self.task_stage.workspace_id != self.workspace_id:
            errors['task_stage'] = 'The stage must belong to the same workspace.'
        if (
            self.added_by_workspace_membership_id
            and self.workspace_id
            and self.added_by_workspace_membership.workspace_id != self.workspace_id
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


class ReviewDecisionKind(models.TextChoices):
    APPROVED = 'approved', 'Approved'
    CHANGES_REQUESTED = 'changes_requested', 'Changes requested'


class ReviewDecision(models.Model):
    """A client's decision on one exact cut: proof of who approved what, and when.

    Pinned to a media version, never to a file or asset, so a newer version uploaded later
    starts with no decision. Made either by a guest through a review link (guest columns
    set) or by a client-team member signed in to the workspace (``decided_by_user`` set).
    The reviewer's name and email are copied in, so the record still reads correctly after
    the guest session or link is gone.
    """
    id = models.UUIDField(primary_key=True)
    project = models.ForeignKey(Project, on_delete=models.DO_NOTHING, db_column='project_id', related_name='+')
    media_version = models.ForeignKey(MediaVersion, on_delete=models.DO_NOTHING, db_column='media_version_id', related_name='+')
    decision = models.CharField(max_length=30, choices=ReviewDecisionKind.choices)
    guest_session = models.ForeignKey(GuestSession, on_delete=models.DO_NOTHING, db_column='guest_session_id', null=True, blank=True, related_name='+')
    guest_review_access = models.ForeignKey(GuestReviewAccess, on_delete=models.DO_NOTHING, db_column='guest_review_access_id', null=True, blank=True, related_name='+')
    guest_invite = models.ForeignKey(GuestInvite, on_delete=models.DO_NOTHING, db_column='guest_invite_id', null=True, blank=True, related_name='+')
    decided_by_user = models.ForeignKey(User, on_delete=models.DO_NOTHING, db_column='decided_by_user_id', null=True, blank=True, related_name='+')
    reviewer_name = models.CharField(max_length=150)
    reviewer_email = models.CharField(max_length=255)
    # Unresolved client-visible notes on the cut at the moment of the decision (not counting
    # the note a change request itself adds).
    open_notes_count = models.IntegerField(default=0)
    message = models.TextField(null=True, blank=True)
    review_comment = models.ForeignKey(ReviewComment, on_delete=models.DO_NOTHING, db_column='review_comment_id', null=True, blank=True, related_name='+')
    stage_entry = models.ForeignKey(MediaVersionStageEntry, on_delete=models.DO_NOTHING, db_column='stage_entry_id', null=True, blank=True, related_name='+')
    created_at = models.DateTimeField()

    class Meta:
        db_table = 'review_decisions'
        constraints = [
            models.CheckConstraint(
                check=(
                    models.Q(guest_session__isnull=False, decided_by_user__isnull=True)
                    | models.Q(guest_session__isnull=True, decided_by_user__isnull=False)
                ),
                name='review_decisions_exactly_one_reviewer',
            ),
        ]
        indexes = [
            models.Index(fields=['media_version', 'created_at'], name='review_decisions_media_idx'),
            models.Index(fields=['project', 'created_at'], name='review_decisions_project_idx'),
            models.Index(fields=['guest_invite'], name='review_decisions_invite_idx'),
        ]


class AuditLog(models.Model):
    id = models.UUIDField(primary_key=True)
    workspace = models.ForeignKey(Workspace, on_delete=models.DO_NOTHING, db_column='workspace_id', null=True, blank=True, related_name='+')
    actor_type = models.CharField(max_length=20, choices=AuditActorType.choices)
    actor_user = models.ForeignKey(User, on_delete=models.DO_NOTHING, db_column='actor_user_id', null=True, blank=True, related_name='+')
    actor_guest_session = models.ForeignKey(GuestSession, on_delete=models.DO_NOTHING, db_column='actor_guest_session_id', null=True, blank=True, related_name='+')
    # The project an event belongs to, resolved when it is written, so the activity feed can
    # filter and permission-scope by project without joining every entity table.
    project = models.ForeignKey('Project', on_delete=models.DO_NOTHING, db_column='project_id', null=True, blank=True, related_name='+')
    # True for events about a team-only review note: never shown to client-team members.
    team_only = models.BooleanField(default=False)
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
            models.Index(fields=['project', 'created_at']),
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


class NotificationSetting(models.Model):
    """In-app on/off for one notification kind, for one person in one workspace.

    Keyed on (user, workspace) rather than the membership row: a client-team member reaches a
    workspace through the team's shared membership, so a membership key would make one
    client's switch turn the kind off for their whole team. No row means the kind is on.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, db_column='user_id', related_name='+')
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, db_column='workspace_id', related_name='+')
    kind = models.CharField(max_length=100, choices=NotificationKind.choices)
    in_app_enabled = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'notification_settings'
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'workspace', 'kind'],
                name='notification_settings_user_workspace_kind_uniq',
            )
        ]


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


# --- Billing (demo) -----------------------------------------------------------------------
# Agency money tracking: what clients owe (invoices + payments) and what editors are owed
# (task pay + payouts). Every amount carries its own ISO 4217 currency code so a later
# multi-currency or gateway integration does not need a data migration. See
# services/billing.py; the only way anything becomes "paid" is billing.record_payment().

DEFAULT_BILLING_CURRENCY = 'GBP'


class InvoiceStatus(models.TextChoices):
    # "Overdue" is not stored: it is a sent invoice past its due date with money outstanding.
    DRAFT = 'draft'
    SENT = 'sent'
    PAID = 'paid'


class InvoiceLineKind(models.TextChoices):
    PROJECT_FEE = 'project_fee'
    TASK = 'task'


class PaymentDirection(models.TextChoices):
    INCOMING = 'incoming'  # a client paying an invoice
    OUTGOING = 'outgoing'  # the studio paying an editor


class PaymentMethod(models.TextChoices):
    BANK_TRANSFER = 'bank_transfer'
    CARD = 'card'
    CASH = 'cash'
    OTHER = 'other'


class PaymentProvider(models.TextChoices):
    # Only the manual (demo) provider exists. A gateway such as Stripe would add its own
    # value here and call billing.record_payment() from its webhook.
    MANUAL = 'manual'


class EditorPayStatus(models.TextChoices):
    PENDING = 'pending'  # task not approved yet; the amount can still change
    EARNED = 'earned'    # task reached the Approved stage kind; the amount is frozen


class WorkspaceBillingSettings(models.Model):
    workspace = models.OneToOneField(Workspace, on_delete=models.CASCADE, primary_key=True, db_column='workspace_id', related_name='+')
    currency = models.CharField(max_length=3, default=DEFAULT_BILLING_CURRENCY)
    invoice_prefix = models.CharField(max_length=20, default='INV')
    next_invoice_number = models.PositiveIntegerField(default=1)
    payment_terms_days = models.PositiveIntegerField(default=14)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'workspace_billing_settings'


class MemberPayRate(models.Model):
    """Optional default pay per task for a team member; pre-fills their pay when assigned."""
    workspace_membership = models.OneToOneField(WorkspaceMembership, on_delete=models.CASCADE, primary_key=True, db_column='workspace_membership_id', related_name='+')
    default_task_rate = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    currency = models.CharField(max_length=3, default=DEFAULT_BILLING_CURRENCY)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'member_pay_rates'


class EditorPay(models.Model):
    """What one assignee is paid for one task. Frozen (status earned) once the task is approved."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, db_column='workspace_id', related_name='+')
    task = models.ForeignKey(Task, on_delete=models.CASCADE, db_column='task_id', related_name='+')
    workspace_membership = models.ForeignKey(WorkspaceMembership, on_delete=models.PROTECT, db_column='workspace_membership_id', related_name='+')
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=3, default=DEFAULT_BILLING_CURRENCY)
    status = models.CharField(max_length=10, choices=EditorPayStatus.choices, default=EditorPayStatus.PENDING)
    earned_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'editor_pay'
        constraints = [
            models.UniqueConstraint(fields=['task', 'workspace_membership'], name='editor_pay_task_membership_uniq'),
            models.CheckConstraint(check=models.Q(amount__gte=0), name='editor_pay_amount_non_negative'),
        ]
        indexes = [models.Index(fields=['workspace', 'workspace_membership', 'status'])]


class Invoice(models.Model):
    """A bill to a client. Called an invoice in the UI."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, db_column='workspace_id', related_name='+')
    client_team = models.ForeignKey(ClientTeam, on_delete=models.PROTECT, db_column='client_team_id', related_name='+')
    project = models.ForeignKey(Project, on_delete=models.SET_NULL, db_column='project_id', null=True, blank=True, related_name='+')
    number = models.CharField(max_length=40)
    status = models.CharField(max_length=10, choices=InvoiceStatus.choices, default=InvoiceStatus.DRAFT)
    currency = models.CharField(max_length=3, default=DEFAULT_BILLING_CURRENCY)
    issue_date = models.DateField(null=True, blank=True)
    due_date = models.DateField(null=True, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True, default='')
    created_by_user = models.ForeignKey(User, on_delete=models.SET_NULL, db_column='created_by_user_id', null=True, blank=True, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'invoices'
        constraints = [models.UniqueConstraint(fields=['workspace', 'number'], name='invoices_workspace_number_uniq')]
        indexes = [
            models.Index(fields=['workspace', 'status']),
            models.Index(fields=['client_team']),
        ]


class InvoiceLine(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, db_column='invoice_id', related_name='lines')
    kind = models.CharField(max_length=20, choices=InvoiceLineKind.choices)
    task = models.ForeignKey(Task, on_delete=models.SET_NULL, db_column='task_id', null=True, blank=True, related_name='+')
    description = models.CharField(max_length=255)
    # A snapshot: changing the task's price later does not rewrite an issued invoice.
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    sort_order = models.IntegerField(default=0)

    class Meta:
        db_table = 'invoice_lines'
        ordering = ('sort_order',)


class Payment(models.Model):
    """One money movement: a client paying an invoice (incoming) or a payout to an editor (outgoing).

    Rows are only ever written by services.billing.record_payment().
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, db_column='workspace_id', related_name='+')
    direction = models.CharField(max_length=10, choices=PaymentDirection.choices)
    invoice = models.ForeignKey(Invoice, on_delete=models.PROTECT, db_column='invoice_id', null=True, blank=True, related_name='payments')
    payee_membership = models.ForeignKey(WorkspaceMembership, on_delete=models.PROTECT, db_column='payee_membership_id', null=True, blank=True, related_name='+')
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=3)
    paid_on = models.DateField()
    method = models.CharField(max_length=20, choices=PaymentMethod.choices, default=PaymentMethod.BANK_TRANSFER)
    note = models.TextField(blank=True, default='')
    provider = models.CharField(max_length=30, choices=PaymentProvider.choices, default=PaymentProvider.MANUAL)
    # The gateway's own id (e.g. a Stripe PaymentIntent). Unique per provider, so a webhook
    # delivered twice records the payment once.
    provider_reference = models.CharField(max_length=255, null=True, blank=True)
    recorded_by_user = models.ForeignKey(User, on_delete=models.SET_NULL, db_column='recorded_by_user_id', null=True, blank=True, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'payments'
        constraints = [
            models.CheckConstraint(check=models.Q(amount__gt=0), name='payments_amount_positive'),
            models.CheckConstraint(
                check=(
                    models.Q(direction='incoming', invoice__isnull=False, payee_membership__isnull=True)
                    | models.Q(direction='outgoing', invoice__isnull=True, payee_membership__isnull=False)
                ),
                name='payments_direction_matches_target',
            ),
            models.UniqueConstraint(
                fields=['provider', 'provider_reference'],
                condition=models.Q(provider_reference__isnull=False),
                name='payments_provider_reference_uniq',
            ),
        ]
        indexes = [
            models.Index(fields=['workspace', 'direction']),
            models.Index(fields=['payee_membership']),
        ]


class UploadLink(models.Model):
    """A public "send us your files" link for one project. No account is needed to use it.

    ``token`` is the bearer secret in the URL. It is kept (not only hashed) so the team can
    copy the link again later, the way a share link in a file app works; revoking or letting
    it expire is how it stops working.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, db_column='workspace_id', related_name='+')
    project = models.ForeignKey(Project, on_delete=models.CASCADE, db_column='project_id', related_name='upload_links')
    label = models.CharField(max_length=150)
    instructions = models.TextField(blank=True, default='')
    token = models.CharField(max_length=64, unique=True)
    # A soft deadline shown to the client ("Please send by …"); uploads still work after it.
    due_at = models.DateTimeField(null=True, blank=True)
    # A hard stop: after this the link refuses uploads.
    expires_at = models.DateTimeField(null=True, blank=True)
    # Per-file cap; never above the workspace-wide MAX_PROJECT_FILE_BYTES.
    max_file_bytes = models.BigIntegerField(null=True, blank=True)
    # Subset of video, image, audio, document. Empty means all of them.
    allowed_kinds = models.JSONField(default=list, blank=True)
    created_by_workspace_membership = models.ForeignKey(WorkspaceMembership, on_delete=models.DO_NOTHING, db_column='created_by_workspace_membership_id', related_name='+')
    created_by_user = models.ForeignKey(User, on_delete=models.SET_NULL, db_column='created_by_user_id', null=True, blank=True, related_name='+')
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_by_user = models.ForeignKey(User, on_delete=models.SET_NULL, db_column='revoked_by_user_id', null=True, blank=True, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'upload_links'
        indexes = [models.Index(fields=['project', 'created_at'])]
        constraints = [
            models.CheckConstraint(
                check=models.Q(max_file_bytes__isnull=True) | models.Q(max_file_bytes__gt=0),
                name='upload_links_max_file_bytes_positive',
            ),
        ]


class ClientUpload(models.Model):
    """Who sent a file from outside the team: through an upload link, or the client portal."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, db_column='workspace_id', related_name='+')
    project = models.ForeignKey(Project, on_delete=models.CASCADE, db_column='project_id', related_name='client_uploads')
    project_file = models.OneToOneField(ProjectFile, on_delete=models.CASCADE, db_column='project_file_id', related_name='client_upload')
    upload_link = models.ForeignKey(UploadLink, on_delete=models.SET_NULL, db_column='upload_link_id', null=True, blank=True, related_name='uploads')
    # Set when a signed-in client sent it from the portal; null for an anonymous link upload.
    uploaded_by_user = models.ForeignKey(User, on_delete=models.SET_NULL, db_column='uploaded_by_user_id', null=True, blank=True, related_name='+')
    uploader_name = models.CharField(max_length=120)
    uploader_email = models.EmailField(max_length=255)
    # Files dropped together share a batch, so the team gets one notification per drop.
    batch_id = models.UUIDField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'client_uploads'
        indexes = [
            models.Index(fields=['project', 'created_at']),
            models.Index(fields=['upload_link', 'created_at']),
            models.Index(fields=['batch_id']),
        ]


class ProjectRequestStatus(models.TextChoices):
    PENDING = 'pending', 'Waiting for the studio'
    ACCEPTED = 'accepted', 'Accepted'
    DECLINED = 'declined', 'Declined'
    WITHDRAWN = 'withdrawn', 'Withdrawn'


class ProjectRequest(models.Model):
    """A client asking the studio for new work, from the client portal.

    The studio accepts it (which opens a draft project for that client, carrying the brief)
    or declines it with a note. Nothing about money is promised: ``budget_range`` is a hint.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, db_column='workspace_id', related_name='+')
    client_team = models.ForeignKey(ClientTeam, on_delete=models.CASCADE, db_column='client_team_id', related_name='project_requests')
    requested_by_user = models.ForeignKey(User, on_delete=models.SET_NULL, db_column='requested_by_user_id', null=True, blank=True, related_name='+')
    requester_name = models.CharField(max_length=150)
    title = models.CharField(max_length=200)
    # [{"kind": "social_cutdown", "quantity": 3}, ...] from services.project_requests.DELIVERABLE_KINDS.
    deliverables = models.JSONField(default=list, blank=True)
    platform = models.CharField(max_length=40, null=True, blank=True)
    aspect_ratio = models.CharField(max_length=10, null=True, blank=True)
    target_length_seconds = models.PositiveIntegerField(null=True, blank=True)
    brief = models.TextField()
    references = models.TextField(blank=True, default='')
    wanted_by = models.DateField(null=True, blank=True)
    budget_range = models.CharField(max_length=20, blank=True, default='')
    status = models.CharField(max_length=20, choices=ProjectRequestStatus.choices, default=ProjectRequestStatus.PENDING)
    decision_note = models.TextField(blank=True, default='')
    decided_by_user = models.ForeignKey(User, on_delete=models.SET_NULL, db_column='decided_by_user_id', null=True, blank=True, related_name='+')
    decided_at = models.DateTimeField(null=True, blank=True)
    project = models.ForeignKey(Project, on_delete=models.SET_NULL, db_column='project_id', null=True, blank=True, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'project_requests'
        indexes = [
            models.Index(fields=['workspace', 'status', 'created_at']),
            models.Index(fields=['client_team', 'created_at']),
        ]


class MessageChannel(models.TextChoices):
    # Seen by the team and by the project's client contacts.
    CLIENT = 'client', 'With client'
    # Team only: never returned to anyone who is in the workspace only through a client team.
    TEAM = 'team', 'Team only'


class ChatChannel(models.Model):
    """A Slack-style conversation slot: one General per client, plus one per project.

    ``project`` null means the client's General channel. ``client_team`` null means a
    Studio project with no client (team-only). The With-client / Team-only sides still live
    on each message as ``MessageChannel``.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, db_column='workspace_id', related_name='+')
    client_team = models.ForeignKey(ClientTeam, on_delete=models.CASCADE, db_column='client_team_id', null=True, blank=True, related_name='chat_channels')
    project = models.ForeignKey(Project, on_delete=models.CASCADE, db_column='project_id', null=True, blank=True, related_name='chat_channels')
    last_message_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'chat_channels'
        constraints = [
            models.UniqueConstraint(
                fields=['workspace', 'client_team'],
                condition=models.Q(project__isnull=True, client_team__isnull=False),
                name='chat_channel_general_uniq',
            ),
            models.UniqueConstraint(
                fields=['workspace', 'project'],
                condition=models.Q(project__isnull=False),
                name='chat_channel_project_uniq',
            ),
        ]
        indexes = [
            models.Index(fields=['workspace', 'last_message_at']),
            models.Index(fields=['client_team', 'last_message_at']),
        ]


class ProjectMessage(models.Model):
    """One message in a chat channel, on either the client or team side."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, db_column='workspace_id', related_name='+')
    chat_channel = models.ForeignKey(ChatChannel, on_delete=models.CASCADE, db_column='chat_channel_id', related_name='messages', null=True, blank=True)
    # Kept for the project-scoped aliases and for linking attachments to a project.
    project = models.ForeignKey(Project, on_delete=models.CASCADE, db_column='project_id', null=True, blank=True, related_name='messages')
    channel = models.CharField(max_length=10, choices=MessageChannel.choices)
    author_user = models.ForeignKey(User, on_delete=models.SET_NULL, db_column='author_user_id', null=True, blank=True, related_name='+')
    # Copied in so the thread still reads right after the account is gone.
    author_name = models.CharField(max_length=150)
    author_is_client = models.BooleanField(default=False)
    body = models.TextField(blank=True, default='')
    # A reply quotes one earlier message of the same side.
    reply_to = models.ForeignKey('self', on_delete=models.SET_NULL, db_column='reply_to_id', null=True, blank=True, related_name='+')
    # User ids (strings) mentioned in the body; mirrored into ProjectMessageMention for counts.
    mentions = models.JSONField(default=list, blank=True)
    edited_at = models.DateTimeField(null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'project_messages'
        indexes = [
            models.Index(fields=['chat_channel', 'channel', 'created_at']),
            models.Index(fields=['project', 'channel', 'created_at']),
        ]


class ProjectMessageAttachment(models.Model):
    """A file uploaded into a message, or a link to an existing project file or cut.

    Uploads are stored as their own ``File`` (scanned like review attachments) and never
    appear in the project's file tree, so a team-only attachment cannot surface in Files.
    An upload exists before its message (``message`` null) until the message claims it.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, db_column='workspace_id', related_name='+')
    chat_channel = models.ForeignKey(ChatChannel, on_delete=models.CASCADE, db_column='chat_channel_id', null=True, blank=True, related_name='+')
    project = models.ForeignKey(Project, on_delete=models.CASCADE, db_column='project_id', null=True, blank=True, related_name='+')
    message = models.ForeignKey(ProjectMessage, on_delete=models.CASCADE, db_column='message_id', null=True, blank=True, related_name='attachments')
    kind = models.CharField(max_length=10, choices=(('upload', 'Upload'), ('file', 'Project file'), ('cut', 'Cut')))
    file = models.ForeignKey(File, on_delete=models.SET_NULL, db_column='file_id', null=True, blank=True, related_name='+')
    project_file = models.ForeignKey(ProjectFile, on_delete=models.SET_NULL, db_column='project_file_id', null=True, blank=True, related_name='+')
    media_version = models.ForeignKey(MediaVersion, on_delete=models.SET_NULL, db_column='media_version_id', null=True, blank=True, related_name='+')
    uploaded_by_user = models.ForeignKey(User, on_delete=models.SET_NULL, db_column='uploaded_by_user_id', null=True, blank=True, related_name='+')
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'project_message_attachments'
        indexes = [models.Index(fields=['message']), models.Index(fields=['chat_channel', 'created_at']), models.Index(fields=['project', 'created_at'])]


class ProjectMessageMention(models.Model):
    """One @mention of one person in one message. Used for per-channel mention badges."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    message = models.ForeignKey(ProjectMessage, on_delete=models.CASCADE, db_column='message_id', related_name='mention_rows')
    user = models.ForeignKey(User, on_delete=models.CASCADE, db_column='user_id', related_name='+')
    chat_channel = models.ForeignKey(ChatChannel, on_delete=models.CASCADE, db_column='chat_channel_id', related_name='+')
    side = models.CharField(max_length=10, choices=MessageChannel.choices)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'project_message_mentions'
        constraints = [models.UniqueConstraint(fields=['message', 'user'], name='project_message_mentions_uniq')]
        indexes = [models.Index(fields=['user', 'chat_channel', 'side', 'created_at'])]


class ProjectMessageRead(models.Model):
    """How far one person has read one side of one chat channel."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    user = models.ForeignKey(User, on_delete=models.CASCADE, db_column='user_id', related_name='+')
    chat_channel = models.ForeignKey(ChatChannel, on_delete=models.CASCADE, db_column='chat_channel_id', null=True, blank=True, related_name='+')
    # Legacy columns kept through the data migration, then dropped.
    project = models.ForeignKey(Project, on_delete=models.CASCADE, db_column='project_id', null=True, blank=True, related_name='+')
    channel = models.CharField(max_length=10, choices=MessageChannel.choices)
    last_read_at = models.DateTimeField()

    class Meta:
        db_table = 'project_message_reads'
        constraints = [
            models.UniqueConstraint(fields=['user', 'chat_channel', 'channel'], name='project_message_reads_channel_uniq'),
        ]
