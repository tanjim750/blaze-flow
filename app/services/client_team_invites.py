import hashlib
import secrets
import uuid
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from app.models import (
    ClientTeamInvite,
    ClientTeamInviteAcceptance,
    ClientTeamInviteType,
    ClientTeamMember,
    ClientTeamMemberStatus,
    ClientTeamStatus,
)

from .client_teams import add_client_team_member


class ClientTeamInviteError(Exception):
    pass


def _hash_token(token):
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def create_client_team_invite(
    *,
    client_team,
    invite_type,
    created_by_membership=None,
    recipient_email=None,
    label=None,
    max_uses=None,
    expires_in_days=14,
):
    if invite_type == ClientTeamInviteType.EMAIL and not recipient_email:
        raise ClientTeamInviteError('An EMAIL invitation requires a recipient email address.')
    if invite_type == ClientTeamInviteType.LINK and recipient_email:
        raise ClientTeamInviteError('A LINK invitation cannot target a recipient email address.')

    now = timezone.now()
    token = secrets.token_urlsafe(32)
    # EMAIL invites are recipient-bound and single-use by definition; LINK invites use the
    # caller-supplied limit, or remain unlimited until expiration/revocation.
    effective_max_uses = 1 if invite_type == ClientTeamInviteType.EMAIL else max_uses
    invite = ClientTeamInvite(
        id=uuid.uuid4(),
        client_team=client_team,
        invite_type=invite_type,
        recipient_email=recipient_email.lower() if recipient_email else None,
        label=label or None,
        token_hash=_hash_token(token),
        max_uses=effective_max_uses,
        expires_at=now + timedelta(days=expires_in_days),
        created_by_workspace_membership=created_by_membership,
        created_at=now,
        updated_at=now,
    )
    invite.full_clean()
    invite.save()
    return invite, token


def revoke_client_team_invite(*, invite, revoked_by_membership=None):
    if invite.revoked_at is not None:
        raise ClientTeamInviteError('This invitation has already been revoked.')
    now = timezone.now()
    invite.revoked_at = now
    invite.revoked_by_workspace_membership = revoked_by_membership
    invite.updated_at = now
    invite.save(update_fields=['revoked_at', 'revoked_by_workspace_membership', 'updated_at'])
    return invite


@transaction.atomic
def accept_client_team_invite(*, user, token):
    try:
        invite = ClientTeamInvite.objects.select_for_update().select_related(
            'client_team'
        ).get(token_hash=_hash_token(token))
    except ClientTeamInvite.DoesNotExist as exc:
        raise ClientTeamInviteError('This invitation is invalid.') from exc

    now = timezone.now()
    if invite.revoked_at is not None or invite.expires_at <= now:
        raise ClientTeamInviteError('This invitation is no longer available.')
    if invite.client_team.status != ClientTeamStatus.ACTIVE:
        raise ClientTeamInviteError('This client team is no longer active.')
    if (
        invite.invite_type == ClientTeamInviteType.EMAIL
        and invite.recipient_email.lower() != user.email.lower()
    ):
        raise ClientTeamInviteError('This invitation belongs to a different email address.')

    existing_acceptance = ClientTeamInviteAcceptance.objects.filter(
        invite=invite, user=user
    ).select_related('client_team_member').first()
    if existing_acceptance is not None:
        return existing_acceptance.client_team_member

    if invite.max_uses is not None and invite.use_count >= invite.max_uses:
        raise ClientTeamInviteError('This invitation has reached its usage limit.')

    member = ClientTeamMember.objects.filter(client_team=invite.client_team, user=user).first()
    if member is None or member.status != ClientTeamMemberStatus.ACTIVE:
        member = add_client_team_member(client_team=invite.client_team, user=user)

    ClientTeamInviteAcceptance.objects.create(
        id=uuid.uuid4(),
        invite=invite,
        user=user,
        client_team_member=member,
        accepted_at=now,
    )
    invite.use_count = invite.use_count + 1
    invite.updated_at = now
    invite.save(update_fields=['use_count', 'updated_at'])
    return member
