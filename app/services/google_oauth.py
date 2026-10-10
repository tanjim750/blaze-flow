import uuid

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.utils import timezone

from app.models import OAuthIdentity, OAuthProvider, UserStatus

from .subscriptions import provision_free_subscription

User = get_user_model()


class GoogleOAuthError(Exception):
    pass


def verify_google_id_token(token):
    """Verifies a Google-issued ID token and returns its decoded claims.

    Isolated in its own function so tests replace it with a double instead of calling
    Google's network endpoint, the same way FILE_SECURITY_SCANNER is swapped for tests.
    """
    if not settings.GOOGLE_OAUTH_CLIENT_ID:
        raise GoogleOAuthError('Google sign-in is not configured on this server.')
    try:
        from google.auth.transport import requests as google_requests
        from google.oauth2 import id_token as google_id_token
    except ImportError as exc:
        raise GoogleOAuthError('Google sign-in support is not installed on this server.') from exc
    try:
        return google_id_token.verify_oauth2_token(
            token, google_requests.Request(), audience=settings.GOOGLE_OAUTH_CLIENT_ID,
        )
    except ValueError as exc:
        raise GoogleOAuthError('This Google sign-in token is invalid or expired.') from exc


def _update_identity_profile(*, identity, claims, now):
    identity.provider_email = claims.get('email') or identity.provider_email
    identity.provider_email_verified = bool(claims.get('email_verified'))
    identity.provider_first_name = claims.get('given_name') or identity.provider_first_name
    identity.provider_last_name = claims.get('family_name') or identity.provider_last_name
    identity.provider_avatar_url = claims.get('picture') or identity.provider_avatar_url
    identity.updated_at = now
    identity.save(update_fields=[
        'provider_email', 'provider_email_verified', 'provider_first_name',
        'provider_last_name', 'provider_avatar_url', 'updated_at',
    ])


@transaction.atomic
def authenticate_with_google(*, id_token):
    claims = verify_google_id_token(id_token)
    subject = claims.get('sub')
    email = (claims.get('email') or '').strip().lower()
    email_verified = bool(claims.get('email_verified'))
    if not subject or not email:
        raise GoogleOAuthError('The Google sign-in token is missing required account details.')

    now = timezone.now()
    identity = OAuthIdentity.objects.select_related('user').filter(
        provider=OAuthProvider.GOOGLE, provider_subject=subject,
    ).first()
    if identity is not None:
        user = identity.user
        if user.status != UserStatus.ACTIVE:
            raise GoogleOAuthError('This account cannot sign in.')
        _update_identity_profile(identity=identity, claims=claims, now=now)
        return user

    if not email_verified:
        raise GoogleOAuthError(
            'Sign in with a Google account whose email address is verified, or register directly.'
        )

    user = User.objects.filter(email__iexact=email).first()
    created_user = False
    if user is None:
        user = User.objects.create_user(
            email=email,
            password=None,
            first_name=claims.get('given_name') or '',
            last_name=claims.get('family_name') or '',
            avatar_url=claims.get('picture') or None,
            email_verified_at=now,
        )
        created_user = True
    else:
        if user.status != UserStatus.ACTIVE:
            raise GoogleOAuthError('This account cannot sign in.')
        if user.email_verified_at is None:
            user.email_verified_at = now
            user.save(update_fields=['email_verified_at'])

    try:
        OAuthIdentity.objects.create(
            id=uuid.uuid4(), user=user, provider=OAuthProvider.GOOGLE, provider_subject=subject,
            provider_email=email, provider_email_verified=email_verified,
            provider_first_name=claims.get('given_name'), provider_last_name=claims.get('family_name'),
            provider_avatar_url=claims.get('picture'), profile_metadata={},
            linked_at=now, created_at=now, updated_at=now,
        )
    except IntegrityError as exc:
        raise GoogleOAuthError('This account already has a different linked Google identity.') from exc

    if created_user:
        provision_free_subscription(user=user)
    return user
