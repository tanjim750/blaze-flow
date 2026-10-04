"""Agency money tracking (demo): what each client owes and what each editor is owed.

Two ledgers, one shape:

* **Receivables.** A project has a client fee, and any task can carry its own client price on
  top. An invoice is created from a project and snapshots its priced items as lines. It goes
  Draft -> Sent -> Paid; "Overdue" is derived (sent, past its due date, money outstanding).
  Clients pay in one or more payment entries.
* **Payouts.** Each assignee on a task can carry an editor pay amount (pre-filled from their
  optional default rate). It becomes *earned*, and the amount freezes, when the task enters a
  stage whose kind is Approved. Payout entries reduce what the studio owes them.

**The payment stub.** Every "paid" in the product goes through :func:`record_payment` and
nowhere else: the "Mark as paid (demo)" button, a partial payment, an editor payout, and the
seed command. It records ``provider='manual'`` today. When a real gateway arrives (Stripe or
another), its webhook handler verifies the event and calls this same function with
``provider='stripe'`` and ``provider_reference=<the gateway's payment id>``; the unique
(provider, provider_reference) constraint makes a re-delivered webhook a no-op. Nothing else
needs to change: totals, statuses and the UI all read the ``Payment`` rows.

Visibility rules (enforced by the views through :func:`billing_access`):

* billing permissions only count on a team member's own membership, never on a client-team
  membership, so a client never sees prices across clients or editor pay;
* editors without billing keys see only their own pay (``my_earnings``);
* client-team members see only their own client's non-draft invoices (``client_invoices``);
* guests have no route here at all.
"""
from __future__ import annotations

import datetime as dt
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.utils import timezone

from app.models import (
    ClientTeam, ClientTeamStatus, EditorPay, EditorPayStatus, Invoice, InvoiceLine, InvoiceLineKind,
    InvoiceStatus, MemberPayRate, Payment, PaymentDirection, PaymentMethod, PaymentProvider, Project,
    Task, TaskAssignee, TaskStageKind, WorkspaceBillingSettings, WorkspaceMembership,
    WorkspaceMembershipStatus, WorkspacePrincipalType,
)
from app.permissions import (
    BILLING_MANAGE, BILLING_RATES_VIEW, BILLING_VIEW, active_memberships_for_user, memberships_with_permission,
)

from .audit import record_user_audit

ZERO = Decimal('0.00')
CENT = Decimal('0.01')
MAX_AMOUNT = Decimal('9999999999.99')


class BillingError(Exception):
    """A request the billing rules refuse (bad amount, wrong state). Views answer 400/409."""

    def __init__(self, message, *, conflict=False):
        super().__init__(message)
        self.conflict = conflict


# --- money --------------------------------------------------------------------------------

def money(value) -> Decimal:
    """``value`` as a two-place Decimal. Raises BillingError for anything that is not money."""
    if isinstance(value, Decimal):
        amount = value
    else:
        try:
            amount = Decimal(str(value).strip())
        except (InvalidOperation, ValueError, TypeError):
            raise BillingError('Enter an amount like 1250 or 1250.50.')
    if not amount.is_finite():
        raise BillingError('Enter an amount like 1250 or 1250.50.')
    amount = amount.quantize(CENT, rounding=ROUND_HALF_UP)
    if amount < 0:
        raise BillingError('Amounts cannot be negative.')
    if amount > MAX_AMOUNT:
        raise BillingError('That amount is too large.')
    return amount


def money_str(value) -> str | None:
    return None if value is None else str(Decimal(value).quantize(CENT))


def _sum(queryset, field='amount') -> Decimal:
    return (queryset.aggregate(total=Sum(field))['total'] or ZERO).quantize(CENT)


# --- settings -----------------------------------------------------------------------------

def billing_settings(workspace) -> WorkspaceBillingSettings:
    settings, _ = WorkspaceBillingSettings.objects.get_or_create(workspace=workspace)
    return settings


def workspace_currency(workspace) -> str:
    return billing_settings(workspace).currency


