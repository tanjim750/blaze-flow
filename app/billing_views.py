"""Billing (demo) routes: receivables, invoices, editor pay and payouts.

Every route resolves the viewer's access with ``billing.billing_access`` and cuts its answer
to that. Anything that marks money as paid calls ``billing.record_payment`` (through the
module, so there is exactly one implementation to swap for a gateway later).
"""
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import (
    Invoice, InvoiceStatus, PaymentMethod, Project, Task, Workspace, WorkspaceMembership, WorkspacePrincipalType,
    WorkspaceProfile,
)
from .permissions import TASK_READ, WORKSPACE_READ, has_project_permission, has_workspace_permission
from .services import billing


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


class InvoiceCreateSerializer(serializers.Serializer):
    project_id = serializers.UUIDField()
    due_date = serializers.DateField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True, max_length=2000)


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


def _settings_out(settings):
    return {'currency': settings.currency, 'payment_terms_days': settings.payment_terms_days, 'invoice_prefix': settings.invoice_prefix}


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated])
def billing_settings(request, workspace_id):
    workspace, access = _workspace(request, workspace_id)
    _require(access, 'view', VIEW_DENIED)
    if request.method == 'PATCH':
        _require(access, 'manage', MANAGE_DENIED)
        serializer = SettingsSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        try:
            settings = billing.update_billing_settings(workspace=workspace, user=request.user, **serializer.validated_data)
        except billing.BillingError as exc:
            return _error(exc)
        return Response(_settings_out(settings))
    return Response(_settings_out(billing.billing_settings(workspace)))


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
    return Response(_invoice_detail(workspace, invoice), status=status.HTTP_201_CREATED)


def _invoice_detail(workspace, invoice):
    invoice = Invoice.objects.select_related('client_team', 'project', 'workspace').prefetch_related('lines', 'payments').get(pk=invoice.pk)
    profile = WorkspaceProfile.objects.filter(workspace=workspace).first()
    return billing.invoice_out(invoice, detail=True, workspace_profile=profile)


def _visible_invoice(request, workspace, access, invoice_id):
    invoice = get_object_or_404(Invoice, id=invoice_id, workspace=workspace)
    if access['view']:
        return invoice
    # A client-team member sees their own client's invoices once sent. 404, not 403, so the
    # route does not confirm that someone else's invoice exists.
    if invoice.status != InvoiceStatus.DRAFT and invoice.client_team_id in billing.client_team_ids_for(user=request.user, workspace=workspace):
        return invoice
    raise Invoice.DoesNotExist


@api_view(['GET', 'DELETE'])
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
    data = _invoice_detail(workspace, invoice)
    data['viewer_can_manage'] = access['manage']
    return Response(data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_send(request, workspace_id, invoice_id):
    workspace, access = _workspace(request, workspace_id)
    _require(access, 'manage', MANAGE_DENIED)
    invoice = get_object_or_404(Invoice, id=invoice_id, workspace=workspace)
    try:
        billing.send_invoice(invoice=invoice, user=request.user)
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
