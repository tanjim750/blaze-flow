import hashlib
import secrets
import uuid
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from app.models import (
    GuestInvite, GuestInvitePermission, GuestReviewAccess,
    GuestReviewAccessPermission, GuestSession,
)
from .audit import record_user_audit


GUEST_ALLOWED_PERMISSIONS = frozenset({
    'media.read', 'media.download', 'review.comment.read',
    'review.comment.create', 'review.attachment.create',
    'annotation.read', 'annotation.create',
})


class GuestAccessError(Exception):
    pass


def _hash(value):
    return hashlib.sha256(value.encode()).hexdigest()


@transaction.atomic
def create_guest_invite(*, project, membership, label, permissions, expires_in_hours=168):
    requested = set(permissions)
    if not requested or not requested.issubset(GUEST_ALLOWED_PERMISSIONS):
        raise GuestAccessError('Select one or more supported guest permissions.')
    token = secrets.token_urlsafe(32)
    now = timezone.now()
    invite = GuestInvite.objects.create(
        id=uuid.uuid4(), project=project, label=label or '', token_hash=_hash(token),
        expires_at=now + timedelta(hours=expires_in_hours),
        created_by_workspace_membership=membership, created_at=now, updated_at=now,
    )
    GuestInvitePermission.objects.bulk_create([
        GuestInvitePermission(guest_invite=invite, permission_key=key, created_at=now)
        for key in sorted(requested)
    ])
    return invite, token


@transaction.atomic
def exchange_guest_invite(*, token, name, email):
    now = timezone.now()
    invite = GuestInvite.objects.select_for_update().select_related('project__workspace').filter(
        token_hash=_hash(token), revoked_at__isnull=True,
    ).first()
    if invite is None or (invite.expires_at and invite.expires_at <= now):
        raise GuestAccessError('This guest invitation is invalid or expired.')
    access_key = secrets.token_urlsafe(40)
    session = GuestSession.objects.create(
        id=uuid.uuid4(), workspace=invite.project.workspace, name=name.strip(),
        email=email.strip().lower(), access_key_hash=_hash(access_key),
        last_seen_at=now, created_at=now, updated_at=now,
    )
    access = GuestReviewAccess.objects.create(
        id=uuid.uuid4(), guest_invite=invite, guest_session=session,
        last_accessed_at=now, created_at=now, updated_at=now,
    )
    permissions = list(GuestInvitePermission.objects.filter(guest_invite=invite).values_list('permission_key', flat=True))
    GuestReviewAccessPermission.objects.bulk_create([
        GuestReviewAccessPermission(guest_review_access=access, permission_key=key, created_at=now)
        for key in permissions
    ])
    return access, access_key


def authenticate_guest_access(*, project, access_key, permission):
    now = timezone.now()
    access = GuestReviewAccess.objects.select_related(
        'guest_session', 'guest_invite', 'guest_invite__project'
    ).filter(
        guest_session__access_key_hash=_hash(access_key or ''),
        guest_invite__project=project, guest_invite__revoked_at__isnull=True,
        revoked_at__isnull=True,
    ).first()
    if access is None or (access.guest_invite.expires_at and access.guest_invite.expires_at <= now):
        raise GuestAccessError('Guest access is invalid or expired.')
    if not GuestReviewAccessPermission.objects.filter(
        guest_review_access=access, permission_key=permission,
    ).exists():
        raise GuestAccessError('This guest link does not grant that permission.')
    GuestReviewAccess.objects.filter(id=access.id).update(last_accessed_at=now, updated_at=now)
    GuestSession.objects.filter(id=access.guest_session_id).update(last_seen_at=now, updated_at=now)
    return access


@transaction.atomic
def revoke_guest_invite(*, invite, membership, user):
    locked = GuestInvite.objects.select_for_update().select_related('project__workspace').get(id=invite.id)
    if locked.revoked_at is not None:
        raise GuestAccessError('This guest invitation is already revoked.')
    now = timezone.now()
    locked.revoked_at = now
    locked.revoked_by_workspace_membership = membership
    locked.updated_at = now
    locked.save(update_fields=['revoked_at', 'revoked_by_workspace_membership', 'updated_at'])
    GuestReviewAccess.objects.filter(guest_invite=locked, revoked_at__isnull=True).update(
        revoked_at=now, revoked_by_workspace_membership=membership, updated_at=now,
    )
    record_user_audit(
        user=user, workspace=locked.project.workspace, action='guest.invite.revoked',
        entity_type='guest_invite', entity_id=locked.id,
    )
    return locked


@transaction.atomic
def revoke_guest_review_access(*, access, membership, user):
    locked = GuestReviewAccess.objects.select_for_update().select_related(
        'guest_invite__project__workspace'
    ).get(id=access.id)
    if locked.revoked_at is not None:
        raise GuestAccessError('This guest access is already revoked.')
    now = timezone.now()
    locked.revoked_at = now
    locked.revoked_by_workspace_membership = membership
    locked.updated_at = now
    locked.save(update_fields=['revoked_at', 'revoked_by_workspace_membership', 'updated_at'])
    record_user_audit(
        user=user, workspace=locked.guest_invite.project.workspace,
        action='guest.access.revoked', entity_type='guest_review_access',
        entity_id=locked.id,
    )
    return locked
