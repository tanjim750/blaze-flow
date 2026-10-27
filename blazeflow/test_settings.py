"""Fast local test settings; CI still validates against PostgreSQL."""

from .settings import *  # noqa: F403


DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': ':memory:',
    }
}

PASSWORD_HASHERS = [
    'django.contrib.auth.hashers.MD5PasswordHasher',
]

EMAIL_BACKEND = 'django.core.mail.backends.locmem.EmailBackend'

REST_FRAMEWORK = {
    **REST_FRAMEWORK,  # noqa: F405
    'DEFAULT_THROTTLE_RATES': {
        # Every scope the app defines, relaxed, so new scopes never miss a rate in tests.
        **{scope: '10000/hour' for scope in REST_FRAMEWORK.get('DEFAULT_THROTTLE_RATES', {})},  # noqa: F405
        'invite_preview': '10000/hour',
        'support_ticket': '10000/hour',
        'registration': '10000/hour',
        'login': '10000/hour',
        'password_reset': '10000/hour',
        'email_verification': '10000/hour',
        'upload_link': '10000/hour',
    },
}

# AI Visual QA runs on the fake engine in tests (no Paddle needed).
AI_QA_ENGINE = 'fake'

# Expected 4xx responses in tests are not worth a log line each.
LOGGING['loggers']['django.request']['level'] = 'ERROR'  # noqa: F405

# Stripe is mocked in tests; these are fake placeholders, never real keys.
STRIPE_SECRET_KEY = ''
STRIPE_PUBLISHABLE_KEY = ''
STRIPE_WEBHOOK_SECRET = ''
PLATFORM_FEE_PERCENT = '0'