def update_billing_settings(*, workspace, user, currency=None, payment_terms_days=None, invoice_prefix=None):
    settings = billing_settings(workspace)
    if currency is not None:
        code = str(currency).strip().upper()
        if len(code) != 3 or not code.isalpha():
            raise BillingError('Use a three-letter currency code such as GBP, USD or EUR.')
        settings.currency = code
    if payment_terms_days is not None:
        settings.payment_terms_days = int(payment_terms_days)
    if invoice_prefix is not None:
        settings.invoice_prefix = str(invoice_prefix).strip()[:20] or 'INV'
    settings.save()
    _audit(user=user, workspace=workspace, action='billing.settings.updated', entity_type='workspace', entity_id=workspace.id,
           currency=settings.currency)
    return settings


# --- who sees what ------------------------------------------------------------------------

def _own_memberships(user, workspace):
    return active_memberships_for_user(user=user, workspace=workspace).filter(principal_type=WorkspacePrincipalType.USER)


def _holds(user, workspace, key) -> bool:
    return memberships_with_permission(user=user, workspace=workspace, permission_key=key).filter(
        principal_type=WorkspacePrincipalType.USER,
    ).exists()


def billing_access(*, user, workspace) -> dict:
    """What the viewer may do with money here. Client-team memberships never count."""
    return {
        'view': _holds(user, workspace, BILLING_VIEW),
        'manage': _holds(user, workspace, BILLING_MANAGE),
        'rates_view': _holds(user, workspace, BILLING_RATES_VIEW),
    }


def own_membership(*, user, workspace):
    return _own_memberships(user, workspace).first()


def client_team_ids_for(*, user, workspace) -> list:
    """Client teams the viewer reaches this workspace through."""
    return list(active_memberships_for_user(user=user, workspace=workspace).filter(
        principal_type=WorkspacePrincipalType.CLIENT_TEAM,
    ).values_list('client_team_id', flat=True))


# --- prices -------------------------------------------------------------------------------

def _live_tasks(project):
    return Task.objects.filter(project=project, deleted_at__isnull=True)


def set_project_fee(*, project, user, amount):
    project.client_fee = None if amount in (None, '') else money(amount)
    project.client_fee_currency = workspace_currency(project.workspace) if project.client_fee is not None else None
    project.save(update_fields=['client_fee', 'client_fee_currency'])
    _audit(user=user, workspace=project.workspace, action='billing.project_fee.set', entity_type='project', entity_id=project.id,
           amount=money_str(project.client_fee))
    return project


def set_task_price(*, task, user, amount):
    task.client_price = None if amount in (None, '') else money(amount)
    task.client_price_currency = workspace_currency(task.workspace) if task.client_price is not None else None
    task.save(update_fields=['client_price', 'client_price_currency'])
    _audit(user=user, workspace=task.workspace, action='billing.task_price.set', entity_type='task', entity_id=task.id,
           amount=money_str(task.client_price))
    return task


def project_pricing(project) -> dict:
    """Fee + per-task prices = project total, and how much of it is already invoiced."""
    tasks = list(_live_tasks(project).order_by('sort_order', 'created_at'))
    fee = project.client_fee or ZERO
    task_total = sum((task.client_price or ZERO for task in tasks), ZERO)
    invoiced = _sum(InvoiceLine.objects.filter(invoice__project=project))
    total = (fee + task_total).quantize(CENT)
    return {
        'project_id': str(project.id), 'currency': project.client_fee_currency or workspace_currency(project.workspace),
        'fee': money_str(project.client_fee), 'tasks_total': money_str(task_total), 'total': money_str(total),
        'invoiced': money_str(invoiced), 'uninvoiced': money_str(max(total - invoiced, ZERO)),
        'tasks': [{'id': str(task.id), 'title': task.title, 'client_price': money_str(task.client_price)} for task in tasks],
    }


# --- invoices -----------------------------------------------------------------------------

def invoice_total(invoice) -> Decimal:
    return _sum(invoice.lines.all())


def invoice_paid(invoice) -> Decimal:
    return _sum(invoice.payments.all())


