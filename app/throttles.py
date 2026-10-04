from rest_framework.throttling import AnonRateThrottle


class RegistrationThrottle(AnonRateThrottle):
    scope = 'registration'


class LoginThrottle(AnonRateThrottle):
    scope = 'login'


class PasswordResetThrottle(AnonRateThrottle):
    scope = 'password_reset'


class EmailVerificationThrottle(AnonRateThrottle):
    scope = 'email_verification'


class UploadLinkThrottle(AnonRateThrottle):
    """Public upload links: per client IP, signed in or not (a link is the only credential)."""
    scope = 'upload_link'

    def get_cache_key(self, request, view):
        return self.cache_format % {'scope': self.scope, 'ident': self.get_ident(request)}
