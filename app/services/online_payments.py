"""Online invoice payments across gateways: Stripe Connect plus the local gateways.

One place for everything gateways share:
- which gateways a workspace can use and which are recommended for its country,
- saving / testing / enabling a workspace's own merchant keys (encrypted, masked),
- the Pay now options on an invoice (the client chooses when several are enabled),
- creating a hosted checkout, the webhook/IPN route and the payer's return,
- ``record_invoice_payment``: the shared rules before ``billing.record_payment`` (currency must
  match, a provider reference is recorded once, never more than the amount owed), used by
  Stripe and every local gateway alike.
"""
from __future__ import annotations

import logging
import uuid
from decimal import Decimal

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from app.gateways import MANUAL_PROVIDERS, PROVIDERS, GatewayError, PaymentEvent, WebhookRejected, get_manual, get_provider
from app.gateways import crypto
from app.models import (
    GatewayCheckout, GatewayConnection, GatewayConnectionStatus, GatewayMode, GatewayWebhookEvent, Invoice, InvoiceStatus,
    Payment, PaymentClaim, PaymentClaimStatus, PaymentMethod, WorkspaceProfile,
)

from . import billing
from .audit import record_user_audit

logger = logging.getLogger(__name__)

# Recommended first in Settings > Billing for a workspace in this country. Any gateway can
# still be enabled anywhere its currency fits.
STRIPE_COUNTRIES = {
    'US', 'GB', 'AU', 'CA', 'NZ', 'IE', 'IS', 'NO', 'CH', 'LI',
    # EU member states
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL',
    'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
}
# A checkout attempt's own state (not the invoice's; only billing.record_payment marks that).
CHECKOUT_SETTLED = 'paid'

LOCAL_BY_COUNTRY = {'PH': 'paymongo', 'PK': 'safepay', 'BD': 'sslcommerz'}
# Settings > Billing groups: the main gateways at the top, local ones in a collapsed section.
MAIN_GATEWAYS = ('stripe', 'paypal', 'wise', 'payoneer')
LOCAL_GATEWAYS = ('paymongo', 'safepay', 'sslcommerz', 'razorpay')


class OnlinePaymentError(Exception):
    def __init__(self, message, *, status=409, code=None):
        super().__init__(message)
        self.status = status
        self.code = code


def _audit(*, user, workspace, action, entity_id, **metadata):
    return record_user_audit(user=user, workspace=workspace, action=action, entity_type='payment_gateway',
                             entity_id=entity_id, metadata=metadata, team_only=True)


def api_url(path: str) -> str:
    base = getattr(settings, 'API_PUBLIC_URL', '') or settings.APP_BASE_URL
    return f'{base.rstrip("/")}{path}'


def app_url(path: str) -> str:
    return f'{settings.APP_BASE_URL.rstrip("/")}{path}'


# --- country & recommendations ----------------------------------------------------------------

def workspace_country(workspace) -> str:
    country = (billing.billing_settings(workspace).country or '').upper()
    if not country:
        profile = WorkspaceProfile.objects.filter(workspace=workspace).only('country_code').first()
        country = (getattr(profile, 'country_code', '') or '').upper()
    return country


def recommended_for(country: str) -> list[str]:
    country = (country or '').upper()
    if country in LOCAL_BY_COUNTRY:
        return [LOCAL_BY_COUNTRY[country]]
    if country in STRIPE_COUNTRIES:
        return ['stripe']
    return []


# --- connections ----------------------------------------------------------------------------------

def connection_for(workspace, provider_key) -> GatewayConnection | None:
    return GatewayConnection.objects.filter(workspace=workspace, provider=provider_key).first()


def _credentials(connection) -> dict:
    return crypto.decrypt(connection.credentials) if connection and connection.credentials else {}


def webhook_url(connection) -> str:
    return api_url(f'/api/payments/{connection.provider}/webhook/{connection.id}/')


