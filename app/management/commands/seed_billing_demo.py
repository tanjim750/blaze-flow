"""Load believable demo money into a workspace: prices, invoices, payments, editor pay, a payout.

    python manage.py seed_billing_demo --workspace blackfen-studio
    python manage.py seed_billing_demo --workspace blackfen-studio --reset   # wipe and re-seed

Everything is written through services/billing.py, so payments go through record_payment()
(provider 'manual') exactly as the UI does. No emails or notifications are sent. It only
adds money: projects, tasks and people stay as they are, except that ``--history`` (on by
default) adds two already-approved tasks for the busiest editor so "earned" and "paid"
have something to show. Pass ``--no-history`` to skip that.
"""
import datetime as dt
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from app.models import (
    ClientTeam, EditorPay, Invoice, InvoiceLine, MemberPayRate, Payment, Project, Task, TaskAssignee,
    TaskStage, TaskStageKind, Workspace, WorkspaceMembership, WorkspaceMembershipStatus, WorkspacePrincipalType,
    WorkspaceProfile,
)
from app.services import billing
from app.services.tasks import add_task_assignee, create_task, update_task

FEES = (Decimal('4800'), Decimal('2400'), Decimal('6200'), Decimal('3500'), Decimal('1800'))
TASK_PRICES = (Decimal('450'), Decimal('300'), Decimal('250'), Decimal('600'), Decimal('180'))
RATES = (Decimal('220'), Decimal('180'), Decimal('200'), Decimal('160'), Decimal('240'))
CITIES = {'Bristol': ('14 Harbourside Lane', 'BS1 5TT'), 'Manchester': ('3 Ancoats Yard', 'M4 6BU'),
          'Edinburgh': ('22 Leith Walk', 'EH6 8LP'), 'Leeds': ('9 Calls Landing', 'LS2 7EW'), 'London': ('Unit 4, 61 Hackney Road', 'E2 8ET')}