def invoice_display_status(invoice, *, today=None, outstanding=None) -> str:
    """draft, sent, overdue or paid. Overdue = sent, past due, and money still outstanding."""
    if invoice.status != InvoiceStatus.SENT:
        return invoice.status
    today = today or timezone.localdate()
    if outstanding is None:
        outstanding = invoice_total(invoice) - invoice_paid(invoice)
    if invoice.due_date and invoice.due_date < today and outstanding > 0:
        return 'overdue'
    return InvoiceStatus.SENT


def _uninvoiced_items(project):
    """The project's priced items not already on one of its invoices: the fee, then tasks."""
    already = InvoiceLine.objects.filter(invoice__project=project)
    items = []
    if project.client_fee and not already.filter(kind=InvoiceLineKind.PROJECT_FEE).exists():
        items.append((InvoiceLineKind.PROJECT_FEE, None, f'{project.name}: project fee', project.client_fee))
    billed_task_ids = set(already.filter(kind=InvoiceLineKind.TASK).values_list('task_id', flat=True))
    for task in _live_tasks(project).filter(client_price__gt=0).order_by('sort_order', 'created_at'):
        if task.id not in billed_task_ids:
            items.append((InvoiceLineKind.TASK, task, task.title, task.client_price))
    return items


@transaction.atomic
def create_invoice_from_project(*, project, user, due_date=None, notes=''):
    if project.client_team_id is None:
        raise BillingError('Link this project to a client before invoicing it.')
    items = _uninvoiced_items(project)
    if not items:
        raise BillingError('Nothing to invoice: set a project fee or task prices first (or everything is already invoiced).')
    settings = WorkspaceBillingSettings.objects.select_for_update().get(pk=billing_settings(project.workspace).pk)
    number = f'{settings.invoice_prefix}-{settings.next_invoice_number:04d}'
    settings.next_invoice_number += 1
    settings.save(update_fields=['next_invoice_number', 'updated_at'])
    invoice = Invoice.objects.create(
        workspace=project.workspace, client_team_id=project.client_team_id, project=project, number=number,
        currency=settings.currency, due_date=due_date, notes=notes or '', created_by_user=user,
    )
    InvoiceLine.objects.bulk_create([
        InvoiceLine(invoice=invoice, kind=kind, task=task, description=description[:255], amount=amount, sort_order=index)
        for index, (kind, task, description, amount) in enumerate(items)
    ])
    _audit(user=user, workspace=project.workspace, action='billing.invoice.created', entity_type='invoice', entity_id=invoice.id,
           number=number, total=money_str(invoice_total(invoice)))
    return invoice


@transaction.atomic
def send_invoice(*, invoice, user, today=None):
    invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
    if invoice.status != InvoiceStatus.DRAFT:
        raise BillingError('Only a draft invoice can be sent.', conflict=True)
    today = today or timezone.localdate()
    invoice.status = InvoiceStatus.SENT
    invoice.issue_date = today
    invoice.due_date = invoice.due_date or today + dt.timedelta(days=billing_settings(invoice.workspace).payment_terms_days)
    invoice.sent_at = timezone.now()
    invoice.save(update_fields=['status', 'issue_date', 'due_date', 'sent_at', 'updated_at'])
    # Demo: "sent" only changes the status. No email goes to the client.
    _audit(user=user, workspace=invoice.workspace, action='billing.invoice.sent', entity_type='invoice', entity_id=invoice.id,
           number=invoice.number)
    return invoice


@transaction.atomic
def delete_draft_invoice(*, invoice, user):
    invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
    if invoice.status != InvoiceStatus.DRAFT:
        raise BillingError('Only a draft invoice can be deleted.', conflict=True)
    _audit(user=user, workspace=invoice.workspace, action='billing.invoice.deleted', entity_type='invoice', entity_id=invoice.id,
           number=invoice.number)
    invoice.delete()


# --- THE payment path ---------------------------------------------------------------------