def connection_out(provider, connection, *, workspace_currency=None) -> dict:
    """Everything the settings card needs. Secrets are masked; nothing here can be used to pay."""
    out = {
        **provider.info(), 'status': 'available', 'kind': 'merchant_keys', 'features': list(provider.methods),
        'supports_workspace_currency': (workspace_currency or '') in provider.currencies,
        'encryption_configured': crypto.is_configured(),
        'connected': False, 'enabled': False, 'mode': GatewayMode.SANDBOX, 'connection_status': 'not_connected',
        'status_message': '', 'last_tested_at': None, 'credentials': {}, 'webhook_url': None,
        'group': 'main' if provider.key in MAIN_GATEWAYS else 'local', 'automatic': True,
        'unsupported_countries': list(getattr(provider, 'unsupported_countries', ())),
    }
    if connection is None:
        return out
    try:
        saved = _credentials(connection)
        unreadable = False
    except crypto.CredentialsUnreadable:
        saved, unreadable = {}, True
    except crypto.EncryptionNotConfigured:
        saved, unreadable = {}, True
    out.update({
        'connected': bool(connection.credentials), 'enabled': connection.enabled, 'mode': connection.mode,
        'connection_status': 'unreadable' if unreadable else connection.status,
        'status_message': connection.status_message,
        'last_tested_at': connection.last_tested_at.isoformat() if connection.last_tested_at else None,
        'credentials': {f.name: (crypto.mask(saved.get(f.name)) if f.secret else saved.get(f.name, '')) for f in provider.credential_fields
                        if saved.get(f.name)},
        'webhook_url': webhook_url(connection),
        'details': {k: v for k, v in (connection.details or {}).items() if k in ('payment_methods',)},
    })
    return out


def manual_out(provider, connection) -> dict:
    """The Wise / Payoneer card: what the agency saved (shown to its clients, so not secret)."""
    details = (connection.details or {}) if connection is not None else {}
    return {
        **provider.info(), 'status': 'available', 'kind': 'manual', 'group': 'main', 'automatic': False,
        'features': list(provider.methods), 'supports_workspace_currency': True,
        'connected': bool(connection is not None and (details.get('accounts') or details.get('payment_link'))),
        'enabled': bool(connection is not None and connection.enabled),
        'payment_link': details.get('payment_link', ''), 'accounts': details.get('accounts', []), 'note': details.get('note', ''),
    }


def save_manual(*, workspace, provider_key, user, data: dict) -> GatewayConnection:
    provider = get_manual(provider_key)
    if provider is None:
        raise OnlinePaymentError('Unknown payment gateway.', status=404)
    try:
        cleaned = provider.clean(data or {})
    except GatewayError as exc:
        raise OnlinePaymentError(str(exc), status=exc.status) from exc
    connection = connection_for(workspace, provider.key) or GatewayConnection(workspace=workspace, provider=provider.key)
    connection.mode = GatewayMode.LIVE
    connection.credentials = ''
    connection.details = cleaned
    connection.status = GatewayConnectionStatus.CONNECTED
    connection.status_message = ''
    connection.updated_by_user = user
    connection.save()
    _audit(user=user, workspace=workspace, action=f'billing.{provider.key}.details_saved', entity_id=connection.id,
           currencies=[a['currency'] for a in cleaned['accounts']], has_link=bool(cleaned['payment_link']))
    return connection


def save_connection(*, workspace, provider_key, user, mode, credentials: dict) -> GatewayConnection:
    provider = get_provider(provider_key)
    if provider is None:
        raise OnlinePaymentError('Unknown payment gateway.', status=404)
    if mode not in GatewayMode.values:
        raise OnlinePaymentError('Mode is sandbox or live.', status=400)
    if not crypto.is_configured():
        raise OnlinePaymentError(str(crypto.EncryptionNotConfigured()), status=503, code='encryption_not_configured')
    connection = connection_for(workspace, provider.key)
    try:
        saved = _credentials(connection)
    except crypto.CredentialsUnreadable:
        saved = {}
    try:
        cleaned = provider.clean_credentials(credentials or {}, saved if (connection and connection.mode == mode) else {}, mode)
    except GatewayError as exc:
        raise OnlinePaymentError(str(exc), status=exc.status) from exc
    changed = sorted(k for k in cleaned if cleaned.get(k) != saved.get(k))
    if connection is None:
        connection = GatewayConnection(workspace=workspace, provider=provider.key)
    mode_changed = connection.mode != mode
    connection.mode = mode
    connection.credentials = crypto.encrypt(cleaned)
    if changed or mode_changed or connection._state.adding:
        # New keys must pass Test connection again before clients can pay with them.
        connection.status = GatewayConnectionStatus.UNTESTED
        connection.status_message = ''
        connection.enabled = False
        connection.details = {}
    connection.updated_by_user = user
    connection.save()
    _audit(user=user, workspace=workspace, action=f'billing.{provider.key}.keys_saved', entity_id=connection.id,
           mode=mode, fields_changed=changed)  # names only, never values
    return connection


