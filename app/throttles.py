import ipaddress

from django.conf import settings
from rest_framework.throttling import AnonRateThrottle as _AnonRateThrottle
from rest_framework.throttling import UserRateThrottle as _UserRateThrottle


def _valid_ip(value):
    try:
        return str(ipaddress.ip_address(value.strip()))
    except (ValueError, AttributeError):
        return None


class CloudflareClientIpMixin:
    """Identify anonymous clients by Cloudflare's CF-Connecting-IP when explicitly trusted.

    Only honoured with THROTTLE_TRUST_CF_CONNECTING_IP=true: the header is client-controlled
    unless the origin is reachable solely through Cloudflare. Otherwise DRF's
    X-Forwarded-For / NUM_PROXIES logic applies unchanged.
    """

    def get_ident(self, request):
        if getattr(settings, 'THROTTLE_TRUST_CF_CONNECTING_IP', False):
            ip = _valid_ip(request.META.get('HTTP_CF_CONNECTING_IP', ''))
            if ip:
                return ip
        return super().get_ident(request)


class AnonRateThrottle(CloudflareClientIpMixin, _AnonRateThrottle):
    pass


class UserRateThrottle(CloudflareClientIpMixin, _UserRateThrottle):
    pass


class RegistrationThrottle(AnonRateThrottle):
    scope = 'registration'


class LoginThrottle(AnonRateThrottle):
    scope = 'login'


class PasswordResetThrottle(AnonRateThrottle):
    scope = 'password_reset'


class EmailVerificationThrottle(AnonRateThrottle):
    scope = 'email_verification'


class InvitePreviewThrottle(AnonRateThrottle):
    """Read-only invite lookups get their own, looser bucket: a page reload shouldn't
    eat into the email-verification allowance."""
    scope = 'invite_preview'


class UploadLinkThrottle(AnonRateThrottle):
    """Public upload links: per client IP, signed in or not (a link is the only credential)."""
    scope = 'upload_link'

    def get_cache_key(self, request, view):
        return self.cache_format % {'scope': self.scope, 'ident': self.get_ident(request)}


class SupportTicketThrottle(UserRateThrottle):
    scope = 'support_ticket'


class GuestExchangeThrottle(AnonRateThrottle):
    """Redeeming a review link (long token or /r/<code>): caps guessing short codes per IP."""
    scope = 'guest_exchange'