@transaction.atomic
def record_payment(*, workspace, amount=None, invoice=None, payee_membership=None, paid_on=None,
                   method=PaymentMethod.BANK_TRANSFER, note='', provider=PaymentProvider.MANUAL,
                   provider_reference=None, recorded_by=None):
    """Record money moving. The single path by which anything in Blaze Flow becomes paid.

    Exactly one of ``invoice`` (a client paying us: incoming) or ``payee_membership`` (us paying
    an editor: outgoing) is given. ``amount`` defaults to everything still outstanding/owed,
    which is what "Mark as paid (demo)" sends. Partial amounts are fine; overpaying is refused.
    An invoice becomes ``paid`` here, and only here, once nothing is outstanding.

    STRIPE / GATEWAY HOOK: today every caller passes ``provider='manual'``. A payment gateway's
    webhook (e.g. Stripe ``payment_intent.succeeded``) will verify the event signature, look up
    the invoice from the event metadata, and call this same function with
    ``provider='stripe'``, ``provider_reference=<PaymentIntent id>``, ``method='card'`` and
    ``recorded_by=None``. A repeat delivery with the same reference returns the existing row
    instead of paying twice. No gateway code, keys or webhooks exist in this demo.
    """
    if (invoice is None) == (payee_membership is None):
        raise BillingError('A payment is either against an invoice or a payout to a team member.')
    if provider not in PaymentProvider.values:
        raise BillingError(f'Unknown payment provider: {provider}.')
    if method not in PaymentMethod.values:
        raise BillingError(f'Unknown payment method: {method}.')
    if provider_reference:
        existing = Payment.objects.filter(provider=provider, provider_reference=provider_reference).first()
        if existing:
            return existing
    paid_on = paid_on or timezone.localdate()

    if invoice is not None:
        invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
        if invoice.workspace_id != workspace.id:
            raise BillingError('That invoice belongs to another workspace.')
        if invoice.status == InvoiceStatus.DRAFT:
            raise BillingError('Send the invoice before recording a payment against it.', conflict=True)
        currency = invoice.currency
        remaining = invoice_total(invoice) - invoice_paid(invoice)
        target = {'invoice': invoice, 'direction': PaymentDirection.INCOMING}
        what = 'invoice'
    else:
        payee_membership = WorkspaceMembership.objects.select_for_update().get(pk=payee_membership.pk)
        if payee_membership.workspace_id != workspace.id or payee_membership.principal_type != WorkspacePrincipalType.USER:
            raise BillingError('Payouts go to a team member of this workspace.')
        currency = workspace_currency(workspace)
        remaining = editor_balance(payee_membership)['owed_amount']
        target = {'payee_membership': payee_membership, 'direction': PaymentDirection.OUTGOING}
        what = 'payout'

    amount = remaining if amount in (None, '') else money(amount)
    if amount <= 0:
        raise BillingError('Nothing is outstanding.' if remaining <= 0 else 'Enter an amount above zero.', conflict=remaining <= 0)
    if amount > remaining:
        raise BillingError(f'That is more than the {money_str(remaining)} {currency} still {"outstanding" if what == "invoice" else "owed"}.')

    try:
        with transaction.atomic():
            payment = Payment.objects.create(
                workspace=workspace, amount=amount, currency=currency, paid_on=paid_on, method=method,
                note=note or '', provider=provider, provider_reference=provider_reference or None,
                recorded_by_user=recorded_by, **target,
            )
    except IntegrityError:
        # Lost a race with the same gateway event: the other delivery won, return its row.
        if provider_reference:
            return Payment.objects.get(provider=provider, provider_reference=provider_reference)
        raise

    if invoice is not None and amount == remaining:
        invoice.status = InvoiceStatus.PAID
        invoice.paid_at = timezone.now()
        invoice.save(update_fields=['status', 'paid_at', 'updated_at'])
    _audit(user=recorded_by, workspace=workspace, action=f'billing.{what}.payment_recorded', entity_type='payment',
           entity_id=payment.id, amount=money_str(amount), currency=currency, provider=provider)
    return payment


# --- editor pay ---------------------------------------------------------------------------

def is_approved_stage(stage) -> bool:
    return bool(stage) and stage.kind == TaskStageKind.APPROVED


