"""Stripe Connect: each workspace (agency) takes client invoice payments in its own Stripe account.

Design
------
* **Connected accounts: Accounts v2** (Stripe's recommendation for new platforms) with the
  ``merchant`` configuration, the **Express dashboard**, ``fees_collector=stripe`` and
  ``losses_collector=stripe``. The agency is the business of record: Stripe bills its fees to
  the agency and Stripe (not Blaze Flow) carries negative-balance risk.
* **Direct charges.** A Checkout Session is created *on the connected account*
  (``Stripe-Account`` header). The client pays the agency, the money lands in the agency's
  Stripe balance and pays out to the agency's bank; refunds and disputes come out of the
  agency's balance. Blaze Flow's optional cut is ``application_fee_amount``
  (``PLATFORM_FEE_PERCENT``). This is the charge type Stripe recommends for SaaS platforms
  that "enable invoice payments" (docs.stripe.com/connect/charges).
* Onboarding is Stripe-hosted (v2 Account Links). Status is read with the v1 Accounts API
  (``charges_enabled`` / ``payouts_enabled`` / ``requirements``), which works for v2 accounts.
* Webhooks are verified with the endpoint signing secret, recorded once per event id, and
  money only ever moves through ``billing.record_payment`` / ``billing.record_refund``
  (idempotent on the PaymentIntent id).

Everything here is optional: with no ``STRIPE_SECRET_KEY`` the API reports
``configured: false`` and the UI says "Stripe not configured on this server".
"""
from __future__ import annotations

import json
import logging
import secrets
from decimal import ROUND_DOWN, Decimal, InvalidOperation

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from app.models import (
    Invoice, InvoiceStatus, Payment, PaymentMethod, PaymentProvider, StripeConnectAccount, StripeConnectStatus,
    StripeWebhookEvent,
)
from app.stripe_currencies import from_minor_units, is_zero_decimal, stripe_supports, to_minor_units

from . import billing
from .audit import record_user_audit

logger = logging.getLogger(__name__)

NOT_CONFIGURED = 'Stripe not configured on this server.'


class StripeNotConfigured(Exception):
    pass


class StripeConnectError(Exception):
    def __init__(self, message, *, status=400):
        super().__init__(message)
        self.status = status


class WebhookSignatureError(Exception):
    pass


# --- configuration ------------------------------------------------------------------------

def is_configured() -> bool:
    return bool(settings.STRIPE_SECRET_KEY)


def platform_fee_percent() -> Decimal:
    try:
        value = Decimal(str(settings.PLATFORM_FEE_PERCENT or '0'))
    except (InvalidOperation, ValueError):
        return Decimal('0')
    return min(max(value, Decimal('0')), Decimal('100'))


def get_client():
    """The official stripe-python client. Patched in tests; nothing else talks to Stripe."""
    if not is_configured():
        raise StripeNotConfigured(NOT_CONFIGURED)
    import stripe  # imported lazily so the app runs without the package or keys
    return stripe.StripeClient(
        settings.STRIPE_SECRET_KEY, max_network_retries=2,
        http_client=stripe.RequestsClient(timeout=settings.STRIPE_REQUEST_TIMEOUT_SECONDS),
    )


def _stripe_error_message(exc) -> str:
    message = getattr(exc, 'user_message', None) or str(exc) or 'Stripe could not complete that request.'
    return f'Stripe: {message}'


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except StripeNotConfigured:
        raise
    except Exception as exc:  # stripe.StripeError and network errors
        if type(exc).__module__.startswith('stripe'):
            logger.warning('stripe call failed: %s', exc)
            raise StripeConnectError(_stripe_error_message(exc), status=502) from exc
        raise


def _get(obj, *path, default=None):
    """Read a field from a StripeObject or plain dict (webhook payloads are dicts)."""
    for key in path:
        if obj is None:
            return default
        try:
            obj = obj[key]
        except (KeyError, TypeError, IndexError):
            obj = getattr(obj, key, None)
    return default if obj is None else obj


def _audit(*, user, workspace, action, entity_id, **metadata):
    return record_user_audit(user=user, workspace=workspace, action=action, entity_type='stripe_account',
                             entity_id=entity_id, metadata=metadata, team_only=True)


