"""Billing (demo) routes: receivables, invoices, editor pay and payouts.

Every route resolves the viewer's access with ``billing.billing_access`` and cuts its answer
to that. Anything that marks money as paid calls ``billing.record_payment`` (through the
module, so there is exactly one implementation to swap for a gateway later).
"""
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import (
    Invoice, InvoiceStatus, PaymentMethod, Project, Task, Workspace, WorkspaceMembership, WorkspacePrincipalType,
    WorkspaceProfile,
)
from .currencies import CURRENCIES
from .payment_gateways import list_gateways
from .permissions import TASK_READ, WORKSPACE_MANAGE, WORKSPACE_READ, has_project_permission, has_workspace_permission
from .services import billing, online_payments, stripe_connect


def _workspace(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    if not has_workspace_permission(user=request.user, workspace=workspace, permission_key=WORKSPACE_READ):
        raise PermissionDenied('You do not have access to this workspace.')
    return workspace, billing.billing_access(user=request.user, workspace=workspace)


def _require(access, key, message):
    if not access[key]:
        raise PermissionDenied(message)


VIEW_DENIED = 'You do not have permission to see billing.'
MANAGE_DENIED = 'You do not have permission to manage billing.'
RATES_DENIED = 'You do not have permission to see editor pay.'


def _error(exc):
    return Response({'detail': str(exc)}, status=status.HTTP_409_CONFLICT if exc.conflict else status.HTTP_400_BAD_REQUEST)


class AmountField(serializers.CharField):
    """Money arrives as a string or number; billing.money() does the real parsing."""

    def __init__(self, **kwargs):
        kwargs.setdefault('allow_null', True)
        kwargs.setdefault('allow_blank', True)
        kwargs.setdefault('required', False)
        super().__init__(**kwargs)

    def to_internal_value(self, data):
        if isinstance(data, (int, float)):
            data = str(data)
        return super().to_internal_value(data)


class SettingsSerializer(serializers.Serializer):
    currency = serializers.CharField(max_length=3, required=False)
    payment_terms_days = serializers.IntegerField(min_value=0, max_value=365, required=False)
    invoice_prefix = serializers.CharField(max_length=20, required=False)
    # ISO 3166-1 alpha-2, e.g. PH, PK, BD, US. Blank = use the workspace profile's country.
    country = serializers.RegexField(r'^([A-Za-z]{2})?$', required=False, allow_blank=True)


class GatewayKeysSerializer(serializers.Serializer):
    mode = serializers.ChoiceField(choices=['sandbox', 'live'])
    # Blank or missing secret fields keep the saved value (the form only ever sees masks).
    credentials = serializers.DictField(child=serializers.CharField(allow_blank=True, max_length=2000), required=False)


class InvoiceCreateSerializer(serializers.Serializer):
    project_id = serializers.UUIDField()
    due_date = serializers.DateField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True, max_length=2000)


class InvoiceLineInputSerializer(serializers.Serializer):
    id = serializers.UUIDField(required=False, allow_null=True)
    description = serializers.CharField(max_length=255)
    amount = serializers.CharField(max_length=20)


class InvoiceUpdateSerializer(serializers.Serializer):
    due_date = serializers.DateField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True, max_length=2000)
    tax_rate = serializers.CharField(required=False, allow_blank=True, max_length=10)
    discount_amount = serializers.CharField(required=False, allow_blank=True, max_length=20)
    lines = InvoiceLineInputSerializer(many=True, required=False)


class PaymentSerializer(serializers.Serializer):
    amount = AmountField()
    paid_on = serializers.DateField(required=False, allow_null=True)
    method = serializers.ChoiceField(choices=PaymentMethod.choices, required=False, default=PaymentMethod.BANK_TRANSFER)
    note = serializers.CharField(required=False, allow_blank=True, max_length=1000)


class PayoutSerializer(PaymentSerializer):
    membership_id = serializers.UUIDField()


class ProjectPriceSerializer(serializers.Serializer):
    fee = AmountField()


class EditorPaySerializer(serializers.Serializer):
    membership_id = serializers.UUIDField()
    amount = AmountField()


class TaskMoneySerializer(serializers.Serializer):
    client_price = AmountField()
    editor_pay = EditorPaySerializer(required=False)


class RateSerializer(serializers.Serializer):
    default_task_rate = AmountField()


