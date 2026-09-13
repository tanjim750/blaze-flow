import uuid

from django.db import transaction
from django.utils import timezone

from app.models import Role, RolePermission, RoleStatus, WorkspaceMembership, WorkspaceMembershipStatus
from app.permissions import ALL_PERMISSION_KEYS


class RoleError(Exception):
    pass


def validate_permission_keys(permission_keys):
    keys = set(permission_keys)
    unknown = keys - ALL_PERMISSION_KEYS
    if unknown:
        raise RoleError(f"Unknown permission keys: {', '.join(sorted(unknown))}.")
    return sorted(keys)


@transaction.atomic
def create_role(*, workspace, created_by_user, name, description='', permission_keys=()):
    now = timezone.now()
    role = Role(
        id=uuid.uuid4(),
        workspace=workspace,
        name=name,
        description=description,
        is_system=False,
        created_by_user=created_by_user,
        created_at=now,
        updated_at=now,
    )
    role.full_clean()
    role.save()
    RolePermission.objects.bulk_create(
        [
            RolePermission(role=role, permission_key=key)
            for key in validate_permission_keys(permission_keys)
        ]
    )
    return role


@transaction.atomic
def update_role(*, role, name=None, description=None, permission_keys=None):
    if role.is_system:
        raise RoleError('System roles cannot be modified.')
    if name is not None:
        role.name = name
    if description is not None:
        role.description = description
    role.updated_at = timezone.now()
    role.full_clean()
    role.save()
    if permission_keys is not None:
        permission_keys = validate_permission_keys(permission_keys)
        RolePermission.objects.filter(role=role).delete()
        RolePermission.objects.bulk_create(
            [RolePermission(role=role, permission_key=key) for key in permission_keys]
        )
    return role


@transaction.atomic
def archive_role(*, role):
    if role.is_system:
        raise RoleError('System roles cannot be archived.')
    if WorkspaceMembership.objects.filter(
        role=role,
        status=WorkspaceMembershipStatus.ACTIVE,
    ).exists():
        raise RoleError('Reassign active memberships before archiving this role.')
    role.status = RoleStatus.ARCHIVED
    role.updated_at = timezone.now()
    role.save(update_fields=['status', 'updated_at'])
    return role