def test_connection(*, workspace, provider_key, user) -> GatewayConnection:
    provider = get_provider(provider_key)
    connection = connection_for(workspace, provider_key) if provider else None
    if connection is None or not connection.credentials:
        raise OnlinePaymentError('Save your keys first.', status=400)
    try:
        credentials = _credentials(connection)
        details = provider.test_connection(connection, credentials)
    except (crypto.CredentialsUnreadable, crypto.EncryptionNotConfigured) as exc:
        connection.status, connection.status_message = GatewayConnectionStatus.FAILED, str(exc)
        details = None
    except GatewayError as exc:
        connection.status, connection.status_message = GatewayConnectionStatus.FAILED, str(exc)[:500]
        details = None
    else:
        connection.status, connection.status_message = GatewayConnectionStatus.CONNECTED, ''
        connection.details = details or {}
    if connection.status != GatewayConnectionStatus.CONNECTED:
        connection.enabled = False
    connection.last_tested_at = timezone.now()
    connection.save()
    _audit(user=user, workspace=workspace, action=f'billing.{provider.key}.connection_tested', entity_id=connection.id,
           ok=connection.status == GatewayConnectionStatus.CONNECTED, mode=connection.mode)
    return connection


def set_enabled(*, workspace, provider_key, user, enabled: bool) -> GatewayConnection:
    connection = connection_for(workspace, provider_key)
    if connection is None:
        raise OnlinePaymentError('Save your keys first.', status=400)
    if enabled and connection.status != GatewayConnectionStatus.CONNECTED:
        if get_manual(provider_key):
            raise OnlinePaymentError('Save your payment details first.', status=400)
        raise OnlinePaymentError('Run Test connection successfully before turning this gateway on.', status=409)
    connection.enabled = bool(enabled)
    connection.updated_by_user = user
    connection.save(update_fields=['enabled', 'updated_by_user', 'updated_at'])
    _audit(user=user, workspace=workspace, action=f'billing.{provider_key}.{"enabled" if enabled else "disabled"}',
           entity_id=connection.id, mode=connection.mode)
    return connection


def delete_connection(*, workspace, provider_key, user) -> None:
    connection = connection_for(workspace, provider_key)
    if connection is None:
        return
    _audit(user=user, workspace=workspace, action=f'billing.{provider_key}.disconnected', entity_id=connection.id)
    connection.delete()


# --- Pay now options --------------------------------------------------------------------------------

def _outstanding(invoice):
    return billing.invoice_total(invoice) - billing.invoice_paid(invoice)


def local_option(invoice, provider, connection, *, outstanding) -> dict:
    out = {'provider': provider.key, 'name': provider.name, 'available': False, 'reason': None, 'methods': list(provider.methods)}
    if connection is None or not connection.enabled:
        out['reason'] = 'not_enabled'
    elif connection.status != GatewayConnectionStatus.CONNECTED:
        out['reason'] = 'not_connected'
    elif invoice.status == InvoiceStatus.DRAFT:
        out['reason'] = 'draft'
    elif outstanding <= 0:
        out['reason'] = 'nothing_due'
    elif invoice.currency.upper() not in provider.currencies:
        out['reason'] = 'currency_unsupported'
        out['message'] = f'{provider.name} only takes payments in {"/".join(provider.currencies)}, and this invoice is in {invoice.currency}.'
    elif provider.min_amount is not None and outstanding < provider.min_amount:
        out['reason'] = 'amount_out_of_range'
        out['message'] = f'{provider.name} takes payments from {provider.min_amount:,.2f} {provider.currencies[0]}.'
    elif provider.max_amount is not None and outstanding > provider.max_amount:
        out['reason'] = 'amount_out_of_range'
        out['message'] = f'{provider.name} takes up to {provider.max_amount:,.2f} {provider.currencies[0]} per payment.'
    else:
        out['available'] = True
    if connection is not None and connection.mode == GatewayMode.SANDBOX:
        out['sandbox'] = True
    return out


