"""Sign-up policy: SIGNUP_MODE=open|invite_only.

In ``invite_only`` mode an account may only be created by someone who holds a valid
invitation: a workspace invite (by token, or a pending one addressed to their email) or a
client-team invite token. Existing users can always sign in; this only gates *creation*.
"""
import hashlib
import logging

from django.conf import settings
from django.utils import timezone

from app.models import (
    ClientTeamInvite,
    ClientTeamInviteType,
    ClientTeamStatus,
    WorkspaceInvite,
)


logger = logging.getLogger(__name__)

SIGNUP_CLOSED_MESSAGE = (
    'Sign-up is invite-only right now. Ask a workspace admin to invite you, '
    'then use the link in your invitation email.'
)


class SignupClosed(Exception):
    pass


def signup_mode():
    return settings.SIGNUP_MODE


def _hash(token):
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def _valid_workspace_invite(*, token=None, email=None):
    now = timezone.now()
    qs = WorkspaceInvite.objects.filter(
        accepted_at__isnull=True, revoked_at__isnull=True, expires_at__gt=now,
    )
    if token:
        qs = qs.filter(token_hash=_hash(token))
        if email:
            qs = qs.filter(email__iexact=email)
    elif email:
        qs = qs.filter(email__iexact=email)
    else:
        return None
    return qs.select_related('workspace', 'role').first()


def _valid_client_team_invite(*, token, email=None):
    if not token:
        return None
    invite = ClientTeamInvite.objects.select_related('client_team').filter(
        token_hash=_hash(token), revoked_at__isnull=True, expires_at__gt=timezone.now(),
    ).first()
    if invite is None or invite.client_team.status != ClientTeamStatus.ACTIVE:
        return None
    if invite.max_uses is not None and invite.use_count >= invite.max_uses:
        return None
    if (
        invite.invite_type == ClientTeamInviteType.EMAIL and email
        and (invite.recipient_email or '').lower() != email.lower()
    ):
        return None
    return invite


def signup_allowed(*, email, invite_token=None):
    if signup_mode() == 'open':
        return True
    email = (email or '').strip().lower()
    if invite_token and (
        _valid_workspace_invite(token=invite_token, email=email)
        or _valid_client_team_invite(token=invite_token, email=email)
    ):
        return True
    return _valid_workspace_invite(email=email) is not None


def ensure_signup_allowed(*, email, invite_token=None):
    if not signup_allowed(email=email, invite_token=invite_token):
        raise SignupClosed(SIGNUP_CLOSED_MESSAGE)


def invite_preview(token):
    """Public, non-sensitive summary of an invite for the acceptance page."""
    invite = WorkspaceInvite.objects.select_related('workspace', 'role', 'invited_by_membership__user').filter(
        token_hash=_hash(token)
    ).first()
    now = timezone.now()
    if invite is not None:
        state = 'valid'
        if invite.accepted_at:
            state = 'accepted'
        elif invite.revoked_at or invite.expires_at <= now:
            state = 'expired'
        inviter = getattr(getattr(invite.invited_by_membership, 'user', None), 'get_full_name', lambda: '')()
        return {
            'kind': 'workspace', 'state': state, 'workspace_name': invite.workspace.name,
            'role_name': invite.role.name, 'email': invite.email, 'inviter_name': inviter or None,
            'expires_at': invite.expires_at,
        }
    ct = ClientTeamInvite.objects.select_related('client_team').filter(token_hash=_hash(token)).first()
    if ct is not None:
        state = 'valid'
        if ct.revoked_at or ct.expires_at <= now or ct.client_team.status != ClientTeamStatus.ACTIVE:
            state = 'expired'
        elif ct.max_uses is not None and ct.use_count >= ct.max_uses:
            state = 'expired'
        return {
            'kind': 'client_team', 'state': state, 'workspace_name': ct.client_team.name,
            'role_name': None, 'email': ct.recipient_email, 'inviter_name': None,
            'expires_at': ct.expires_at,
        }
    return None


def send_workspace_invite_email(*, invitation, token, inviter):
    from urllib.parse import urlencode

    from app.services.mailer import send_templated_email

    url = f'{settings.INVITE_ACCEPT_URL}?{urlencode({"token": token})}'
    try:
        send_templated_email(
            template='invite', to=invitation.email,
            context={
                'inviter_name': (inviter.get_full_name() or inviter.email) if inviter else 'A teammate',
                'workspace_name': invitation.workspace.name,
                'role_name': invitation.role.name,
                'email': invitation.email,
                'expires_at': invitation.expires_at,
                'action_url': url,
            },
        )
        return True
    except Exception:  # noqa: BLE001 - the invite still exists; the link can be copied
        logger.exception('Invite email delivery failed for invitation %s.', invitation.id)
        return False