class Command(BaseCommand):
    help = 'Seed demo billing data (prices, invoices, payments, editor pay, a payout) into one workspace.'

    def add_arguments(self, parser):
        parser.add_argument('--workspace', help='Workspace slug. Optional when there is only one workspace.')
        parser.add_argument('--reset', action='store_true', help='Delete this workspace\'s billing data first.')
        parser.add_argument('--no-history', dest='history', action='store_false', help='Do not add the two approved history tasks.')

    def handle(self, *args, workspace=None, reset=False, history=True, **options):
        workspace = self._workspace(workspace)
        with transaction.atomic():
            if reset:
                self._reset(workspace)
            elif Invoice.objects.filter(workspace=workspace).exists() or EditorPay.objects.filter(workspace=workspace).exists():
                raise CommandError('This workspace already has billing data. Re-run with --reset to replace it.')
            self._seed(workspace, history=history)

    # -----------------------------------------------------------------------------------
    def _workspace(self, slug):
        if slug:
            found = Workspace.objects.filter(slug=slug).first()
            if not found:
                raise CommandError(f'No workspace with slug {slug!r}.')
            return found
        workspaces = list(Workspace.objects.all()[:2])
        if len(workspaces) != 1:
            raise CommandError('Pass --workspace <slug>: there is not exactly one workspace.')
        return workspaces[0]

    def _reset(self, workspace):
        Payment.objects.filter(workspace=workspace).delete()
        InvoiceLine.objects.filter(invoice__workspace=workspace).delete()
        Invoice.objects.filter(workspace=workspace).delete()
        EditorPay.objects.filter(workspace=workspace).delete()
        MemberPayRate.objects.filter(workspace_membership__workspace=workspace).delete()
        Project.objects.filter(workspace=workspace).update(client_fee=None, client_fee_currency=None)
        Task.objects.filter(workspace=workspace).update(client_price=None, client_price_currency=None)
        # Drop history tasks from an earlier run so a reset does not stack them up.
        Task.objects.filter(workspace=workspace, description__startswith='[billing demo]').update(deleted_at=timezone.now())
        settings = billing.billing_settings(workspace)
        settings.next_invoice_number = 1
        settings.save()

    def _seed(self, workspace, *, history):
        today = timezone.localdate()
        settings = billing.billing_settings(workspace)
        settings.currency = settings.currency or 'GBP'
        settings.save()
        self._addresses(workspace)
        editors = list(WorkspaceMembership.objects.filter(
            workspace=workspace, principal_type=WorkspacePrincipalType.USER, status=WorkspaceMembershipStatus.ACTIVE, is_primary_owner=False,
        ).select_related('user').order_by('user__email'))
        for index, membership in enumerate(editors):
            billing.set_default_rate(membership=membership, user=None, amount=RATES[index % len(RATES)])

        projects = list(Project.objects.filter(workspace=workspace).order_by('created_at'))
        for index, project in enumerate(projects):
            billing.set_project_fee(project=project, user=None, amount=FEES[index % len(FEES)])
        tasks = list(Task.objects.filter(workspace=workspace, deleted_at__isnull=True, project__isnull=False).order_by('created_at'))
        for index, task in enumerate(tasks):
            if index % 2 == 0:
                billing.set_task_price(task=task, user=None, amount=TASK_PRICES[(index // 2) % len(TASK_PRICES)])

        # Editor pay: every non-owner assignee gets their default rate (bumped for priced work).
        editor_ids = {membership.id for membership in editors}
        for task in tasks:
            for assignee in TaskAssignee.objects.filter(task=task, workspace_membership_id__in=editor_ids):
                amount = billing.default_rate(assignee.workspace_membership) or Decimal('150')
                if task.client_price:
                    amount += Decimal('40')
                billing.set_editor_pay(task=task, membership=assignee.workspace_membership, user=None, amount=amount)

        busiest = None
        if history and editors:
            counts = {membership.id: TaskAssignee.objects.filter(workspace_membership=membership).count() for membership in editors}
            busiest = max(editors, key=lambda membership: (counts[membership.id], membership.user.email == 'maya@northlight.studio'))
            self._history(workspace, busiest, projects, today)

        invoices = self._invoices(workspace, projects, today)
        payout = self._payout(workspace, busiest, today) if busiest else None

        summary = billing.money_summary(workspace=workspace, access={'view': True, 'manage': True, 'rates_view': True}, today=today)
        totals = summary['totals']
        self.stdout.write(self.style.SUCCESS(
            f"Seeded billing for {workspace.name}: {len(invoices)} invoices, clients owe {totals['clients_owe']} {summary['currency']}, "
            f"we owe editors {totals['we_owe_editors']}, margin {totals['margin']}"
            + (f", payout {payout.amount} to {busiest.user.email}" if payout else '') + '.'
        ))

    def _addresses(self, workspace):
        profile = WorkspaceProfile.objects.filter(workspace=workspace).first()
        if profile and not profile.address_line_1:
            line, postcode = CITIES.get(profile.city or 'London', CITIES['London'])
            profile.address_line_1, profile.postal_code = line, profile.postal_code or postcode
            profile.city = profile.city or 'London'
            profile.country_code = profile.country_code or 'GB'
            profile.email = profile.email or f'accounts@{workspace.slug}.example'
            profile.save()
        for team in ClientTeam.objects.filter(workspace=workspace):
            if not team.address_line_1 and team.city in CITIES:
                team.address_line_1, team.postal_code = CITIES[team.city][0], team.postal_code or CITIES[team.city][1]
                team.country_code = team.country_code or 'GB'
                team.save(update_fields=['address_line_1', 'postal_code', 'country_code'])

    def _history(self, workspace, membership, projects, today):
        """Two delivered tasks for one editor, moved into Approved so their pay is earned."""
        approved = TaskStage.objects.filter(workspace=workspace, kind=TaskStageKind.APPROVED).first()
        todo = TaskStage.objects.filter(workspace=workspace).order_by('sort_order').first()
        assigned_projects = Project.objects.filter(
            id__in=TaskAssignee.objects.filter(workspace_membership=membership).values('task__project_id'), client_team__isnull=False,
        ).order_by('created_at')
        project = assigned_projects.first() or next((p for p in projects if p.client_team_id), None)
        if not (approved and todo and project):
            return
        for title, price, pay in (('Teaser 15s: final delivery', Decimal('350'), Decimal('260')),
                                  ('Hero 30s: v1 assembly', Decimal('500'), Decimal('320'))):
            task = create_task(workspace=workspace, created_by_membership=membership, project=project, client_team=project.client_team,
                               task_stage=todo, title=title, description='[billing demo] delivered work for the money demo.')
            add_task_assignee(task=task, membership=membership)
            billing.set_task_price(task=task, user=None, amount=price)
            billing.set_editor_pay(task=task, membership=membership, user=None, amount=pay)
            update_task(task=task, task_stage=approved)  # freezes the pay as earned

    def _invoices(self, workspace, projects, today):
        """Paid in full, part-paid, overdue, and one draft, across the client projects."""
        billable = [project for project in projects if project.client_team_id]
        plans = (
            ('paid', 34, 20, ((Decimal('0.5'), 30, 'Deposit'), (None, 12, 'Balance'))),
            ('partial', 9, -12, ((Decimal('0.4'), 4, '40% deposit'),)),
            ('overdue', 26, 6, ()),
            ('draft', 0, 0, ()),
        )
        out = []
        for project, (kind, issued_days_ago, overdue_days, payments) in zip(billable, plans):
            try:
                invoice = billing.create_invoice_from_project(project=project, user=None, notes='Thank you for your business. Bank transfer to the account on file.')
            except billing.BillingError:
                continue
            if kind != 'draft':
                issued = today - dt.timedelta(days=issued_days_ago)
                invoice.due_date = issued + dt.timedelta(days=issued_days_ago - overdue_days) if kind != 'partial' else today + dt.timedelta(days=-overdue_days)
                invoice.save(update_fields=['due_date'])
                billing.send_invoice(invoice=invoice, user=None, today=issued)
                total = billing.invoice_total(invoice)
                for share, days_ago, note in payments:
                    amount = (total * share).quantize(Decimal('1')) if share is not None else None
                    billing.record_payment(workspace=workspace, invoice=invoice, amount=amount, paid_on=today - dt.timedelta(days=days_ago),
                                           method='bank_transfer', note=note, provider='manual', recorded_by=None)
            out.append(invoice)
        return out

    def _payout(self, workspace, membership, today):
        owed = billing.editor_balance(membership)['owed_amount']
        if owed <= 0:
            return None
        # Pay most of it: the newest earning stays owed so "owed" is not zero in the demo.
        newest = EditorPay.objects.filter(workspace_membership=membership, status='earned').order_by('-earned_at').first()
        amount = owed - (newest.amount if newest and newest.amount < owed else Decimal('0'))
        return billing.record_payment(workspace=workspace, payee_membership=membership, amount=amount,
                                      paid_on=today - dt.timedelta(days=3), method='bank_transfer',
                                      note='September payout', provider='manual', recorded_by=None)

