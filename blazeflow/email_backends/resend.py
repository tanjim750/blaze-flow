"""Django email backend that sends through Resend's HTTPS API.

Many hosts (Hetzner, most clouds) block outbound SMTP ports, so production talks to
``POST https://api.resend.com/emails`` over 443 instead of ``smtp.resend.com``.

Settings used: ``RESEND_API_KEY`` (required), ``RESEND_API_URL`` (optional override),
``EMAIL_TIMEOUT`` (seconds) and ``DEFAULT_FROM_EMAIL``. Each message is one API call; the
key is only ever sent in the Authorization header and is never logged or put in errors.
"""
from __future__ import annotations

import base64
import logging
import mimetypes
from email.mime.base import MIMEBase

import requests
from django.conf import settings
from django.core.mail.backends.base import BaseEmailBackend

from blazeflow import __version__

logger = logging.getLogger(__name__)

DEFAULT_API_URL = 'https://api.resend.com/emails'
# A custom UA matters: Cloudflare in front of api.resend.com rejects some default library
# user agents (error 1010).
USER_AGENT = f'blazeflow/{__version__}'


class ResendAPIError(Exception):
    """A message was rejected by (or could not reach) the Resend API."""

    def __init__(self, message, *, status=None):
        super().__init__(message)
        self.status = status


def _attachment_payload(attachment):
    """Turn a Django attachment (tuple or MIMEBase) into a Resend attachment dict."""
    if isinstance(attachment, MIMEBase):
        filename = attachment.get_filename() or 'attachment'
        content = attachment.get_payload(decode=True) or b''
        mimetype = attachment.get_content_type()
    else:
        filename, content, mimetype = attachment
        if isinstance(content, str):
            content = content.encode('utf-8')
        filename = filename or 'attachment'
    item = {'filename': filename, 'content': base64.b64encode(content).decode('ascii')}
    mimetype = mimetype or mimetypes.guess_type(filename)[0]
    if mimetype:
        item['content_type'] = mimetype
    return item


class EmailBackend(BaseEmailBackend):
    def __init__(self, fail_silently=False, api_key=None, timeout=None, api_url=None, **kwargs):
        super().__init__(fail_silently=fail_silently, **kwargs)
        self.api_key = api_key if api_key is not None else getattr(settings, 'RESEND_API_KEY', '')
        self.timeout = timeout if timeout is not None else getattr(settings, 'EMAIL_TIMEOUT', 20)
        self.api_url = api_url or getattr(settings, 'RESEND_API_URL', '') or DEFAULT_API_URL
        self.session = None

    def open(self):
        if self.session is not None:
            return False
        self.session = requests.Session()
        self.session.headers.update({
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': USER_AGENT,
        })
        return True

    def close(self):
        if self.session is not None:
            self.session.close()
            self.session = None

    def send_messages(self, email_messages):
        if not email_messages:
            return 0
        if not self.api_key:
            if self.fail_silently:
                return 0
            raise ResendAPIError('RESEND_API_KEY is not configured.')
        new_session = self.open()
        sent = 0
        try:
            for message in email_messages:
                try:
                    self._send(message)
                    sent += 1
                except Exception as exc:
                    logger.warning('Resend API send failed: %s', exc)
                    if not self.fail_silently:
                        raise
        finally:
            if new_session:
                self.close()
        return sent

    def build_payload(self, message):
        payload = {
            'from': message.from_email or settings.DEFAULT_FROM_EMAIL,
            'to': list(message.to),
            'subject': message.subject or '',
        }
        if message.cc:
            payload['cc'] = list(message.cc)
        if message.bcc:
            payload['bcc'] = list(message.bcc)
        if message.reply_to:
            payload['reply_to'] = list(message.reply_to)
        html = None
        if getattr(message, 'content_subtype', 'plain') == 'html':
            html = message.body
        else:
            if message.body:
                payload['text'] = message.body
            for content, mimetype in getattr(message, 'alternatives', None) or []:
                if mimetype == 'text/html':
                    html = content
                    break
        if html:
            payload['html'] = html
        headers = {k: str(v) for k, v in (message.extra_headers or {}).items()
                   if k.lower() not in ('from', 'to', 'cc', 'bcc', 'reply-to', 'subject')}
        if headers:
            payload['headers'] = headers
        if message.attachments:
            payload['attachments'] = [_attachment_payload(a) for a in message.attachments]
        return payload

    def _send(self, message):
        if not message.recipients():
            return None
        payload = self.build_payload(message)
        try:
            resp = self.session.post(
                self.api_url, json=payload, timeout=self.timeout,
                headers={'Authorization': f'Bearer {self.api_key}'},
            )
        except requests.Timeout as exc:
            raise ResendAPIError(f'Resend API timed out after {self.timeout}s.') from None
        except requests.RequestException as exc:
            raise ResendAPIError(f'Could not reach the Resend API: {type(exc).__name__}.') from None
        if 200 <= resp.status_code < 300:
            try:
                return resp.json().get('id')
            except ValueError:
                return None
        raise ResendAPIError(self._error_text(resp), status=resp.status_code)

    def _error_text(self, resp):
        detail = ''
        try:
            data = resp.json()
            if isinstance(data, dict):
                detail = data.get('message') or data.get('error') or data.get('name') or ''
        except ValueError:
            detail = (resp.text or '')[:300]
        detail = str(detail).replace(self.api_key, '[redacted]') if self.api_key else str(detail)
        return f'Resend API HTTP {resp.status_code}' + (f': {detail}' if detail else '')
