import uuid
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from app.models import (
    ProjectAccessMode,
    Role,
    RolePermission,
    Workspace,
    WorkspaceMembership,
    WorkspaceMembershipStatus,
    WorkspacePrincipalType,
    WorkspaceProfile,
    WorkspaceStatus,
    WorkflowStage,
)
from app.permissions import MEMBER_PERMISSION_KEYS, OWNER_PERMISSION_KEYS


class WorkspaceSlugConflict(Exception):
    """Raised when concurrent workspace creation claims the requested slug."""


class WorkspaceLifecycleError(Exception):
    pass


@transaction.atomic
def create_workspace(*, owner, name, slug, workspace_timezone):
    """Create a workspace and its required owner authorization graph atomically."""
    now = timezone.now()
    try:
        with transaction.atomic():
            workspace = Workspace.objects.create(
                id=uuid.uuid4(),
                name=name,
                slug=slug,
                created_by_user=owner,
                timezone=workspace_timezone,
                created_at=now,
                updated_at=now,
            )
    except IntegrityError as exc:
        raise WorkspaceSlugConflict from exc
    owner_role = Role.objects.create(
        id=uuid.uuid4(),
        workspace=workspace,
        name='Owner',
        description='System-provisioned role for the workspace primary owner.',
        is_system=True,
        created_by_user=owner,
        created_at=now,
        updated_at=now,
    )
    RolePermission.objects.bulk_create(
        [
            RolePermission(role=owner_role, permission_key=permission_key)
            for permission_key in OWNER_PERMISSION_KEYS
        ]
    )
    for sort_order, (name, slug) in enumerate(
        (
            ('Queued', 'queued'),
            ('In Progress', 'in-progress'),
            ('In Review', 'in-review'),
            ('Revision', 'revision'),
            ('Approval', 'approval'),
            ('Approved', 'approved'),
        ),
        start=1,
    ):
        WorkflowStage.objects.create(
            id=uuid.uuid4(),
            workspace=workspace,
            name=name,
            slug=slug,
            sort_order=sort_order,
            created_by_user=owner,
            created_at=now,
            updated_at=now,
        )
    member_role = Role.objects.create(
        id=uuid.uuid4(),
        workspace=workspace,
        name='Member',
        description='System-provisioned role for internal workspace members.',
        is_system=True,
        created_by_user=owner,
        created_at=now,
        updated_at=now,
    )
    RolePermission.objects.bulk_create(
        [
            RolePermission(role=member_role, permission_key=permission_key)
            for permission_key in MEMBER_PERMISSION_KEYS
        ]
    )
    membership = WorkspaceMembership(
        id=uuid.uuid4(),
        workspace=workspace,
        principal_type=WorkspacePrincipalType.USER,
        user=owner,
        role=owner_role,
        project_access_mode=ProjectAccessMode.ALL,
        is_primary_owner=True,
        status=WorkspaceMembershipStatus.ACTIVE,
        joined_at=now,
        created_at=now,
        updated_at=now,
    )
    membership.full_clean()
    membership.save()
    return workspace, membership


def update_workspace(*, workspace, **fields):
    for field, value in fields.items():
        setattr(workspace, field, value)
    workspace.updated_at = timezone.now()
    workspace.full_clean()
    workspace.save()
    return workspace


def schedule_workspace_deletion(*, workspace):
    if workspace.status == WorkspaceStatus.PENDING_DELETION:
        raise WorkspaceLifecycleError('This workspace is already scheduled for deletion.')
    now = timezone.now()
    workspace.status = WorkspaceStatus.PENDING_DELETION
    workspace.deletion_scheduled_at = now + timedelta(days=settings.WORKSPACE_DELETION_GRACE_DAYS)
    workspace.updated_at = now
    workspace.save(update_fields=['status', 'deletion_scheduled_at', 'updated_at'])
    return workspace


def restore_workspace(*, workspace):
    if workspace.status != WorkspaceStatus.PENDING_DELETION:
        raise WorkspaceLifecycleError('This workspace is not scheduled for deletion.')
    workspace.status = WorkspaceStatus.ACTIVE
    workspace.deletion_scheduled_at = None
    workspace.updated_at = timezone.now()
    workspace.save(update_fields=['status', 'deletion_scheduled_at', 'updated_at'])
    return workspace


def get_or_create_workspace_profile(*, workspace):
    profile, _ = WorkspaceProfile.objects.get_or_create(
        workspace=workspace,
        defaults={'id': uuid.uuid4(), 'created_at': timezone.now(), 'updated_at': timezone.now()},
    )
    return profile


def update_workspace_profile(*, workspace, **fields):
    profile = get_or_create_workspace_profile(workspace=workspace)
    for field, value in fields.items():
        setattr(profile, field, value)
    profile.updated_at = timezone.now()
    profile.full_clean()
    profile.save()
    return profile
