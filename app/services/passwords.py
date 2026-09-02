import hashlib
import logging
import secrets
import uuid
from datetime import timedelta
from urllib.parse import urlencode

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone

from app.models import PasswordResetToken, UserStatus


logger = logging.getLogger(__name__)
User = get_user_model()


class PasswordError(Exception):
    pass


def _hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def request_password_reset(*, email):
    user = User.objects.filter(email__iexact=email.strip(), status=UserStatus.ACTIVE).first()
    if user is None:
        return None
    raw_token = secrets.token_urlsafe(40)
    now = timezone.now()
    with transaction.atomic():
        PasswordResetToken.objects.filter(
            user=user, used_at__isnull=True, invalidated_at__isnull=True,
            expires_at__gt=now,
        ).update(invalidated_at=now)
        reset = PasswordResetToken.objects.create(
            id=uuid.uuid4(), user=user, token_hash=_hash(raw_token),
            expires_at=now + timedelta(minutes=settings.PASSWORD_RESET_TTL_MINUTES),
            created_at=now,
        )
    reset_url = f'{settings.PASSWORD_RESET_URL}?{urlencode({"token": raw_token})}'
    try:
        send_mail(
            subject='Reset your Blaze Flow password',
            message=(
                f'Use this link to reset your password:\n\n{reset_url}\n\n'
                f'This link expires in {settings.PASSWORD_RESET_TTL_MINUTES} minutes.'
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
            fail_silently=False,
        )
    except Exception:
        PasswordResetToken.objects.filter(id=reset.id).update(invalidated_at=timezone.now())
        logger.exception('Password-reset email delivery failed for token %s.', reset.id)
    return reset


@transaction.atomic
def confirm_password_reset(*, token, new_password):
    now = timezone.now()
    reset = PasswordResetToken.objects.select_for_update().select_related('user').filter(
        token_hash=_hash(token), used_at__isnull=True, invalidated_at__isnull=True,
        expires_at__gt=now, user__status=UserStatus.ACTIVE,
    ).first()
    if reset is None:
        raise PasswordError('This password-reset token is invalid or expired.')
    try:
        validate_password(new_password, user=reset.user)
    except ValidationError as exc:
        raise PasswordError(' '.join(exc.messages)) from exc
    reset.user.set_password(new_password)
    reset.user.save(update_fields=['password', 'updated_at'])
    reset.used_at = now
    reset.save(update_fields=['used_at'])
    PasswordResetToken.objects.filter(
        user=reset.user, used_at__isnull=True, invalidated_at__isnull=True,
    ).exclude(id=reset.id).update(invalidated_at=now)
    return reset.user


def change_password(*, user, current_password, new_password):
    if not user.check_password(current_password):
        raise PasswordError('The current password is incorrect.')
    try:
        validate_password(new_password, user=user)
    except ValidationError as exc:
        raise PasswordError(' '.join(exc.messages)) from exc
    if current_password == new_password:
        raise PasswordError('The new password must be different from the current password.')
    user.set_password(new_password)
    user.save(update_fields=['password', 'updated_at'])
    now = timezone.now()
    PasswordResetToken.objects.filter(
        user=user, used_at__isnull=True, invalidated_at__isnull=True,
    ).update(invalidated_at=now)
    return user
