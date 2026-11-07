"""WhatsApp sending, behind a small provider interface.

``WHATSAPP_PROVIDER=log`` (the default) never contacts anyone: it logs the message and returns
a fake id, so development, CI and the demo exercise the whole flow safely. ``meta`` posts an
approved template to the Meta WhatsApp Cloud API.
"""
import hashlib
import hmac
import logging
import re
import uuid

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

E164_RE = re.compile(r'^\+[1-9]\d{7,14}$')
# What a client sends to stop messages. Meta's own opt-out button also arrives as one of these.
STOP_WORDS = frozenset({'stop', 'unsubscribe', 'stop all', 'opt out', 'optout', 'cancel'})


class WhatsAppError(Exception):
    """A send failed. ``retryable`` says whether the outbox should try again later."""

    def __init__(self, message, *, retryable=True, code=None):
        super().__init__(message)
        self.retryable = retryable
        self.code = code


def normalize_phone(raw):
    """Returns the number in E.164 (+447700900123) or raises ValueError.

    Accepts spaces, dashes, brackets and a leading 00. A UK number written 07... is read as +44,
    because a missing country code is the most common mistake; any other local number must be
    written with its country code.
    """
    value = re.sub(r'[\s\-().]', '', raw or '')
    if value.startswith('00'):
        value = '+' + value[2:]
    elif value.startswith('07') and len(value) == 11:
        value = '+44' + value[1:]
    if not E164_RE.match(value):
        raise ValueError('Enter the number in international format, for example +44 7700 900123.')
    return value


def mask_phone(phone):
    return f'{phone[:3]}••••{phone[-3:]}' if phone and len(phone) > 6 else '••••'


def is_stop_message(text):
    return ' '.join((text or '').lower().split()).strip('.! ') in STOP_WORDS


class LogProvider:
    name = 'log'

    def send_template(self, *, to, template, language, body_params, button_param=None):
        message_id = f'log-{uuid.uuid4()}'
        logger.info(
            'WhatsApp (test mode, not sent) to=%s template=%s lang=%s params=%s button=%s id=%s',
            mask_phone(to), template, language, body_params, (button_param or '').split('?')[0] + ('?…' if '?' in (button_param or '') else ''), message_id,
        )
        return message_id


class MetaCloudProvider:
    name = 'meta'

    def send_template(self, *, to, template, language, body_params, button_param=None):
        if not settings.WHATSAPP_ACCESS_TOKEN or not settings.WHATSAPP_PHONE_NUMBER_ID:
            raise WhatsAppError('WhatsApp is set to Meta but WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID are missing.', retryable=False)
        components = [{
            'type': 'body',
            'parameters': [{'type': 'text', 'text': str(value)[:1000]} for value in body_params],
        }]
        if button_param:
            components.append({
                'type': 'button', 'sub_type': 'url', 'index': '0',
                'parameters': [{'type': 'text', 'text': button_param}],
            })
        url = f'https://graph.facebook.com/{settings.WHATSAPP_GRAPH_API_VERSION}/{settings.WHATSAPP_PHONE_NUMBER_ID}/messages'
        try:
            response = requests.post(
                url,
                json={
                    'messaging_product': 'whatsapp', 'to': to.lstrip('+'), 'type': 'template',
                    'template': {'name': template, 'language': {'code': language}, 'components': components},
                },
                headers={'Authorization': f'Bearer {settings.WHATSAPP_ACCESS_TOKEN}'},
                timeout=settings.WHATSAPP_REQUEST_TIMEOUT_SECONDS,
            )
        except requests.RequestException as exc:
            raise WhatsAppError(f'Could not reach WhatsApp: {exc}') from exc
        data = {}
        try:
            data = response.json()
        except ValueError:
            pass
        if response.status_code >= 400:
            error = data.get('error', {}) if isinstance(data, dict) else {}
            code = error.get('code')
            # Rate limits and Meta-side errors are worth retrying; bad numbers, templates or auth are not.
            retryable = response.status_code >= 500 or response.status_code == 429 or code in (4, 80007, 130429, 131016, 131056)
            raise WhatsAppError(
                f"WhatsApp error {code or response.status_code}: {error.get('message') or response.text[:300]}",
                retryable=retryable, code=code,
            )
        try:
            return data['messages'][0]['id']
        except (KeyError, IndexError, TypeError) as exc:
            raise WhatsAppError('WhatsApp accepted the request but returned no message id.') from exc


PROVIDERS = {'log': LogProvider, 'meta': MetaCloudProvider}


def get_provider():
    try:
        return PROVIDERS[settings.WHATSAPP_PROVIDER]()
    except KeyError as exc:
        raise WhatsAppError(f'Unknown WHATSAPP_PROVIDER "{settings.WHATSAPP_PROVIDER}".', retryable=False) from exc


def valid_webhook_signature(*, body, signature):
    """Meta signs webhook bodies with the app secret (X-Hub-Signature-256: sha256=<hex>)."""
    secret = settings.WHATSAPP_APP_SECRET
    if not secret:
        # Test mode has no Meta app; only accept unsigned calls when not sending for real.
        return settings.WHATSAPP_PROVIDER == 'log'
    expected = 'sha256=' + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or '')
