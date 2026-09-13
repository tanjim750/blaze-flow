import hashlib
import logging
import secrets
import uuid
from datetime import timedelta
from urllib.parse import urlencode

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone

from app.models import EmailVerificationToken, PasswordResetToken, UserStatus


logger = logging.getLogger(__name__)
User = get_user_model()


class EmailVerificationError(Exception):
    pass


def _hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def request_email_verification(*, email):
    user = User.objects.filter(email__iexact=email.strip(), status=UserStatus.ACTIVE).first()
    if user is None or user.email_verified_at is not None:
        return None

    raw_token = secrets.token_urlsafe(40)
    now = timezone.now()
    with transaction.atomic():
        EmailVerificationToken.objects.filter(
            user=user,
            used_at__isnull=True,
            invalidated_at__isnull=True,
            expires_at__gt=now,
        ).update(invalidated_at=now)
        verification = EmailVerificationToken.objects.create(
            id=uuid.uuid4(),
            user=user,
            token_hash=_hash(raw_token),
            expires_at=now + timedelta(minutes=settings.EMAIL_VERIFICATION_TTL_MINUTES),
            created_at=now,
        )

    verification_url = (
        f'{settings.EMAIL_VERIFICATION_URL}?{urlencode({"token": raw_token})}'
    )
    try:
        send_mail(
            subject='Verify your Blaze Flow email',
            message=(
                f'Use this link to verify your email address:\n\n{verification_url}\n\n'
                f'This link expires in {settings.EMAIL_VERIFICATION_TTL_MINUTES} minutes.'
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
            fail_silently=False,
        )
    except Exception:
        EmailVerificationToken.objects.filter(id=verification.id).update(
            invalidated_at=timezone.now()
        )
        logger.exception('Email-verification delivery failed for token %s.', verification.id)
    return verification


@transaction.atomic
def confirm_email_verification(*, token):
    now = timezone.now()
    verification = (
        EmailVerificationToken.objects.select_for_update()
        .select_related('user')
        .filter(
            token_hash=_hash(token),
            used_at__isnull=True,
            invalidated_at__isnull=True,
            expires_at__gt=now,
            user__status=UserStatus.ACTIVE,
        )
        .first()
    )
    if verification is None:
        raise EmailVerificationError('This email-verification token is invalid or expired.')

    user = verification.user
    if user.email_verified_at is None:
        user.email_verified_at = now
        user.save(update_fields=['email_verified_at', 'updated_at'])
    verification.used_at = now
    verification.save(update_fields=['used_at'])
    EmailVerificationToken.objects.filter(
        user=user, used_at__isnull=True, invalidated_at__isnull=True
    ).exclude(id=verification.id).update(invalidated_at=now)
    return user


def purge_expired_auth_tokens(*, limit, dry_run=False, now=None):
    if limit < 1:
        raise ValueError('limit must be at least 1')
    now = now or timezone.now()
    reset_ids = list(
        PasswordResetToken.objects.filter(expires_at__lte=now)
        .order_by('expires_at')
        .values_list('id', flat=True)[:limit]
    )
    remaining = limit - len(reset_ids)
    verification_ids = list(
        EmailVerificationToken.objects.filter(expires_at__lte=now)
        .order_by('expires_at')
        .values_list('id', flat=True)[:remaining]
    )
    result = {
        'password_reset_tokens': len(reset_ids),
        'email_verification_tokens': len(verification_ids),
    }
    if not dry_run:
        with transaction.atomic():
            PasswordResetToken.objects.filter(id__in=reset_ids).delete()
            EmailVerificationToken.objects.filter(id__in=verification_ids).delete()
    return result