def default_rate(membership):
    rate = MemberPayRate.objects.filter(workspace_membership=membership).first()
    return rate.default_task_rate if rate and rate.default_task_rate is not None else None


def set_default_rate(*, membership, user, amount):
    rate, _ = MemberPayRate.objects.get_or_create(workspace_membership=membership)
    rate.default_task_rate = None if amount in (None, '') else money(amount)
    rate.currency = workspace_currency(membership.workspace)
    rate.save()
    _audit(user=user, workspace=membership.workspace, action='billing.rate.set', entity_type='workspace_membership',
           entity_id=membership.id, amount=money_str(rate.default_task_rate))
    return rate


def ensure_assignee_pay(*, task, membership):
    """Called when someone is assigned: pre-fill their pay from their default rate, if any."""
    if membership.principal_type != WorkspacePrincipalType.USER:
        return None
    pay = EditorPay.objects.filter(task=task, workspace_membership=membership).first()
    if pay is None:
        rate = default_rate(membership)
        if rate is None:
            return None
        pay = EditorPay.objects.create(
            workspace_id=task.workspace_id, task=task, workspace_membership=membership, amount=rate,
            currency=workspace_currency(task.workspace),
        )
    if pay.status == EditorPayStatus.PENDING and task.task_stage_id and is_approved_stage(task.task_stage):
        _freeze(pay, timezone.now())
    return pay


def drop_pending_pay(*, task, membership):
    """Unassigning removes pay not yet earned. Earned pay stays: the work was approved."""
    EditorPay.objects.filter(task=task, workspace_membership=membership, status=EditorPayStatus.PENDING).delete()


@transaction.atomic
def set_editor_pay(*, task, membership, user, amount):
    if not TaskAssignee.objects.filter(task=task, workspace_membership=membership).exists():
        raise BillingError('Pay can only be set for someone assigned to the task.')
    pay = EditorPay.objects.select_for_update().filter(task=task, workspace_membership=membership).first()
    if pay and pay.status == EditorPayStatus.EARNED:
        raise BillingError('This pay was earned when the task was approved, so the amount is frozen.', conflict=True)
    if amount in (None, ''):
        if pay:
            pay.delete()
        return None
    amount = money(amount)
    if pay is None:
        pay = EditorPay(workspace_id=task.workspace_id, task=task, workspace_membership=membership, currency=workspace_currency(task.workspace))
    pay.amount = amount
    pay.save()
    if task.task_stage_id and is_approved_stage(task.task_stage):
        _freeze(pay, timezone.now())
    _audit(user=user, workspace=task.workspace, action='billing.editor_pay.set', entity_type='task', entity_id=task.id,
           membership_id=str(membership.id), amount=money_str(amount))
    return pay


def _freeze(pay, at):
    pay.status = EditorPayStatus.EARNED
    pay.earned_at = at
    pay.save(update_fields=['status', 'earned_at', 'updated_at'])


def freeze_task_earnings(*, task, at=None):
    """The task entered an Approved stage: every assignee's pay becomes earned and freezes.

    Assignees with no pay row but a default rate get one at that rate. Pay already earned is
    left alone, so moving a task out of Approved and back never changes a frozen amount.
    """
    at = at or timezone.now()
    for assignee in TaskAssignee.objects.filter(task=task).select_related('workspace_membership'):
        ensure_assignee_pay(task=task, membership=assignee.workspace_membership)
    for pay in EditorPay.objects.filter(task=task, status=EditorPayStatus.PENDING):
        _freeze(pay, at)


def on_task_stage_changed(*, task, from_stage):
    """Hook from services.tasks.update_task (and any other stage move)."""
    if is_approved_stage(task.task_stage) and not is_approved_stage(from_stage):
        freeze_task_earnings(task=task)