def payment_options(invoice, *, outstanding=None) -> list[dict]:
    """Each gateway the studio has turned on (or connected, for Stripe), with whether it can take this invoice."""
    from . import stripe_connect
    if outstanding is None:
        outstanding = _outstanding(invoice)
    options = []
    stripe = stripe_connect.online_payment(invoice, outstanding=outstanding)
    if stripe_connect.is_configured() and stripe_connect.account_for(invoice.workspace) is not None:
        options.append({**stripe, 'name': 'Stripe', 'methods': ['Cards', 'Wallets']})
    connections = {c.provider: c for c in GatewayConnection.objects.filter(workspace_id=invoice.workspace_id, enabled=True)}
    for key in ('paypal',):
        if key in connections:
            options.append(local_option(invoice, PROVIDERS[key], connections[key], outstanding=outstanding))
    for key, provider in MANUAL_PROVIDERS.items():
        if key in connections:
            options.append(manual_option(invoice, provider, connections[key], outstanding=outstanding))
    for key, provider in PROVIDERS.items():
        if key in connections and key != 'paypal':
            options.append(local_option(invoice, provider, connections[key], outstanding=outstanding))
    return options


def manual_option(invoice, provider, connection, *, outstanding) -> dict:
    """Pay by Wise / Payoneer: instructions, not a checkout. Never automatic."""
    details = connection.details or {}
    currency = invoice.currency.upper()
    account = next((a for a in details.get('accounts') or [] if a.get('currency') == currency), None)
    link = provider.link_for(details, amount=billing.money_str(max(outstanding, Decimal(0))), currency=currency)
    out = {'provider': provider.key, 'name': provider.name, 'kind': 'manual', 'available': False, 'reason': None,
           'methods': list(provider.methods), 'automatic': False}
    if invoice.status == InvoiceStatus.DRAFT:
        out['reason'] = 'draft'
    elif outstanding <= 0:
        out['reason'] = 'nothing_due'
    elif not account and not link:
        out['reason'] = 'currency_unsupported'
        out['message'] = f'No {provider.name} details for {currency} yet.'
    else:
        out['available'] = True
        pending = PaymentClaim.objects.filter(invoice=invoice, provider=provider.key, status=PaymentClaimStatus.PENDING).first()
        out['instructions'] = {
            'reference': invoice.number, 'amount': billing.money_str(outstanding), 'currency': currency,
            'account_details': account['details'] if account else '', 'payment_link': link,
            'link_label': provider.link_label, 'note': details.get('note', ''),
            'pending_claim': claim_out(pending) if pending else None,
        }
    return out


# --- "I've paid" claims (Wise / Payoneer) ---------------------------------------------------------

def claim_out(claim) -> dict:
    return {'id': str(claim.id), 'provider': claim.provider, 'amount': billing.money_str(claim.amount), 'currency': claim.currency,
            'payer_name': claim.payer_name, 'payer_reference': claim.payer_reference, 'status': claim.status,
            'created_at': claim.created_at.isoformat() if claim.created_at else None}