def _settings_out(settings, access=None, workspace=None):
    out = {
        'currency': settings.currency, 'payment_terms_days': settings.payment_terms_days, 'invoice_prefix': settings.invoice_prefix,
        # Only owners/admins (billing.manage + workspace.manage) may change the currency.
        'can_change_currency': bool(access and access.get('currency_manage')),
        'country': (settings.country or '').upper(),
        'effective_country': online_payments.workspace_country(workspace) if workspace is not None else '',
        'recommended_gateways': online_payments.recommended_for(online_payments.workspace_country(workspace)) if workspace is not None else [],
        # Owners/admins enter and see (masked) merchant keys.
        'can_manage_gateways': bool(access and access.get('currency_manage')),
        'payment_gateways': list_gateways(workspace_currency=settings.currency, workspace=workspace),
    }
    # "Local payment options" opens by itself only when one is on or the business is in PH / PK / BD.
    country = out['effective_country']
    out['local_expanded'] = bool(country in online_payments.LOCAL_BY_COUNTRY or any(
        g.get('group') == 'local' and g.get('enabled') for g in out['payment_gateways']))
    out['local_recommended'] = country in online_payments.LOCAL_BY_COUNTRY
    return out


def _can_change_currency(request, workspace, access):
    return access['manage'] and has_workspace_permission(user=request.user, workspace=workspace, permission_key=WORKSPACE_MANAGE)


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated])
def billing_settings(request, workspace_id):
    workspace, access = _workspace(request, workspace_id)
    _require(access, 'view', VIEW_DENIED)
    access = {**access, 'currency_manage': _can_change_currency(request, workspace, access)}
    if request.method == 'PATCH':
        _require(access, 'manage', MANAGE_DENIED)
        serializer = SettingsSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        if 'currency' in serializer.validated_data and not access['currency_manage']:
            current = billing.workspace_currency(workspace)
            if str(serializer.validated_data['currency']).strip().upper() != current:
                raise PermissionDenied('Only workspace owners and admins can change the currency.')
        if 'country' in serializer.validated_data and not access['currency_manage']:
            raise PermissionDenied('Only workspace owners and admins can change the country.')
        try:
            settings = billing.update_billing_settings(workspace=workspace, user=request.user, **serializer.validated_data)
        except billing.BillingError as exc:
            return _error(exc)
        return Response(_settings_out(settings, access, workspace))
    return Response(_settings_out(billing.billing_settings(workspace), access, workspace))


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def currencies(request):
    """Every accepted ISO 4217 code with its English name and minor units."""
    return Response({'results': [{'code': code, 'name': name, 'minor_units': digits} for code, name, digits in CURRENCIES]})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def billing_summary(request, workspace_id):
    """Money page: totals, receivables by client, invoices, and (with rates visibility) payouts."""
    workspace, access = _workspace(request, workspace_id)
    _require(access, 'view', VIEW_DENIED)
    return Response({**billing.money_summary(workspace=workspace, access=access), 'access': access})


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def invoice_list_create(request, workspace_id):
    workspace, access = _workspace(request, workspace_id)
    _require(access, 'view', VIEW_DENIED)
    if request.method == 'GET':
        return Response(billing.list_invoices(workspace=workspace))
    _require(access, 'manage', MANAGE_DENIED)
    serializer = InvoiceCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    project = get_object_or_404(Project, id=serializer.validated_data['project_id'], workspace=workspace)
    try:
        invoice = billing.create_invoice_from_project(
            project=project, user=request.user, due_date=serializer.validated_data.get('due_date'),
            notes=serializer.validated_data.get('notes', ''),
        )
    except billing.BillingError as exc:
        return _error(exc)
    reopened = getattr(invoice, 'reopened', False)
    return Response(_invoice_detail(workspace, invoice), status=status.HTTP_200_OK if reopened else status.HTTP_201_CREATED)


def _invoice_detail(workspace, invoice):
    invoice = Invoice.objects.select_related('client_team', 'project', 'workspace').prefetch_related('lines', 'payments').get(pk=invoice.pk)
    profile = WorkspaceProfile.objects.filter(workspace=workspace).first()
    data = billing.invoice_out(invoice, detail=True, workspace_profile=profile)
    data['payment_options'] = online_payments.payment_options(invoice)
    data['online_payment'] = online_payments.online_payment(invoice, options=data['payment_options'])
    return data


