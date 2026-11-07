"""Encrypt per-workspace gateway credentials at rest (Fernet, key from GATEWAY_ENCRYPTION_KEY).

``GATEWAY_ENCRYPTION_KEY`` may hold several comma-separated keys: the first encrypts, all
decrypt (MultiFernet), so a key can be rotated without losing saved credentials. Plaintext
credentials only ever exist in memory while a request talks to the gateway; API responses
carry ``mask()``ed values.
"""
from __future__ import annotations

import json

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from django.conf import settings


class EncryptionNotConfigured(Exception):
    def __init__(self):
        super().__init__('Gateway keys can’t be saved on this server yet: GATEWAY_ENCRYPTION_KEY is not set.')


class CredentialsUnreadable(Exception):
    pass


def is_configured() -> bool:
    return bool(_keys())


def _keys() -> list[str]:
    raw = getattr(settings, 'GATEWAY_ENCRYPTION_KEY', '') or ''
    return [key.strip() for key in raw.split(',') if key.strip()]


def _fernet() -> MultiFernet:
    keys = _keys()
    if not keys:
        raise EncryptionNotConfigured()
    return MultiFernet([Fernet(key.encode()) for key in keys])


def encrypt(data: dict) -> str:
    return _fernet().encrypt(json.dumps(data, sort_keys=True).encode()).decode()


def decrypt(token: str) -> dict:
    if not token:
        return {}
    try:
        return json.loads(_fernet().decrypt(token.encode()).decode())
    except (InvalidToken, ValueError) as exc:
        raise CredentialsUnreadable('Saved gateway keys can’t be read (was GATEWAY_ENCRYPTION_KEY changed?). Enter them again.') from exc


def mask(value: str | None) -> str:
    """'sk_test_abcdef1234' -> '••••1234'. Short values are fully hidden."""
    value = str(value or '')
    if not value:
        return ''
    if len(value) <= 8:
        return '••••'
    return '••••' + value[-4:]