def create_claim(*, invoice, provider_key, payer_name='', payer_reference='', user=None) -> PaymentClaim:
    provider = get_manual(provider_key)
    option = next((o for o in payment_options(invoice) if o['provider'] == provider_key), None) if provider else None
    if option is None:
        raise OnlinePaymentError('That payment method isn’t turned on for this invoice.', status=409, code='not_enabled')
    if not option['available']:
        raise OnlinePaymentError(option.get('message') or 'Nothing to pay on this invoice.', status=409, code=option['reason'])
    existing = PaymentClaim.objects.filter(invoice=invoice, provider=provider.key, status=PaymentClaimStatus.PENDING).first()
    if existing:
        return existing
    claim = PaymentClaim.objects.create(
        workspace=invoice.workspace, invoice=invoice, provider=provider.key, amount=_outstanding(invoice), currency=invoice.currency,
        payer_name=str(payer_name or '').strip()[:150], payer_reference=str(payer_reference or '').strip()[:200],
        claimed_by_user=user if getattr(user, 'is_authenticated', False) else None,
    )
    _audit(user=user if getattr(user, 'is_authenticated', False) else None, workspace=invoice.workspace,
           action=f'billing.{provider.key}.payment_claimed', entity_id=claim.id, invoice_id=str(invoice.id),
           amount=billing.money_str(claim.amount), currency=claim.currency)
    from .notifications import notify_payment_claimed
    notify_payment_claimed(claim=claim, actor=user if getattr(user, 'is_authenticated', False) else None)
    return claim


def resolve_claim(*, workspace, claim_id, user, confirm: bool, amount=None) -> PaymentClaim:
    with transaction.atomic():
        claim = PaymentClaim.objects.select_for_update().select_related('invoice').filter(id=claim_id, workspace=workspace).first()
        if claim is None:
            raise OnlinePaymentError('Claim not found.', status=404)
        if claim.status != PaymentClaimStatus.PENDING:
            return claim
        if confirm:
            outstanding = _outstanding(claim.invoice)
            value = billing.money(amount) if amount not in (None, '') else min(claim.amount, outstanding)
            try:
                payment = billing.record_payment(
                    workspace=workspace, invoice=claim.invoice, amount=value, method=PaymentMethod.BANK_TRANSFER, provider=claim.provider,
                    provider_reference=f'claim:{claim.id}', recorded_by=user,
                    note=f'Paid by {MANUAL_PROVIDERS[claim.provider].name}, confirmed by the team'
                         + (f' (ref {claim.payer_reference})' if claim.payer_reference else ''))
            except billing.BillingError as exc:
                raise OnlinePaymentError(str(exc), status=409) from exc
            claim.payment = payment
        claim.status = PaymentClaimStatus.CONFIRMED if confirm else PaymentClaimStatus.REJECTED
        claim.resolved_by_user = user
        claim.resolved_at = timezone.now()
        claim.save()
    _audit(user=user, workspace=workspace, action=f'billing.{claim.provider}.claim_{claim.status}', entity_id=claim.id,
           invoice_id=str(claim.invoice_id))
    return claim


def online_payment(invoice, *, options=None) -> dict:
    """The one-line summary (kept from Stripe-only days): the first gateway that can take it, else why not."""
    from . import stripe_connect
    options = payment_options(invoice) if options is None else options
    for option in options:
        if option['available']:
            return _summary(option)
    if options:
        return _summary(options[0])
    return stripe_connect.online_payment(invoice)


def _summary(option):
    return {k: v for k, v in option.items() if k in ('provider', 'available', 'reason', 'message')}


# --- checkout ---------------------------------------------------------------------------------

def _customer(invoice, email=None) -> dict:
    team = invoice.client_team
    return {'name': getattr(team, 'name', '') or '', 'email': email or getattr(team, 'email', '') or ''}