def editor_balance(membership) -> dict:
    pay = EditorPay.objects.filter(workspace_membership=membership, task__deleted_at__isnull=True)
    pending = _sum(pay.filter(status=EditorPayStatus.PENDING))
    earned = _sum(pay.filter(status=EditorPayStatus.EARNED))
    paid = _sum(Payment.objects.filter(payee_membership=membership, direction=PaymentDirection.OUTGOING))
    return {'pending_amount': pending, 'earned_amount': earned, 'paid_amount': paid, 'owed_amount': max(earned - paid, ZERO)}


def _balance_out(balance):
    return {key.replace('_amount', ''): money_str(value) for key, value in balance.items()}


def task_money(*, task, user, access) -> dict:
    """The money block of the task detail sheet, already cut down to what the viewer may see."""
    currency = workspace_currency(task.workspace)
    data = {'task_id': str(task.id), 'currency': currency, 'can_manage': access['manage']}
    if access['view']:
        data['client_price'] = money_str(task.client_price)
    see_all_pay = access['manage'] or access['rates_view']
    mine = own_membership(user=user, workspace=task.workspace)
    assignees = TaskAssignee.objects.filter(task=task).select_related('workspace_membership__user').order_by('assigned_at')
    pay_by_member = {pay.workspace_membership_id: pay for pay in EditorPay.objects.filter(task=task)}
    lines = []
    member_ids = [a.workspace_membership_id for a in assignees] + [mid for mid in pay_by_member if mid not in {a.workspace_membership_id for a in assignees}]
    names = {m.id: m for m in WorkspaceMembership.objects.filter(id__in=member_ids).select_related('user')}
    for membership_id in member_ids:
        if not see_all_pay and not (mine and membership_id == mine.id):
            continue
        membership = names.get(membership_id)
        if membership is None or membership.principal_type != WorkspacePrincipalType.USER:
            continue
        pay = pay_by_member.get(membership_id)
        lines.append({
            'membership_id': str(membership_id), 'name': _person(membership),
            'is_me': bool(mine and membership_id == mine.id),
            'amount': money_str(pay.amount) if pay else None,
            'default_rate': money_str(default_rate(membership)) if see_all_pay else None,
            'status': pay.status if pay else None,
            'earned_at': pay.earned_at if pay else None,
            'frozen': bool(pay and pay.status == EditorPayStatus.EARNED),
            'assigned': any(a.workspace_membership_id == membership_id for a in assignees),
        })
    data['editor_pay'] = lines
    return data


def _person(membership) -> str:
    user = membership.user
    return (user.get_full_name() or user.email) if user else 'Someone'


# --- read models --------------------------------------------------------------------------

def invoice_out(invoice, *, today=None, detail=False, workspace_profile=None) -> dict:
    total = invoice_total(invoice)
    paid = invoice_paid(invoice)
    outstanding = max(total - paid, ZERO)
    data = {
        'id': str(invoice.id), 'number': invoice.number, 'status': invoice.status,
        'display_status': invoice_display_status(invoice, today=today, outstanding=outstanding),
        'currency': invoice.currency, 'client': {'id': str(invoice.client_team_id), 'name': invoice.client_team.name},
        'project': {'id': str(invoice.project_id), 'name': invoice.project.name} if invoice.project_id else None,
        'issue_date': invoice.issue_date, 'due_date': invoice.due_date, 'sent_at': invoice.sent_at, 'paid_at': invoice.paid_at,
        'total': money_str(total), 'paid': money_str(paid), 'outstanding': money_str(outstanding),
        'created_at': invoice.created_at,
    }
    if detail:
        client = invoice.client_team
        data['notes'] = invoice.notes
        data['lines'] = [{'id': str(line.id), 'kind': line.kind, 'description': line.description, 'amount': money_str(line.amount),
                          'task_id': str(line.task_id) if line.task_id else None} for line in invoice.lines.all()]
        data['payments'] = [payment_out(payment) for payment in invoice.payments.order_by('paid_on', 'created_at')]
        data['bill_to'] = {
            'name': client.name, 'email': client.email, 'address_line_1': client.address_line_1, 'address_line_2': client.address_line_2,
            'city': client.city, 'region': client.state_region, 'postal_code': client.postal_code, 'country_code': client.country_code,
        }
        profile = workspace_profile
        data['from'] = {
            'name': (profile.business_name if profile and profile.business_name else invoice.workspace.name),
            'email': profile.email if profile else None,
            'address_line_1': profile.address_line_1 if profile else None, 'address_line_2': profile.address_line_2 if profile else None,
            'city': profile.city if profile else None, 'region': profile.state if profile else None,
            'postal_code': profile.postal_code if profile else None, 'country_code': profile.country_code if profile else None,
        }
    return data


