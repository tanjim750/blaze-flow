"""Editor payout details: how each team member wants the agency to pay them.

Step 1 of editor payouts. Money never moves through Blaze Flow: the agency reads these
details and pays the editor itself, then records the payout by hand. Details live per
membership (so per workspace) and are encrypted with the gateway key (``crypto``).

Who may read them: the member themselves, and people holding billing.manage in that
workspace. Never clients, never other editors. Only the member may change their own.
"""
from __future__ import annotations

import re

from django.db import transaction

from ..gateways import crypto
from ..models import MemberPayoutMethod, PayoutMethodKind
from .audit import record_user_audit

MAX_METHODS = 8

# Field name -> (label, required, max length, kind). Order is the display order.
FIELDS: dict[str, list[tuple[str, str, bool, int, str]]] = {
    PayoutMethodKind.BANK_TRANSFER: [
        ('account_name', 'Account name', True, 140, 'text'),
        ('bank_name', 'Bank', True, 140, 'text'),
        ('account_number', 'Account number / IBAN', True, 64, 'text'),
        ('swift', 'SWIFT / routing', False, 34, 'text'),
        ('country', 'Country', False, 60, 'text'),
    ],
    PayoutMethodKind.WISE: [('email', 'Wise email', True, 254, 'email')],
    PayoutMethodKind.PAYONEER: [('email', 'Payoneer email', True, 254, 'email')],
    PayoutMethodKind.PAYPAL: [('email', 'PayPal email', True, 254, 'email')],
    PayoutMethodKind.BKASH_NAGAD: [('phone', 'bKash / Nagad number', True, 20, 'phone')],
    PayoutMethodKind.UPI: [('upi_id', 'UPI ID', True, 80, 'upi')],
    PayoutMethodKind.GCASH: [('phone', 'GCash number', True, 20, 'phone')],
    PayoutMethodKind.OTHER: [('details', 'How to pay you', True, 1000, 'text')],
}

EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
PHONE_RE = re.compile(r'^\+?[0-9][0-9 \-]{6,18}$')
UPI_RE = re.compile(r'^[A-Za-z0-9.\-_]{2,}@[A-Za-z]{2,}$')


class PayoutDetailsError(Exception):
    def __init__(self, message, field=None):
        super().__init__(message)
        self.field = field


def label(method: str) -> str:
    try:
        return PayoutMethodKind(method).label
    except ValueError:
        return method


def _clean(index: int, item) -> dict:
    if not isinstance(item, dict):
        raise PayoutDetailsError('Each payout method must be an object.')
    method = item.get('method')
    if method not in FIELDS:
        raise PayoutDetailsError('Choose a payout method.', field=f'methods.{index}.method')
    raw = item.get('details') or {}
    if not isinstance(raw, dict):
        raise PayoutDetailsError('Details must be an object.', field=f'methods.{index}.details')
    details = {}
    for name, field_label, required, max_length, kind in FIELDS[method]:
        value = str(raw.get(name) or '').strip()
        if not value:
            if required:
                raise PayoutDetailsError(f'{field_label} is required.', field=f'methods.{index}.{name}')
            continue
        if len(value) > max_length:
            raise PayoutDetailsError(f'{field_label} is too long.', field=f'methods.{index}.{name}')
        if kind == 'email' and not EMAIL_RE.match(value):
            raise PayoutDetailsError(f'{field_label} doesn’t look like an email.', field=f'methods.{index}.{name}')
        if kind == 'phone' and not PHONE_RE.match(value):
            raise PayoutDetailsError(f'{field_label} doesn’t look like a phone number.', field=f'methods.{index}.{name}')
        if kind == 'upi' and not UPI_RE.match(value):
            raise PayoutDetailsError('UPI ID looks like name@bank.', field=f'methods.{index}.{name}')
        details[name] = value
    return {'method': method, 'details': details, 'is_preferred': bool(item.get('is_preferred'))}


def _out(row: MemberPayoutMethod) -> dict:
    try:
        details = crypto.decrypt(row.encrypted_details)
        unreadable = False
    except (crypto.CredentialsUnreadable, crypto.EncryptionNotConfigured):
        details, unreadable = {}, True
    fields = [{'name': name, 'label': field_label, 'value': details.get(name, '')}
              for name, field_label, _req, _max, _kind in FIELDS.get(row.method, []) if details.get(name)]
    return {
        'id': str(row.id), 'method': row.method, 'label': label(row.method), 'is_preferred': row.is_preferred,
        'details': details, 'fields': fields, 'unreadable': unreadable, 'updated_at': row.updated_at,
    }


def methods_for(membership) -> list[dict]:
    return [_out(row) for row in MemberPayoutMethod.objects.filter(workspace_membership=membership)]


def preferred(membership_ids) -> dict:
    """membership id -> {'method', 'label'} of the preferred method. Reads no secrets."""
    rows = MemberPayoutMethod.objects.filter(workspace_membership_id__in=list(membership_ids)).order_by('-is_preferred', 'position', 'created_at')
    out = {}
    for row in rows:
        out.setdefault(str(row.workspace_membership_id), {'method': row.method, 'label': label(row.method)})
    return out


def payload(membership) -> dict:
    methods = methods_for(membership)
    return {
        'membership_id': str(membership.id),
        'methods': methods,
        'preferred': next((item for item in methods if item['is_preferred']), None),
        'encryption_configured': crypto.is_configured(),
    }


def replace_methods(*, membership, user, methods) -> dict:
    """Swap the member's saved methods for ``methods``. Exactly one ends up preferred."""
    if not isinstance(methods, list):
        raise PayoutDetailsError('Send a list of payout methods.')
    if len(methods) > MAX_METHODS:
        raise PayoutDetailsError(f'Save up to {MAX_METHODS} payout methods.')
    cleaned = [_clean(index, item) for index, item in enumerate(methods)]
    if cleaned:
        if not crypto.is_configured():
            raise crypto.EncryptionNotConfigured()
        preferred_index = next((index for index, item in enumerate(cleaned) if item['is_preferred']), 0)
        for index, item in enumerate(cleaned):
            item['is_preferred'] = index == preferred_index
    before = [row.method for row in MemberPayoutMethod.objects.filter(workspace_membership=membership)]
    with transaction.atomic():
        MemberPayoutMethod.objects.filter(workspace_membership=membership).delete()
        for index, item in enumerate(cleaned):
            MemberPayoutMethod.objects.create(
                workspace=membership.workspace, workspace_membership=membership, method=item['method'],
                is_preferred=item['is_preferred'], encrypted_details=crypto.encrypt(item['details']), position=index,
            )
        # Never log the details themselves: only which kinds of method changed.
        record_user_audit(
            user=user, workspace=membership.workspace, action='billing.payout_details.updated',
            entity_type='workspace_membership', entity_id=membership.id, team_only=True,
            metadata={'before': before, 'after': [item['method'] for item in cleaned],
                      'preferred': next((item['method'] for item in cleaned if item['is_preferred']), None)},
        )
    return payload(membership)