# --- connected account --------------------------------------------------------------------

def connect_url(path: str) -> str:
    return f"{settings.APP_BASE_URL.rstrip('/')}{path}"


def account_for(workspace) -> StripeConnectAccount | None:
    return StripeConnectAccount.objects.filter(workspace=workspace).first()


def status_out(workspace, *, can_manage=False) -> dict:
    account = account_for(workspace)
    data = {
        'configured': is_configured(), 'not_configured_message': None if is_configured() else NOT_CONFIGURED,
        'connected': account is not None, 'can_manage': bool(can_manage),
        'platform_fee_percent': str(platform_fee_percent().normalize()) if platform_fee_percent() else '0',
        'status': 'not_connected', 'charges_enabled': False, 'payouts_enabled': False, 'details_submitted': False,
        'requirements_due': [], 'disabled_reason': '', 'account_id': None, 'country': '', 'default_currency': '',
        'last_synced_at': None,
    }
    if account is not None:
        data.update({
            'status': account.status, 'charges_enabled': account.charges_enabled, 'payouts_enabled': account.payouts_enabled,
            'details_submitted': account.details_submitted, 'requirements_due': list(account.requirements_due or []),
            'disabled_reason': account.disabled_reason,
            # Only the last few characters: enough to match it in the Stripe dashboard.
            'account_id': f'…{account.stripe_account_id[-6:]}' if can_manage else None,
            'country': account.country, 'default_currency': account.default_currency, 'last_synced_at': account.last_synced_at,
        })
    return data


def derive_status(*, charges_enabled, details_submitted, requirements_due, disabled_reason) -> str:
    reason = (disabled_reason or '').lower()
    if reason.startswith('rejected'):
        return StripeConnectStatus.DISABLED
    if charges_enabled and not requirements_due:
        return StripeConnectStatus.ACTIVE
    if charges_enabled:
        # Still taking payments, but Stripe wants something before a deadline.
        return StripeConnectStatus.NEEDS_INFO
    if not details_submitted:
        return StripeConnectStatus.ONBOARDING
    if requirements_due:
        return StripeConnectStatus.NEEDS_INFO
    return StripeConnectStatus.PENDING


def apply_account_snapshot(account: StripeConnectAccount, remote) -> StripeConnectAccount:
    """Copy a v1 Account object (API response or account.updated payload) onto our row."""
    requirements = _get(remote, 'requirements') or {}
    due = sorted(set(list(_get(requirements, 'currently_due', default=[]) or []) + list(_get(requirements, 'past_due', default=[]) or [])))
    previous = account.status
    account.charges_enabled = bool(_get(remote, 'charges_enabled', default=False))
    account.payouts_enabled = bool(_get(remote, 'payouts_enabled', default=False))
    account.details_submitted = bool(_get(remote, 'details_submitted', default=False))
    account.requirements_due = due[:50]
    account.disabled_reason = str(_get(requirements, 'disabled_reason', default='') or '')[:255]
    account.country = str(_get(remote, 'country', default='') or '')[:2].upper()
    account.default_currency = str(_get(remote, 'default_currency', default='') or '')[:3].upper()
    account.status = derive_status(charges_enabled=account.charges_enabled, details_submitted=account.details_submitted,
                                   requirements_due=due, disabled_reason=account.disabled_reason)
    account.last_synced_at = timezone.now()
    account.save()
    if account.status != previous:
        _audit(user=None, workspace=account.workspace, action='billing.stripe.status_changed', entity_id=account.workspace_id,
               status=account.status, previous_status=previous, charges_enabled=account.charges_enabled,
               payouts_enabled=account.payouts_enabled)
    return account


def sync_account(account: StripeConnectAccount) -> StripeConnectAccount:
    client = get_client()
    remote = _call(client.v1.accounts.retrieve, account.stripe_account_id)
    return apply_account_snapshot(account, remote)


