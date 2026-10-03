"""Read routes for the activity feed (see ``services/activity.py`` for who sees what)."""
from django.http import Http404, HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Project, Workspace
from .permissions import PROJECT_READ, WORKSPACE_MANAGE, WORKSPACE_READ, has_project_permission, has_workspace_permission
from .services.activity import (
    CSV_MAX_ROWS, ActivityFilterError, activity_csv, describe_rows, filter_activity, visible_activity,
)

ACTIVITY_PAGE_SIZE = 30
ACTIVITY_MAX_PAGE_SIZE = 100
# Exporting history is an admin task: the same permission that manages the workspace.
ACTIVITY_EXPORT_PERMISSION = WORKSPACE_MANAGE


def _int_param(request, name, default, *, low, high):
    raw = request.query_params.get(name)
    if raw in (None, ''):
        return default
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise ValidationError({name: f'{name} must be a whole number.'})
    if value < low or value > high:
        raise ValidationError({name: f'{name} must be between {low} and {high}.'})
    return value


def _scoped(request, workspace, project=None):
    if not has_workspace_permission(user=request.user, workspace=workspace, permission_key=WORKSPACE_READ):
        raise PermissionDenied('You do not have access to this workspace.')
    rows = visible_activity(user=request.user, workspace=workspace)
    try:
        return filter_activity(
            rows,
            project=project.id if project else request.query_params.get('project'),
            actor=request.query_params.get('actor'),
            types=request.query_params.get('type'),
        )
    except ActivityFilterError as exc:
        raise ValidationError({'detail': str(exc)}) from exc


def _project(request, workspace, project_id):
    project = get_object_or_404(Project, id=project_id, workspace=workspace)
    # 404, not 403: someone outside the project should not learn that it exists.
    if not has_project_permission(user=request.user, project=project, permission_key=PROJECT_READ):
        raise Http404('Project not found.')
    return project


def _page(request, workspace, rows):
    page = _int_param(request, 'page', 1, low=1, high=10_000)
    page_size = _int_param(request, 'page_size', ACTIVITY_PAGE_SIZE, low=1, high=ACTIVITY_MAX_PAGE_SIZE)
    offset = (page - 1) * page_size
    count = rows.count()
    chunk = list(rows[offset:offset + page_size])
    return Response({
        'results': describe_rows(chunk, user=request.user, workspace=workspace),
        'count': count,
        'page': page,
        'page_size': page_size,
        'has_next': offset + len(chunk) < count,
        'can_export': has_workspace_permission(user=request.user, workspace=workspace, permission_key=ACTIVITY_EXPORT_PERMISSION),
    })


def _csv(request, workspace, rows, name):
    if not has_workspace_permission(user=request.user, workspace=workspace, permission_key=ACTIVITY_EXPORT_PERMISSION):
        raise PermissionDenied('You do not have permission to export activity.')
    items = describe_rows(rows[:CSV_MAX_ROWS], user=request.user, workspace=workspace)
    response = HttpResponse(activity_csv(items), content_type='text/csv; charset=utf-8')
    stamp = timezone.now().strftime('%Y%m%d-%H%M')
    response['Content-Disposition'] = f'attachment; filename="{name}-activity-{stamp}.csv"'
    response['X-Activity-Truncated'] = 'true' if rows.count() > CSV_MAX_ROWS else 'false'
    return response


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def workspace_activity(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    return _page(request, workspace, _scoped(request, workspace))


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def workspace_activity_export(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    return _csv(request, workspace, _scoped(request, workspace), workspace.slug or 'workspace')


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def project_activity(request, workspace_id, project_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    project = _project(request, workspace, project_id)
    return _page(request, workspace, _scoped(request, workspace, project))


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def project_activity_export(request, workspace_id, project_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    project = _project(request, workspace, project_id)
    return _csv(request, workspace, _scoped(request, workspace, project), 'project')
