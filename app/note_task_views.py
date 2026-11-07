"""API for review notes ↔ tasks (see services/note_tasks.py)."""
from django.shortcuts import get_object_or_404
from django.utils.dateparse import parse_datetime
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import MediaVersion, Workspace
from .permissions import MEDIA_READ, WORKSPACE_READ, has_project_permission, has_workspace_permission
from .services.note_tasks import (
    NoteTaskError, carry_over_notes, carry_over_status, create_tasks_from_notes, defaults, links_for_version,
)


def _workspace(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    if not has_workspace_permission(user=request.user, workspace=workspace, permission_key=WORKSPACE_READ):
        raise PermissionDenied('You do not have access to this workspace.')
    return workspace


def _version(request, workspace_id, project_id, version_id):
    version = get_object_or_404(MediaVersion.objects.select_related('project__workspace'), id=version_id, project_id=project_id, project__workspace_id=workspace_id)
    if not has_project_permission(user=request.user, project=version.project, permission_key=MEDIA_READ):
        raise PermissionDenied('You do not have access to this cut.')
    return version


def _error(exc):
    return Response({'detail': str(exc)}, status=exc.status)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def note_task_defaults(request, workspace_id):
    workspace = _workspace(request, workspace_id)
    try:
        return Response(defaults(user=request.user, workspace=workspace, comment_id=request.query_params.get('comment')))
    except NoteTaskError as exc:
        return _error(exc)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def note_tasks_create(request, workspace_id):
    workspace = _workspace(request, workspace_id)
    data = request.data
    due = data.get('due_at')
    try:
        results = create_tasks_from_notes(
            user=request.user, workspace=workspace, comment_ids=list(data.get('comment_ids') or []),
            title=(data.get('title') or '').strip() or None, description=data.get('description'),
            assignee_id=data.get('assignee_id') or None, due_at=parse_datetime(due) if due else None,
            task_stage_id=data.get('task_stage_id') or None, sync_note_resolution=bool(data.get('sync_note_resolution', True)),
        )
    except NoteTaskError as exc:
        return _error(exc)
    created = any(row['created'] for row in results)
    return Response({'results': results}, status=201 if created else 200)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def version_note_tasks(request, workspace_id, project_id, version_id):
    version = _version(request, workspace_id, project_id, version_id)
    return Response({'links': links_for_version(user=request.user, version=version), 'carry_over': carry_over_status(user=request.user, version=version)})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def version_carry_over(request, workspace_id, project_id, version_id):
    version = _version(request, workspace_id, project_id, version_id)
    try:
        return Response(carry_over_notes(user=request.user, version=version), status=201)
    except NoteTaskError as exc:
        return _error(exc)
