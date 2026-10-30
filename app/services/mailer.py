"""Branded transactional email: one place that renders HTML + plain-text and sends.

Every template lives in ``app/templates/emails/<name>.html`` and ``<name>.txt``; the HTML
extends ``emails/base.html``. Delivery uses whatever ``EMAIL_BACKEND`` settings resolve to
(Resend SMTP, any SMTP relay, or the console in development).
"""
from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string


def render_email(template, context):
    ctx = {
        'brand': settings.EMAIL_BRAND_NAME,
        'app_url': settings.APP_BASE_URL,
        **context,
    }
    subject = ' '.join(render_to_string(f'emails/{template}.subject.txt', ctx).split())
    text = render_to_string(f'emails/{template}.txt', ctx)
    html = render_to_string(f'emails/{template}.html', ctx)
    return subject, text, html


def send_templated_email(*, template, to, context, from_email=None, reply_to=None):
    """Render and send. Returns the backend's sent count; raises on delivery failure."""
    subject, text, html = render_email(template, context)
    message = EmailMultiAlternatives(
        subject=subject,
        body=text,
        from_email=from_email or settings.DEFAULT_FROM_EMAIL,
        to=[to] if isinstance(to, str) else list(to),
        reply_to=reply_to,
    )
    message.attach_alternative(html, 'text/html')
    return message.send(fail_silently=False)
