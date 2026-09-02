import uuid

from django.db import IntegrityError
from django.core.exceptions import ValidationError
from django.utils import timezone

from app.models import ProjectAccessMode, ResourceAccess, WorkspaceMembershipStatus


class ResourceAccessError(Exception):
    pass


def grant_project_access(*, project, membership):
    if membership.workspace_id != project.workspace_id:
        raise ResourceAccessError('The membership and project must belong to the same workspace.')
    if membership.status != WorkspaceMembershipStatus.ACTIVE:
        raise ResourceAccessError('Project access can only be granted to an active membership.')
    if membership.project_access_mode != ProjectAccessMode.SELECTED:
        raise ResourceAccessError('Explicit grants are only valid for SELECTED memberships.')
    grant = ResourceAccess(
        id=uuid.uuid4(),
        workspace_membership=membership,
        project=project,
        created_at=timezone.now(),
    )
    try:
        grant.full_clean()
        grant.save()
    except (IntegrityError, ValidationError) as exc:
        raise ResourceAccessError('This membership already has access to the project.') from exc
    return grant