def _visible_invoice(request, workspace, access, invoice_id):
    invoice = get_object_or_404(Invoice, id=invoice_id, workspace=workspace)
    if access['view']:
        return invoice
    # A client-team member sees their own client's invoices once sent. 404, not 403, so the
    # route does not confirm that someone else's invoice exists.
    if invoice.status != InvoiceStatus.DRAFT and invoice.client_team_id in billing.client_team_ids_for(user=request.user, workspace=workspace):
        return invoice
    raise Invoice.DoesNotExist


@api_view(['GET', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def invoice_detail(request, workspace_id, invoice_id):
    workspace, access = _workspace(request, workspace_id)
    try:
        invoice = _visible_invoice(request, workspace, access, invoice_id)
    except Invoice.DoesNotExist:
        return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
    if request.method == 'DELETE':
        _require(access, 'manage', MANAGE_DENIED)
        try:
            billing.delete_draft_invoice(invoice=invoice, user=request.user)
        except billing.BillingError as exc:
            return _error(exc)
        return Response(status=status.HTTP_204_NO_CONTENT)
    if request.method == 'PATCH':
        _require(access, 'manage', MANAGE_DENIED)
        if 'status' in request.data:
            # Status only moves through send / revert / record_payment, never a plain PATCH.
            return Response({'detail': 'Use Mark as sent, Revert to draft or Record payment to change the status.'}, status=status.HTTP_400_BAD_REQUEST)
        serializer = InvoiceUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        try:
            billing.update_draft_invoice(invoice=invoice, user=request.user, data=serializer.validated_data)
        except billing.BillingError as exc:
            return _error(exc)
    data = _invoice_detail(workspace, invoice)
    data['viewer_can_manage'] = access['manage']
    if access['manage']:
        from .models import PaymentClaim, PaymentClaimStatus
        data['payment_claims'] = [online_payments.claim_out(c) for c in
                                  PaymentClaim.objects.filter(invoice=invoice, status=PaymentClaimStatus.PENDING).order_by('created_at')]
    if access['manage'] and invoice.status != InvoiceStatus.DRAFT and data['online_payment']['available']:
        data['pay_link'] = stripe_connect.connect_url(f'/pay/{stripe_connect.ensure_pay_token(invoice)}')
    if access['manage'] and invoice.status == 'draft':
        from .services.invoice_email import invoice_recipients
        data['client_recipients'] = invoice_recipients(invoice)
    return Response(data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_send(request, workspace_id, invoice_id):
    workspace, access = _workspace(request, workspace_id)
    _require(access, 'manage', MANAGE_DENIED)
    invoice = get_object_or_404(Invoice, id=invoice_id, workspace=workspace)
    try:
        sent = billing.send_invoice(invoice=invoice, user=request.user, email=request.data.get('email', True) is not False)
    except billing.BillingError as exc:
        return _error(exc)
    data = _invoice_detail(workspace, invoice)
    data['emailed_to'] = sent.emailed_to
    return Response(data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_revert(request, workspace_id, invoice_id):
    """Back to draft after "Mark as sent", as long as no payment has been recorded."""
    workspace, access = _workspace(request, workspace_id)
    _require(access, 'manage', MANAGE_DENIED)
    invoice = get_object_or_404(Invoice, id=invoice_id, workspace=workspace)
    try:
        billing.revert_invoice_to_draft(invoice=invoice, user=request.user)
    except billing.BillingError as exc:
        return _error(exc)
    return Response(_invoice_detail(workspace, invoice))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_payments(request, workspace_id, invoice_id):
    """Record a client payment. No amount = the whole outstanding balance ("Mark as paid (demo)")."""
    workspace, access = _workspace(request, workspace_id)
    _require(access, 'manage', MANAGE_DENIED)
    invoice = get_object_or_404(Invoice, id=invoice_id, workspace=workspace)
    serializer = PaymentSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    try:
        billing.record_payment(
            workspace=workspace, invoice=invoice, amount=data.get('amount'), paid_on=data.get('paid_on'),
            method=data.get('method'), note=data.get('note', ''), provider='manual', recorded_by=request.user,
        )
    except billing.BillingError as exc:
        return _error(exc)
    return Response(_invoice_detail(workspace, invoice), status=status.HTTP_201_CREATED)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def payouts(request, workspace_id):
    """The payouts ledger by editor; POST records a payout (same record_payment path)."""
    workspace, access = _workspace(request, workspace_id)
    _require(access, 'rates_view' if request.method == 'GET' else 'manage', RATES_DENIED if request.method == 'GET' else MANAGE_DENIED)
    if request.method == 'GET':
        return Response({'currency': billing.workspace_currency(workspace), 'results': billing.payouts_ledger(workspace=workspace)})
    serializer = PayoutSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    membership = get_object_or_404(WorkspaceMembership, id=data['membership_id'], workspace=workspace, principal_type=WorkspacePrincipalType.USER)
    try:
        payment = billing.record_payment(
            workspace=workspace, payee_membership=membership, amount=data.get('amount'), paid_on=data.get('paid_on'),
            method=data.get('method'), note=data.get('note', ''), provider='manual', recorded_by=request.user,
        )
    except billing.BillingError as exc:
        return _error(exc)
    return Response(billing.payment_out(payment), status=status.HTTP_201_CREATED)


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated])
def project_pricing(request, workspace_id, project_id):
    workspace, access = _workspace(request, workspace_id)
    _require(access, 'view', VIEW_DENIED)
    project = get_object_or_404(Project, id=project_id, workspace=workspace)
    if request.method == 'PATCH':
        _require(access, 'manage', MANAGE_DENIED)
        serializer = ProjectPriceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            billing.set_project_fee(project=project, user=request.user, amount=serializer.validated_data.get('fee'))
        except billing.BillingError as exc:
            return _error(exc)
    invoices = [item for item in billing.list_invoices(workspace=workspace) if item['project'] and item['project']['id'] == str(project.id)]
    return Response({**billing.project_pricing(project), 'invoices': invoices, 'can_manage': access['manage']})


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated])
def task_money(request, workspace_id, task_id):
    """The task sheet's money block: client price (billing.view) and editor pay (managers,
    rates viewers, or the assignee for their own line only)."""
    workspace, access = _workspace(request, workspace_id)
    task = get_object_or_404(Task, id=task_id, workspace=workspace, deleted_at__isnull=True)
    if task.project_id and not has_project_permission(user=request.user, project=task.project, permission_key=TASK_READ):
        raise PermissionDenied('You do not have access to this task.')
    if request.method == 'PATCH':
        _require(access, 'manage', MANAGE_DENIED)
        serializer = TaskMoneySerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            if 'client_price' in data:
                billing.set_task_price(task=task, user=request.user, amount=data['client_price'])
            if 'editor_pay' in data:
                membership = get_object_or_404(WorkspaceMembership, id=data['editor_pay']['membership_id'], workspace=workspace)
                billing.set_editor_pay(task=task, membership=membership, user=request.user, amount=data['editor_pay'].get('amount'))
        except billing.BillingError as exc:
            return _error(exc)
        task.refresh_from_db()
    return Response(billing.task_money(task=task, user=request.user, access=access))


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def member_rates(request, workspace_id):
    """Settings: all active team members and their default rate per task."""
    workspace, access = _workspace(request, workspace_id)
    _require(access, 'rates_view', RATES_DENIED)
    return Response({'currency': billing.workspace_currency(workspace), 'results': billing.member_rates(workspace=workspace)})


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def member_rate(request, workspace_id, membership_id):
    workspace, access = _workspace(request, workspace_id)
    _require(access, 'manage', MANAGE_DENIED)
    membership = get_object_or_404(WorkspaceMembership, id=membership_id, workspace=workspace, principal_type=WorkspacePrincipalType.USER)
    serializer = RateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        rate = billing.set_default_rate(membership=membership, user=request.user, amount=serializer.validated_data.get('default_task_rate'))
    except billing.BillingError as exc:
        return _error(exc)
    return Response({'membership_id': str(membership.id), 'default_task_rate': billing.money_str(rate.default_task_rate), 'currency': rate.currency})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def my_earnings(request, workspace_id):
    """The viewer's own pay: pending, earned, paid, owed. Never anyone else's, never client prices."""
    workspace, _ = _workspace(request, workspace_id)
    membership = billing.own_membership(user=request.user, workspace=workspace)
    if membership is None:
        raise PermissionDenied('Earnings are for team members.')
    return Response(billing.my_earnings(membership=membership))


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def my_invoices(request, workspace_id):
    """A client-team member's own client's invoices (sent, overdue or paid)."""
    workspace, _ = _workspace(request, workspace_id)
    team_ids = billing.client_team_ids_for(user=request.user, workspace=workspace)
    if not team_ids:
        raise PermissionDenied('Invoices here are for client team members.')
    return Response(billing.client_invoices(workspace=workspace, client_team_ids=team_ids))