def create_checkout(*, invoice, provider_key=None, return_path: str, customer_email=None, user=None) -> str:
    """Pay now. ``provider_key`` is the payer's choice; without one, the first gateway that can take it."""
    from . import stripe_connect
    options = payment_options(invoice)
    if not provider_key:
        available = [o for o in options if o['available'] and o.get('kind') != 'manual']
        provider_key = available[0]['provider'] if available else 'stripe'
    if get_manual(provider_key):
        raise OnlinePaymentError('Pay by bank transfer or payment link using the details shown, then press “I’ve paid”.',
                                 status=409, code='manual_payment')
    if provider_key == 'stripe':
        back = stripe_connect.connect_url(return_path)
        return stripe_connect.create_checkout(invoice=invoice, success_url=f'{back}?stripe=success', cancel_url=f'{back}?stripe=cancel',
                                              customer_email=customer_email, user=user)
    provider = get_provider(provider_key)
    option = next((o for o in options if o['provider'] == provider_key), None)
    if provider is None or option is None:
        raise OnlinePaymentError('That payment method isn’t turned on for this invoice.', status=409, code='not_enabled')
    if not option['available']:
        raise OnlinePaymentError(option.get('message') or 'This invoice can’t be paid online right now.', status=409, code=option['reason'])
    connection = connection_for(invoice.workspace, provider_key)
    credentials = _credentials(connection)
    checkout = GatewayCheckout.objects.create(connection=connection, invoice=invoice, provider=provider_key,
                                              amount=_outstanding(invoice), currency=invoice.currency, return_to=return_path[:500])
    base = f'/api/payments/return/{checkout.id}'
    urls = {'success': api_url(f'{base}/success/'), 'cancel': api_url(f'{base}/cancel/'), 'fail': api_url(f'{base}/fail/'),
            'webhook': webhook_url(connection)}
    try:
        url, reference = provider.create_checkout(connection=connection, credentials=credentials, checkout=checkout,
                                                  invoice=invoice, urls=urls, customer=_customer(invoice, customer_email))
    except GatewayError as exc:
        checkout.status = 'failed'
        checkout.save(update_fields=['status', 'updated_at'])
        raise OnlinePaymentError(str(exc), status=502) from exc
    checkout.provider_reference = reference
    checkout.save(update_fields=['provider_reference', 'updated_at'])
    _audit(user=user, workspace=invoice.workspace, action=f'billing.{provider_key}.checkout_created', entity_id=connection.id,
           invoice_id=str(invoice.id), checkout_id=str(checkout.id), amount=billing.money_str(checkout.amount),
           currency=checkout.currency, mode=connection.mode)
    return url


# --- recording ----------------------------------------------------------------------------------

def record_invoice_payment(*, invoice, provider, amount: Decimal, currency, reference, event_id, note,
                           method=PaymentMethod.CARD, reference_key='reference') -> str:
    """The shared rules, then billing.record_payment. Returns an outcome string for the webhook answer."""
    if str(currency or '').upper() != invoice.currency.upper():
        logger.warning('%s event %s currency %s != invoice %s', provider, event_id, currency, invoice.currency)
        return 'currency_mismatch'
    if Payment.objects.filter(provider=provider, provider_reference=reference).exists():
        return 'duplicate_payment'
    with transaction.atomic():
        outstanding = _outstanding(invoice)
        if outstanding <= 0:
            record_user_audit(user=None, workspace=invoice.workspace, action=f'billing.{provider}.payment_unmatched',
                              entity_type='stripe_account' if provider == 'stripe' else 'payment_gateway',
                              entity_id=invoice.workspace_id, team_only=True,
                              metadata={'invoice_id': str(invoice.id), 'amount': billing.money_str(amount),
                                        'currency': invoice.currency, reference_key: reference})
            return 'already_paid'
        try:
            billing.record_payment(workspace=invoice.workspace, invoice=invoice, amount=min(amount, outstanding), method=method,
                                   provider=provider, provider_reference=reference, note=note)
        except billing.BillingError as exc:
            logger.warning('%s event %s not recorded: %s', provider, event_id, exc)
            return 'not_recorded'
    return 'payment_recorded'


def _find_checkout(connection, event: PaymentEvent) -> GatewayCheckout | None:
    qs = GatewayCheckout.objects.select_related('invoice', 'invoice__workspace').filter(connection=connection)
    if event.checkout_id:
        try:
            found = qs.filter(id=uuid.UUID(str(event.checkout_id))).first()
        except ValueError:
            found = None
        if found:
            return found
    if event.provider_reference:
        return qs.filter(provider_reference=event.provider_reference).first()
    return None


