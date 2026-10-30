"""One client's overview: project counts, progress, the editors on its projects and (for
people who hold ``billing.view``) what the client has paid.

Only team members reach it: the viewer needs ``client_team.read`` on their own USER
membership, so a client-team membership never opens another client's numbers (or its own,
which belong to the portal). Projects are scoped to what the viewer may read, and money is
omitted entirely, not zeroed, for anyone without ``billing.view``.

Everything is a fixed number of aggregate queries, independent of how many projects,
tasks or editors the client has.
"""
from decimal import Decimal

from django.db.models import Count, Q, Sum
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import (
    ClientTeam, Invoice, InvoiceStatus, Payment, PaymentDirection, Project, ProjectAccessMode, ProjectStatus,
    ResourceAccess, Task, TaskAssignee, TaskStageKind, TaskStatus, Workspace, WorkspacePrincipalType,
)
from .permissions import BILLING_VIEW, CLIENT_TEAM_READ, PROJECT_READ, memberships_with_permission
from .services.billing import CENT, ZERO, money_str, workspace_currency

COMPLETED_STATUSES = (ProjectStatus.COMPLETED, ProjectStatus.ARCHIVED)
ONGOING_STATUSES = (ProjectStatus.DRAFT, ProjectStatus.ACTIVE, ProjectStatus.ON_HOLD)
DONE_TASK = Q(status__in=(TaskStatus.APPROVED, TaskStatus.COMPLETED)) | Q(task_stage__kind=TaskStageKind.APPROVED)


def _team_memberships(user, workspace, key):
    return memberships_with_permission(user=user, workspace=workspace, permission_key=key).filter(
        principal_type=WorkspacePrincipalType.USER,
    )


def _readable_projects(user, workspace):
    memberships = _team_memberships(user, workspace, PROJECT_READ)
    projects = Project.objects.filter(workspace=workspace)
    if memberships.filter(project_access_mode=ProjectAccessMode.ALL).exists():
        return projects
    return projects.filter(id__in=ResourceAccess.objects.filter(workspace_membership__in=memberships).values('project_id'))


def _name(first, last, email):
    return f'{first or ""} {last or ""}'.strip() or email


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def client_team_overview(request, workspace_id, client_team_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    if not _team_memberships(request.user, workspace, CLIENT_TEAM_READ).exists():
        raise PermissionDenied('You do not have permission to perform this action.')
    client_team = get_object_or_404(ClientTeam, id=client_team_id, workspace=workspace)

    projects = list(
        _readable_projects(request.user, workspace)
        .filter(client_team=client_team, status__in=COMPLETED_STATUSES + ONGOING_STATUSES)
        .values('id', 'name', 'status', 'priority', 'due_at', 'updated_at')
        .order_by('due_at', 'name')
    )
    project_ids = [row['id'] for row in projects]

    # Progress: approved/completed tasks over live, non-cancelled tasks, one grouped query.
    live = Task.objects.filter(project_id__in=project_ids, deleted_at__isnull=True).exclude(status=TaskStatus.CANCELLED)
    progress = {
        row['project_id']: row for row in live.values('project_id').annotate(total=Count('id'), done=Count('id', filter=DONE_TASK))
    }

    # Editors: everyone assigned to a live task on these projects, with how many projects.
    editors = list(
        TaskAssignee.objects.filter(
            task__project_id__in=project_ids, task__deleted_at__isnull=True,
            workspace_membership__principal_type=WorkspacePrincipalType.USER,
        )
        .values(
            'workspace_membership_id', 'workspace_membership__user__first_name', 'workspace_membership__user__last_name',
            'workspace_membership__user__email', 'workspace_membership__user__avatar_url', 'workspace_membership__role__name',
        )
        .annotate(project_count=Count('task__project_id', distinct=True))
        .order_by('-project_count', 'workspace_membership__user__first_name')
    )

    def project_row(row):
        stats = progress.get(row['id'], {'total': 0, 'done': 0})
        return {
            'id': str(row['id']), 'name': row['name'], 'status': row['status'], 'priority': row['priority'],
            'due_at': row['due_at'], 'updated_at': row['updated_at'],
            'tasks_total': stats['total'], 'tasks_done': stats['done'],
            'progress': round(100 * stats['done'] / stats['total']) if stats['total'] else 0,
        }

    ongoing = [project_row(row) for row in projects if row['status'] in ONGOING_STATUSES]
    completed = sorted((project_row(row) for row in projects if row['status'] in COMPLETED_STATUSES),
                       key=lambda row: row['updated_at'], reverse=True)

    data = {
        'client_team_id': str(client_team.id),
        'counts': {'ongoing': len(ongoing), 'completed': len(completed), 'editors': len(editors)},
        'ongoing_projects': ongoing,
        'completed_projects': completed,
        'editors': [{
            'membership_id': str(row['workspace_membership_id']),
            'name': _name(row['workspace_membership__user__first_name'], row['workspace_membership__user__last_name'],
                          row['workspace_membership__user__email']),
            'email': row['workspace_membership__user__email'],
            'avatar_url': row['workspace_membership__user__avatar_url'],
            'role': row['workspace_membership__role__name'] or 'Member',
            'project_count': row['project_count'],
        } for row in editors],
        'money': None,
    }

    if _team_memberships(request.user, workspace, BILLING_VIEW).exists():
        currency = workspace_currency(workspace)
        # Paid = incoming payments recorded against this client's invoices (the only source of "paid").
        paid = Payment.objects.filter(
            workspace=workspace, direction=PaymentDirection.INCOMING, invoice__client_team=client_team, currency=currency,
        ).aggregate(total=Sum('amount'))['total'] or ZERO
        # Agreed = project fees + per-task client prices on the client's projects (all, not only readable).
        client_projects = Project.objects.filter(workspace=workspace, client_team=client_team).exclude(status=ProjectStatus.PENDING_DELETION)
        fees = client_projects.aggregate(total=Sum('client_fee'))['total'] or ZERO
        task_prices = Task.objects.filter(project__in=client_projects, deleted_at__isnull=True).aggregate(
            total=Sum('client_price'))['total'] or ZERO
        invoices = Invoice.objects.filter(workspace=workspace, client_team=client_team).exclude(status=InvoiceStatus.DRAFT)
        data['money'] = {
            'currency': currency,
            'paid': money_str(Decimal(paid).quantize(CENT)),
            'agreed': money_str(Decimal(fees + task_prices).quantize(CENT)),
            **invoices.aggregate(
                invoices_issued=Count('id'),
                # Read-only count of settled invoices (a fully paid invoice has no balance left).
                invoices_paid=Count('id', filter=~Q(status__in=[InvoiceStatus.DRAFT, InvoiceStatus.SENT])),
            ),
        }
    return Response(data)