# --- Stripe Connect -----------------------------------------------------------------------

STRIPE_DENIED = 'Only workspace owners and admins can manage Stripe.'


def _stripe_manager(request, workspace_id):
    workspace, access = _workspace(request, workspace_id)
    if not _can_change_currency(request, workspace, access):
        raise PermissionDenied(STRIPE_DENIED)
    return workspace


def _stripe_error(exc):
    if isinstance(exc, stripe_connect.StripeNotConfigured):
        return Response({'detail': str(exc), 'code': 'stripe_not_configured'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    return Response({'detail': str(exc)}, status=exc.status)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def stripe_status(request, workspace_id):
    """The Stripe card in Settings. ``?refresh=1`` re-reads the account from Stripe."""
    workspace, access = _workspace(request, workspace_id)
    _require(access, 'view', VIEW_DENIED)
    can_manage = _can_change_currency(request, workspace, access)
    account = stripe_connect.account_for(workspace)
    if account is not None and can_manage and request.query_params.get('refresh') and stripe_connect.is_configured():
        try:
            stripe_connect.sync_account(account)
        except stripe_connect.StripeConnectError as exc:
            return _stripe_error(exc)
    return Response(stripe_connect.status_out(workspace, can_manage=can_manage))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def stripe_connect_start(request, workspace_id):
    """Create the workspace's Stripe account (first time) and return a hosted onboarding link."""
    workspace = _stripe_manager(request, workspace_id)
    try:
        url = stripe_connect.start_onboarding(workspace=workspace, user=request.user)
    except (stripe_connect.StripeNotConfigured, stripe_connect.StripeConnectError) as exc:
        return _stripe_error(exc)
    return Response({'url': url, **stripe_connect.status_out(workspace, can_manage=True)})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def stripe_dashboard(request, workspace_id):
    workspace = _stripe_manager(request, workspace_id)
    try:
        url = stripe_connect.dashboard_link(workspace=workspace, user=request.user)
    except (stripe_connect.StripeNotConfigured, stripe_connect.StripeConnectError) as exc:
        return _stripe_error(exc)
    return Response({'url': url})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def stripe_disconnect(request, workspace_id):
    workspace = _stripe_manager(request, workspace_id)
    stripe_connect.disconnect(workspace=workspace, user=request.user)
    return Response(stripe_connect.status_out(workspace, can_manage=True))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_checkout(request, workspace_id, invoice_id):
    """Pay now with the gateway in body ``provider`` (default: the first that can take it): a hosted checkout for what is outstanding (team billing viewers or the client)."""
    workspace, access = _workspace(request, workspace_id)
    try:
        invoice = _visible_invoice(request, workspace, access, invoice_id)
    except Invoice.DoesNotExist:
        return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
    return checkout_response(invoice, provider=request.data.get('provider') if hasattr(request.data, 'get') else None,
                             return_path=f'/money/invoices/{invoice.id}',
                             customer_email=None if access['view'] else request.user.email, user=request.user)


def checkout_response(invoice, *, provider, return_path, customer_email=None, user=None):
    try:
        url = online_payments.create_checkout(invoice=invoice, provider_key=provider or None, return_path=return_path,
                                              customer_email=customer_email, user=user)
    except (stripe_connect.StripeNotConfigured, stripe_connect.StripeConnectError) as exc:
        return _stripe_error(exc)
    except online_payments.OnlinePaymentError as exc:
        return Response({'detail': str(exc), 'code': exc.code}, status=exc.status)
    return Response({'url': url})


# --- local gateways (PayMongo, Safepay, SSLCOMMERZ): the agency's own merchant keys ----------

GATEWAY_DENIED = 'Only workspace owners and admins can manage payment gateway keys.'


def _gateway_access(request, workspace_id, provider):
    from .gateways import get_manual, get_provider
    workspace, access = _workspace(request, workspace_id)
    _require(access, 'view', VIEW_DENIED)
    if not _can_change_currency(request, workspace, access):
        raise PermissionDenied(GATEWAY_DENIED)
    gateway = get_provider(provider) or get_manual(provider)
    if gateway is None:
        raise NotFound('Unknown payment gateway.')
    return workspace, gateway


def _gateway_out(workspace, gateway):
    from .gateways import get_manual
    if get_manual(gateway.key):
        return online_payments.manual_out(gateway, online_payments.connection_for(workspace, gateway.key))
    settings = billing.billing_settings(workspace)
    return online_payments.connection_out(gateway, online_payments.connection_for(workspace, gateway.key), workspace_currency=settings.currency)


def _gateway_call(fn):
    try:
        return fn()
    except online_payments.OnlinePaymentError as exc:
        return Response({'detail': str(exc), 'code': exc.code}, status=exc.status)


@api_view(['GET', 'PUT', 'DELETE'])
@permission_classes([IsAuthenticated])
def gateway_detail(request, workspace_id, provider):
    """GET the card (masked), PUT {mode, credentials} to save keys, DELETE to disconnect."""
    from .gateways import get_manual
    workspace, gateway = _gateway_access(request, workspace_id, provider)
    if request.method == 'PUT' and get_manual(gateway.key):
        data = request.data if isinstance(request.data, dict) else {}
        result = _gateway_call(lambda: online_payments.save_manual(workspace=workspace, provider_key=gateway.key, user=request.user,
                                                                    data=data))
        if isinstance(result, Response):
            return result
    elif request.method == 'PUT':
        serializer = GatewayKeysSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = _gateway_call(lambda: online_payments.save_connection(
            workspace=workspace, provider_key=gateway.key, user=request.user, mode=serializer.validated_data['mode'],
            credentials=serializer.validated_data.get('credentials') or {}))
        if isinstance(result, Response):
            return result
    elif request.method == 'DELETE':
        online_payments.delete_connection(workspace=workspace, provider_key=gateway.key, user=request.user)
    return Response(_gateway_out(workspace, gateway))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def gateway_test(request, workspace_id, provider):
    from .gateways import get_manual
    workspace, gateway = _gateway_access(request, workspace_id, provider)
    if get_manual(gateway.key):
        return Response({'detail': f'{gateway.name} has nothing to test: payments are confirmed by your team.'}, status=status.HTTP_400_BAD_REQUEST)
    result = _gateway_call(lambda: online_payments.test_connection(workspace=workspace, provider_key=gateway.key, user=request.user))
    return result if isinstance(result, Response) else Response(_gateway_out(workspace, gateway))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def gateway_enable(request, workspace_id, provider):
    """{enabled: true|false}. Turning on needs a passing Test connection."""
    workspace, gateway = _gateway_access(request, workspace_id, provider)
    enabled = request.data.get('enabled') in (True, 'true', '1', 1)
    result = _gateway_call(lambda: online_payments.set_enabled(workspace=workspace, provider_key=gateway.key, user=request.user, enabled=enabled))
    return result if isinstance(result, Response) else Response(_gateway_out(workspace, gateway))


# --- Pay by Wise / Payoneer: "I've paid" claims the team confirms ----------------------------

def claim_response(invoice, request, user=None):
    data = request.data if hasattr(request.data, 'get') else {}
    try:
        claim = online_payments.create_claim(invoice=invoice, provider_key=data.get('provider'), payer_name=data.get('payer_name', ''),
                                             payer_reference=data.get('payer_reference', ''), user=user)
    except online_payments.OnlinePaymentError as exc:
        return Response({'detail': str(exc), 'code': exc.code}, status=exc.status)
    return Response(online_payments.claim_out(claim), status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_claim(request, workspace_id, invoice_id):
    """The client says "I've paid" by Wise / Payoneer: a pending claim, nothing is paid yet."""
    workspace, access = _workspace(request, workspace_id)
    try:
        invoice = _visible_invoice(request, workspace, access, invoice_id)
    except Invoice.DoesNotExist:
        return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
    return claim_response(invoice, request, user=request.user)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def claim_resolve(request, workspace_id, claim_id, action):
    """Confirm (records the payment, optional {amount}) or reject a pending claim. Billing managers."""
    workspace, access = _workspace(request, workspace_id)
    _require(access, 'manage', MANAGE_DENIED)
    if action not in ('confirm', 'reject'):
        raise NotFound()
    try:
        claim = online_payments.resolve_claim(workspace=workspace, claim_id=claim_id, user=request.user, confirm=action == 'confirm',
                                              amount=request.data.get('amount') if hasattr(request.data, 'get') else None)
    except online_payments.OnlinePaymentError as exc:
        return Response({'detail': str(exc)}, status=exc.status)
    return Response(online_payments.claim_out(claim))