def payment_out(payment) -> dict:
    return {
        'id': str(payment.id), 'direction': payment.direction, 'amount': money_str(payment.amount), 'currency': payment.currency,
        'paid_on': payment.paid_on, 'method': payment.method, 'note': payment.note, 'provider': payment.provider,
        'created_at': payment.created_at,
    }


def _invoices(workspace):
    return Invoice.objects.filter(workspace=workspace).select_related('client_team', 'project', 'workspace').prefetch_related('lines', 'payments')


def list_invoices(*, workspace, today=None):
    return [invoice_out(invoice, today=today) for invoice in _invoices(workspace).order_by('-created_at')]


def client_invoices(*, workspace, client_team_ids, today=None):
    """What a client-team member sees: their own client's invoices, never drafts."""
    rows = _invoices(workspace).filter(client_team_id__in=client_team_ids).exclude(status=InvoiceStatus.DRAFT).order_by('-issue_date', '-created_at')
    invoices = [invoice_out(invoice, today=today) for invoice in rows]
    outstanding = sum((Decimal(item['outstanding']) for item in invoices), ZERO)
    return {
        'currency': workspace_currency(workspace), 'results': invoices,
        'outstanding': money_str(outstanding),
        'overdue_count': sum(1 for item in invoices if item['display_status'] == 'overdue'),
    }


def receivables(*, workspace, today=None):
    """Per client: billed (sent or paid invoices), paid, outstanding, overdue, plus unbilled work."""
    today = today or timezone.localdate()
    clients = {team.id: team for team in ClientTeam.objects.filter(workspace=workspace).exclude(status=ClientTeamStatus.DELETED)}
    rows = {}

    def row(team_id):
        team = clients.get(team_id)
        return rows.setdefault(team_id, {
            'client': {'id': str(team_id), 'name': team.name if team else 'Unknown client'},
            'billed': ZERO, 'paid': ZERO, 'outstanding': ZERO, 'overdue': ZERO, 'unbilled': ZERO, 'invoice_count': 0,
        })

    for invoice in _invoices(workspace).exclude(status=InvoiceStatus.DRAFT):
        total, paid = invoice_total(invoice), invoice_paid(invoice)
        outstanding = max(total - paid, ZERO)
        entry = row(invoice.client_team_id)
        entry['billed'] += total
        entry['paid'] += paid
        entry['outstanding'] += outstanding
        entry['invoice_count'] += 1
        if invoice_display_status(invoice, today=today, outstanding=outstanding) == 'overdue':
            entry['overdue'] += outstanding
    for project in Project.objects.filter(workspace=workspace, client_team__isnull=False):
        pricing = project_pricing(project)
        # Unbilled = priced work not yet on a sent invoice (drafts count as unbilled).
        sent_lines = _sum(InvoiceLine.objects.filter(invoice__project=project).exclude(invoice__status=InvoiceStatus.DRAFT))
        unbilled = max(Decimal(pricing['total']) - sent_lines, ZERO)
        if unbilled:
            row(project.client_team_id)['unbilled'] += unbilled
    out = []
    for entry in sorted(rows.values(), key=lambda item: (-item['outstanding'], item['client']['name'])):
        out.append({**entry, **{key: money_str(entry[key]) for key in ('billed', 'paid', 'outstanding', 'overdue', 'unbilled')}})
    return out


