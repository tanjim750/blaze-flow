import hashlib
import secrets
import uuid
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from app.models import (
    ProjectAccessMode,
    RoleStatus,
    WorkspaceInvite,
    WorkspaceMembership,
    WorkspaceMembershipStatus,
    WorkspacePrincipalType,
)


class InvitationError(Exception):
    pass


def _hash_token(token):
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


@transaction.atomic
def create_invitation(*, workspace, email, role, invited_by_membership, project_access_mode, expires_in_days=7):
    if role.workspace_id != workspace.id or role.status != RoleStatus.ACTIVE:
        raise InvitationError('Select an active role from this workspace.')

    now = timezone.now()
    WorkspaceInvite.objects.filter(
        workspace=workspace,
        email__iexact=email,
        accepted_at__isnull=True,
        revoked_at__isnull=True,
    ).update(revoked_at=now, updated_at=now)
    token = secrets.token_urlsafe(32)
    invitation = WorkspaceInvite(
        id=uuid.uuid4(),
        workspace=workspace,
        email=email.lower(),
        role=role,
        project_access_mode=project_access_mode,
        token_hash=_hash_token(token),
        invited_by_membership=invited_by_membership,
        expires_at=now + timedelta(days=expires_in_days),
    )
    invitation.full_clean()
    invitation.save()
    return invitation, token


@transaction.atomic
def accept_invitation(*, user, token):
    try:
        invitation = WorkspaceInvite.objects.select_for_update().select_related(
            'workspace', 'role'
        ).get(token_hash=_hash_token(token))
    except WorkspaceInvite.DoesNotExist as exc:
        raise InvitationError('This invitation is invalid.') from exc

    now = timezone.now()
    if invitation.revoked_at or invitation.accepted_at or invitation.expires_at <= now:
        raise InvitationError('This invitation is no longer available.')
    if invitation.email.lower() != user.email.lower():
        raise InvitationError('This invitation belongs to a different email address.')
    if invitation.role.status != RoleStatus.ACTIVE:
        raise InvitationError('The invitation role is no longer active.')

    membership = WorkspaceMembership.objects.filter(
        workspace=invitation.workspace,
        user=user,
    ).first()
    if membership and membership.status != WorkspaceMembershipStatus.REMOVED:
        raise InvitationError('You already have a membership in this workspace.')
    if membership:
        membership.role = invitation.role
        membership.project_access_mode = invitation.project_access_mode
        membership.status = WorkspaceMembershipStatus.ACTIVE
        membership.updated_at = now
    else:
        membership = WorkspaceMembership(
            id=uuid.uuid4(),
            workspace=invitation.workspace,
            principal_type=WorkspacePrincipalType.USER,
            user=user,
            role=invitation.role,
            project_access_mode=invitation.project_access_mode,
            is_primary_owner=False,
            status=WorkspaceMembershipStatus.ACTIVE,
            joined_at=now,
            created_at=now,
            updated_at=now,
        )
    membership.full_clean()
    membership.save()
    invitation.accepted_at = now
    invitation.accepted_by_user = user
    invitation.save(update_fields=['accepted_at', 'accepted_by_user', 'updated_at'])
    return membership