def _create_remote_account(workspace, user):
    client = get_client()
    params = {
        'display_name': workspace.name[:100],
        'dashboard': 'express',
        'defaults': {
            'currency': billing.workspace_currency(workspace).lower(),
            'responsibilities': {'fees_collector': 'stripe', 'losses_collector': 'stripe'},
        },
        'configuration': {'merchant': {'capabilities': {'card_payments': {'requested': True}}}},
        'metadata': {'blazeflow_workspace_id': str(workspace.id)},
    }
    if getattr(user, 'email', None):
        params['contact_email'] = user.email
    return _call(client.v2.core.accounts.create, params)


def onboarding_link(account: StripeConnectAccount) -> str:
    client = get_client()
    link = _call(client.v2.core.account_links.create, {
        'account': account.stripe_account_id,
        'use_case': {
            'type': 'account_onboarding' if not account.details_submitted else 'account_update',
            ('account_onboarding' if not account.details_submitted else 'account_update'): {
                'refresh_url': connect_url('/settings?stripe=refresh#billing'),
                'return_url': connect_url('/settings?stripe=return#billing'),
                'collection_options': {'fields': 'eventually_due'},
            },
        },
    })
    return _get(link, 'url')


def start_onboarding(*, workspace, user) -> str:
    """Create the agency's Stripe account the first time, then a fresh hosted onboarding link."""
    if not is_configured():
        raise StripeNotConfigured(NOT_CONFIGURED)
    account = account_for(workspace)
    if account is None:
        remote = _create_remote_account(workspace, user)
        try:
            with transaction.atomic():
                account = StripeConnectAccount.objects.create(
                    workspace=workspace, stripe_account_id=_get(remote, 'id'), connected_by_user=user,
                )
        except IntegrityError:
            # Another click won the race; use its account.
            account = StripeConnectAccount.objects.get(workspace=workspace)
        else:
            _audit(user=user, workspace=workspace, action='billing.stripe.connected', entity_id=workspace.id,
                   stripe_account=account.stripe_account_id)
    return onboarding_link(account)


def dashboard_link(*, workspace, user) -> str:
    account = account_for(workspace)
    if account is None:
        raise StripeConnectError('Connect Stripe first.', status=409)
    if not account.details_submitted:
        raise StripeConnectError('Finish Stripe onboarding first.', status=409)
    client = get_client()
    link = _call(client.v1.accounts.login_links.create, account.stripe_account_id)
    _audit(user=user, workspace=workspace, action='billing.stripe.dashboard_opened', entity_id=workspace.id)
    return _get(link, 'url')


def disconnect(*, workspace, user) -> None:
    """Unlink the agency's Stripe account from this workspace.

    The Stripe account itself is the agency's and stays open (with its balance and payouts);
    Blaze Flow simply stops offering Pay now. Payments already recorded are kept.
    """
    account = account_for(workspace)
    if account is None:
        return
    stripe_id = account.stripe_account_id
    account.delete()
    _audit(user=user, workspace=workspace, action='billing.stripe.disconnected', entity_id=workspace.id, stripe_account=stripe_id)


# --- invoices -----------------------------------------------------------------------------

def ensure_pay_token(invoice: Invoice) -> str:
    if not invoice.pay_token:
        invoice.pay_token = secrets.token_urlsafe(24)
        invoice.save(update_fields=['pay_token', 'updated_at'])
    return invoice.pay_token


def online_payment(invoice: Invoice, *, outstanding=None) -> dict:
    """Can the client pay this invoice online right now, and if not, why (for a clear note)."""
    if outstanding is None:
        outstanding = billing.invoice_total(invoice) - billing.invoice_paid(invoice)
    out = {'provider': 'stripe', 'available': False, 'reason': None}
    if not is_configured():
        out['reason'] = 'not_configured'
        return out
    account = account_for(invoice.workspace)
    if account is None:
        out['reason'] = 'not_connected'
    elif not account.charges_enabled:
        out['reason'] = 'account_not_active'
    elif invoice.status == InvoiceStatus.DRAFT:
        out['reason'] = 'draft'
    elif outstanding <= 0:
        out['reason'] = 'nothing_due'
    elif not stripe_supports(invoice.currency):
        out['reason'] = 'currency_unsupported'
        out['message'] = f'Stripe can’t take payments in {invoice.currency}. Pay by bank transfer or ask the studio for another way to pay.'
    else:
        out['available'] = True
    return out