def payouts_ledger(*, workspace):
    """Per team member with any pay: pending, earned, paid and owed, plus their payout entries."""
    member_ids = set(EditorPay.objects.filter(workspace=workspace).values_list('workspace_membership_id', flat=True))
    member_ids |= set(Payment.objects.filter(workspace=workspace, direction=PaymentDirection.OUTGOING).values_list('payee_membership_id', flat=True))
    member_ids |= set(MemberPayRate.objects.filter(workspace_membership__workspace=workspace, default_task_rate__isnull=False).values_list('workspace_membership_id', flat=True))
    out = []
    for membership in WorkspaceMembership.objects.filter(id__in=member_ids).select_related('user'):
        balance = editor_balance(membership)
        out.append({
            'membership_id': str(membership.id), 'name': _person(membership),
            'email': membership.user.email if membership.user else None,
            'active': membership.status == WorkspaceMembershipStatus.ACTIVE,
            'default_rate': money_str(default_rate(membership)),
            **_balance_out(balance),
            'payouts': [payment_out(p) for p in Payment.objects.filter(payee_membership=membership).order_by('-paid_on', '-created_at')[:10]],
        })
    return sorted(out, key=lambda item: (-Decimal(item['owed']), item['name']))


def money_summary(*, workspace, access, today=None):
    """The Money page and owner dashboard: totals, receivables, invoices and (if allowed) payouts."""
    today = today or timezone.localdate()
    currency = workspace_currency(workspace)
    clients = receivables(workspace=workspace, today=today)
    collected = _sum(Payment.objects.filter(workspace=workspace, direction=PaymentDirection.INCOMING))
    totals = {
        'clients_owe': money_str(sum((Decimal(row['outstanding']) for row in clients), ZERO)),
        'overdue': money_str(sum((Decimal(row['overdue']) for row in clients), ZERO)),
        'billed': money_str(sum((Decimal(row['billed']) for row in clients), ZERO)),
        'collected': money_str(collected),
        'unbilled': money_str(sum((Decimal(row['unbilled']) for row in clients), ZERO)),
    }
    data = {'currency': currency, 'totals': totals, 'receivables': clients, 'invoices': list_invoices(workspace=workspace, today=today)}
    if access['rates_view']:
        editors = payouts_ledger(workspace=workspace)
        editor_cost = _sum(EditorPay.objects.filter(workspace=workspace, task__deleted_at__isnull=True))
        project_value = ZERO
        for project in Project.objects.filter(workspace=workspace):
            project_value += Decimal(project_pricing(project)['total'])
        margin = project_value - editor_cost
        totals.update({
            'we_owe_editors': money_str(sum((Decimal(row['owed']) for row in editors), ZERO)),
            'editors_paid': money_str(sum((Decimal(row['paid']) for row in editors), ZERO)),
            'editors_pending': money_str(sum((Decimal(row['pending']) for row in editors), ZERO)),
            'project_value': money_str(project_value), 'editor_cost': money_str(editor_cost),
            'margin': money_str(margin),
            'margin_percent': float(round(margin / project_value * 100, 1)) if project_value else None,
        })
        data['payouts'] = editors
    return data


def my_earnings(*, membership):
    """An editor's own pay. No client prices, no margins, nobody else's pay."""
    balance = editor_balance(membership)
    lines = EditorPay.objects.filter(workspace_membership=membership, task__deleted_at__isnull=True).select_related('task__project').order_by('-earned_at', '-created_at')
    return {
        'currency': workspace_currency(membership.workspace), **_balance_out(balance),
        'lines': [{
            'task_id': str(pay.task_id), 'task': pay.task.title, 'project': pay.task.project.name if pay.task.project_id else None,
            'amount': money_str(pay.amount), 'status': pay.status, 'earned_at': pay.earned_at,
        } for pay in lines[:20]],
        'payouts': [payment_out(p) for p in Payment.objects.filter(payee_membership=membership).order_by('-paid_on')[:10]],
    }


def _audit(*, user, workspace, action, entity_type, entity_id, **metadata):
    # Billing events are team-only and outside the activity feed's closed set of actions, so
    # they never surface to editors or clients through the feed.
    return record_user_audit(user=user, workspace=workspace, action=action, entity_type=entity_type,
                             entity_id=entity_id, metadata=metadata, team_only=True)