def record_event(connection, event: PaymentEvent | None) -> str:
    if event is None:
        return 'ignored'
    checkout = _find_checkout(connection, event)
    if checkout is None:
        return 'unknown_checkout' if event.paid else 'ignored'
    if not event.paid:
        if checkout.status == 'open' and event.type.startswith('ipn.') and event.type != 'ipn.valid':
            checkout.status = 'failed'
            checkout.save(update_fields=['status', 'updated_at'])
        return 'not_paid'
    if event.amount is None or event.amount <= 0:
        return 'ignored'
    provider = get_provider(connection.provider)
    outcome = record_invoice_payment(
        invoice=checkout.invoice, provider=connection.provider, amount=event.amount, currency=event.currency,
        reference=checkout.provider_reference or str(checkout.id), event_id=event.event_id,
        note=f'Paid online with {provider.name}' + (' (sandbox)' if connection.mode == GatewayMode.SANDBOX else ''),
        method=PaymentMethod.OTHER,
    )
    if outcome in ('payment_recorded', 'duplicate_payment', 'already_paid'):
        GatewayCheckout.objects.filter(id=checkout.id).update(status=CHECKOUT_SETTLED, updated_at=timezone.now())
    return outcome


def handle_webhook(*, provider_key, connection_id, request) -> tuple[int, dict]:
    provider = get_provider(provider_key)
    connection = GatewayConnection.objects.select_related('workspace').filter(id=connection_id, provider=provider_key).first() if provider else None
    if connection is None:
        return 404, {'detail': 'Unknown endpoint.'}
    try:
        credentials = _credentials(connection)
        payload = provider.verify_webhook(connection=connection, credentials=credentials, request=request)
        event = provider.parse_event(connection=connection, credentials=credentials, payload=payload)
    except (crypto.CredentialsUnreadable, crypto.EncryptionNotConfigured):
        return 503, {'detail': 'Gateway keys unavailable.'}
    except WebhookRejected as exc:
        logger.warning('%s webhook for connection %s rejected: %s', provider_key, connection.id, exc)
        _audit(user=None, workspace=connection.workspace, action=f'billing.{provider_key}.webhook_rejected', entity_id=connection.id,
               reason=str(exc))
        return 400, {'detail': 'Invalid signature.'}
    except GatewayError as exc:
        # Could not re-check with the gateway: answer non-2xx so it retries later.
        return 502, {'detail': str(exc)}
    if not event.event_id:
        return 200, {'received': True, 'outcome': 'ignored'}
    try:
        with transaction.atomic():
            GatewayWebhookEvent.objects.create(provider=provider_key, event_id=event.event_id[:255], connection=connection, type=event.type[:100])
    except IntegrityError:
        return 200, {'received': True, 'outcome': 'duplicate'}
    outcome = record_event(connection, event)
    GatewayWebhookEvent.objects.filter(provider=provider_key, event_id=event.event_id[:255]).update(outcome=outcome)
    return 200, {'received': True, 'outcome': outcome}


def handle_return(*, checkout_id, result, request) -> str:
    """The payer is back from the hosted page. Re-check with the gateway, then send them to the invoice."""
    checkout = GatewayCheckout.objects.select_related('connection', 'invoice').filter(id=checkout_id).first()
    if checkout is None:
        return app_url('/')
    result = result if result in ('success', 'cancel', 'fail') else 'cancel'
    if result == 'success':
        provider = get_provider(checkout.provider)
        try:
            event = provider.confirm_return(connection=checkout.connection, credentials=_credentials(checkout.connection),
                                            checkout=checkout, request=request)
            record_event(checkout.connection, event)
        except (GatewayError, WebhookRejected, crypto.CredentialsUnreadable, crypto.EncryptionNotConfigured) as exc:
            logger.info('%s return check for %s deferred to webhook: %s', checkout.provider, checkout.id, exc)
    elif checkout.status == 'open':
        checkout.status = 'cancelled' if result == 'cancel' else 'failed'
        checkout.save(update_fields=['status', 'updated_at'])
    sep = '&' if '?' in checkout.return_to else '?'
    return app_url(f'{checkout.return_to}{sep}payment={result}&provider={checkout.provider}')