def application_fee(minor_amount: int) -> int:
    percent = platform_fee_percent()
    if percent <= 0:
        return 0
    return int((Decimal(minor_amount) * percent / Decimal('100')).to_integral_value(rounding=ROUND_DOWN))


def create_checkout(*, invoice: Invoice, success_url: str, cancel_url: str, customer_email: str | None = None, user=None) -> str:
    """A Stripe Checkout Session for what is still outstanding, as a direct charge on the agency's account."""
    outstanding = billing.invoice_total(invoice) - billing.invoice_paid(invoice)
    state = online_payment(invoice, outstanding=outstanding)
    if not state['available']:
        messages = {
            'not_configured': NOT_CONFIGURED, 'not_connected': 'This studio has not connected Stripe yet.',
            'account_not_active': 'This studio’s Stripe account is not ready to take payments yet.',
            'draft': 'This invoice has not been sent yet.', 'nothing_due': 'This invoice is already paid.',
        }
        raise StripeConnectError(state.get('message') or messages.get(state['reason'], 'Online payment is not available.'), status=409)
    account = account_for(invoice.workspace)
    currency = invoice.currency.upper()
    unit_amount = to_minor_units(outstanding, currency)
    metadata = {'blazeflow_invoice_id': str(invoice.id), 'blazeflow_workspace_id': str(invoice.workspace_id),
                'invoice_number': invoice.number}
    payment_intent_data = {'metadata': metadata, 'description': f'Invoice {invoice.number}'}
    fee = application_fee(unit_amount)
    if fee > 0:
        payment_intent_data['application_fee_amount'] = fee
    params = {
        'mode': 'payment',
        'line_items': [{'quantity': 1, 'price_data': {
            'currency': currency.lower(), 'unit_amount': unit_amount,
            'product_data': {'name': f'Invoice {invoice.number}', 'description': (invoice.project.name if invoice.project_id else invoice.client_team.name)[:200]},
        }}],
        'client_reference_id': str(invoice.id),
        'metadata': metadata,
        'payment_intent_data': payment_intent_data,
        'success_url': success_url,
        'cancel_url': cancel_url,
    }
    email = customer_email or invoice.client_team.email
    if email:
        params['customer_email'] = email
    client = get_client()
    session = _call(client.v1.checkout.sessions.create, params, {'stripe_account': account.stripe_account_id})
    record_user_audit(user=user, workspace=invoice.workspace, action='billing.stripe.checkout_created', entity_type='invoice',
                      entity_id=invoice.id, metadata={'amount': billing.money_str(outstanding), 'currency': currency,
                                                      'zero_decimal': is_zero_decimal(currency), 'unit_amount': unit_amount,
                                                      'application_fee_amount': fee}, team_only=True)
    return _get(session, 'url')


# --- webhooks -----------------------------------------------------------------------------

def _secrets():
    return [secret.strip() for secret in (settings.STRIPE_WEBHOOK_SECRET or '').split(',') if secret.strip()]


def verify_signature(payload: bytes, sig_header: str | None) -> dict:
    secrets_ = _secrets()
    if not secrets_:
        raise StripeNotConfigured('Stripe webhooks are not configured on this server.')
    if not sig_header:
        raise WebhookSignatureError('Missing Stripe-Signature header.')
    import stripe
    text = payload.decode('utf-8') if isinstance(payload, bytes) else payload
    last = None
    for secret in secrets_:
        try:
            stripe.WebhookSignature.verify_header(text, sig_header, secret, stripe.Webhook.DEFAULT_TOLERANCE)
            break
        except stripe.SignatureVerificationError as exc:
            last = exc
    else:
        raise WebhookSignatureError(str(last) if last else 'Invalid signature.')
    try:
        return json.loads(text)
    except ValueError as exc:
        raise WebhookSignatureError('Invalid JSON payload.') from exc


