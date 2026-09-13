import uuid

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone

from app.models import (
    ClientTeam,
    ClientTeamMember,
    ClientTeamMemberStatus,
    ClientTeamStatus,
    WorkspaceMembership,
    WorkspaceMembershipStatus,
    WorkspacePrincipalType,
)

_PROFILE_FIELDS = (
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
)


class ClientTeamError(Exception):
    pass


def create_client_team(*, workspace, created_by_membership=None, **fields):
    now = timezone.now()
    client_team = ClientTeam(
        id=uuid.uuid4(),
        workspace=workspace,
        created_by_workspace_membership=created_by_membership,
        created_at=now,
        updated_at=now,
        **{key: fields.get(key) for key in _PROFILE_FIELDS if key in fields},
    )
    client_team.full_clean()
    client_team.save()
    return client_team


def update_client_team(*, client_team, **fields):
    for key in _PROFILE_FIELDS:
        if key in fields:
            setattr(client_team, key, fields[key])
    client_team.updated_at = timezone.now()
    client_team.full_clean()
    client_team.save()
    return client_team


def archive_client_team(*, client_team):
    if client_team.status == ClientTeamStatus.ARCHIVED:
        raise ClientTeamError('This client team is already archived.')
    client_team.status = ClientTeamStatus.ARCHIVED
    client_team.updated_at = timezone.now()
    client_team.save(update_fields=['status', 'updated_at'])
    return client_team


@transaction.atomic
def add_client_team_member(*, client_team, user, added_by_membership=None, title=None):
    now = timezone.now()
    existing = ClientTeamMember.objects.select_for_update().filter(
        client_team=client_team, user=user
    ).first()
    if existing is not None:
        if existing.status == ClientTeamMemberStatus.ACTIVE:
            raise ClientTeamError('This user is already a member of the client team.')
        existing.status = ClientTeamMemberStatus.ACTIVE
        existing.removed_at = None
        if title is not None:
            existing.title = title
        existing.added_by_workspace_membership = added_by_membership
        existing.updated_at = now
        existing.full_clean()
        existing.save()
        return existing
    member = ClientTeamMember(
        id=uuid.uuid4(),
        client_team=client_team,
        user=user,
        title=title,
        status=ClientTeamMemberStatus.ACTIVE,
        joined_at=now,
        added_by_workspace_membership=added_by_membership,
        created_at=now,
        updated_at=now,
    )
    member.full_clean()
    member.save()
    return member


def remove_client_team_member(*, member):
    if member.status == ClientTeamMemberStatus.REMOVED:
        raise ClientTeamError('This member has already been removed.')
    member.status = ClientTeamMemberStatus.REMOVED
    member.removed_at = timezone.now()
    member.updated_at = timezone.now()
    member.save(update_fields=['status', 'removed_at', 'updated_at'])
    return member


def grant_client_team_workspace_access(*, client_team, role, project_access_mode):
    if role.workspace_id != client_team.workspace_id:
        raise ClientTeamError('The role must belong to the same workspace as the client team.')
    now = timezone.now()
    membership = WorkspaceMembership(
        id=uuid.uuid4(),
        workspace=client_team.workspace,
        principal_type=WorkspacePrincipalType.CLIENT_TEAM,
        client_team=client_team,
        role=role,
        project_access_mode=project_access_mode,
        status=WorkspaceMembershipStatus.ACTIVE,
        joined_at=now,
        created_at=now,
        updated_at=now,
    )
    try:
        membership.full_clean()
        membership.save()
    except (IntegrityError, ValidationError) as exc:
        raise ClientTeamError('This client team already has workspace access.') from exc
    return membership