def handle_webhook(payload: bytes, sig_header: str | None) -> str:
    """Verify, de-duplicate and apply one Stripe event. Returns a short outcome for the log."""
    event = verify_signature(payload, sig_header)
    event_id = event.get('id')
    event_type = event.get('type') or ''
    if not event_id:
        raise WebhookSignatureError('Event has no id.')
    if StripeWebhookEvent.objects.filter(event_id=event_id).exists():
        return 'duplicate'
    with transaction.atomic():
        try:
            StripeWebhookEvent.objects.create(event_id=event_id, type=event_type[:100], stripe_account_id=str(event.get('account') or '')[:255])
        except IntegrityError:
            return 'duplicate'
        return dispatch(event)


def dispatch(event: dict) -> str:
    event_type = event.get('type') or ''
    obj = _get(event, 'data', 'object') or {}
    account_id = event.get('account') or event.get('context')
    if event.get('object') == 'v2.core.event' or event_type.startswith('v2.core.account'):
        # Thin event from an Accounts v2 event destination: fetch the account's current state.
        related = _get(event, 'related_object', 'id') or account_id
        account = StripeConnectAccount.objects.filter(stripe_account_id=related).first()
        if account is not None and is_configured():
            sync_account(account)
            return 'account_synced'
        return 'ignored'
    if event_type == 'account.updated':
        account = StripeConnectAccount.objects.filter(stripe_account_id=_get(obj, 'id')).first()
        if account is None:
            return 'ignored'
        apply_account_snapshot(account, obj)
        return 'account_updated'
    if event_type in ('checkout.session.completed', 'checkout.session.async_payment_succeeded'):
        if _get(obj, 'payment_status') != 'paid':
            return 'awaiting_payment'
        return _record_invoice_payment(
            account_id=account_id, metadata=_get(obj, 'metadata') or {}, amount_minor=_get(obj, 'amount_total'),
            currency=_get(obj, 'currency'), reference=_get(obj, 'payment_intent') or _get(obj, 'id'), event_id=event.get('id'),
        )
    if event_type == 'payment_intent.succeeded':
        return _record_invoice_payment(
            account_id=account_id, metadata=_get(obj, 'metadata') or {}, amount_minor=_get(obj, 'amount_received') or _get(obj, 'amount'),
            currency=_get(obj, 'currency'), reference=_get(obj, 'id'), event_id=event.get('id'),
        )
    if event_type == 'charge.refunded':
        reference = _get(obj, 'payment_intent')
        payment = Payment.objects.filter(provider=PaymentProvider.STRIPE, provider_reference=reference).select_related('workspace', 'invoice').first() if reference else None
        if payment is None:
            return 'ignored'
        billing.record_refund(payment=payment, refunded_total=from_minor_units(_get(obj, 'amount_refunded', default=0), payment.currency),
                              provider_reference=_get(obj, 'id'))
        return 'refund_recorded'
    return 'ignored'


def _record_invoice_payment(*, account_id, metadata, amount_minor, currency, reference, event_id) -> str:
    invoice_id = _get(metadata, 'blazeflow_invoice_id')
    if not invoice_id or not reference or amount_minor is None:
        return 'ignored'
    invoice = Invoice.objects.select_related('workspace').filter(id=invoice_id).first()
    if invoice is None:
        logger.warning('stripe event %s names unknown invoice %s', event_id, invoice_id)
        return 'unknown_invoice'
    account = account_for(invoice.workspace)
    # The money must have landed in this invoice's workspace's own account.
    if account is None or account.stripe_account_id != account_id:
        logger.warning('stripe event %s account %s does not own invoice %s', event_id, account_id, invoice_id)
        return 'account_mismatch'
    from .online_payments import record_invoice_payment  # shared by every gateway
    if str(currency or '').upper() != invoice.currency.upper():
        logger.warning('stripe event %s currency %s != invoice %s', event_id, currency, invoice.currency)
        return 'currency_mismatch'
    return record_invoice_payment(
        invoice=invoice, provider=PaymentProvider.STRIPE, amount=from_minor_units(int(amount_minor), invoice.currency),
        currency=currency, reference=reference, event_id=event_id, note='Paid online with Stripe',
        method=PaymentMethod.CARD, reference_key='payment_intent',
    )
