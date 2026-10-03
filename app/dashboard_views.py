"""Read routes behind the role-based dashboards (see ``services/dashboard.py``)."""
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Workspace
from .permissions import WORKSPACE_READ, has_workspace_permission
from .services.dashboard import ROLE_OWNER, dashboard_role, my_cuts, notes_to_address, team_workload

DEFAULT_LIMIT = 20
MAX_LIMIT = 100


def _workspace(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    if not has_workspace_permission(user=request.user, workspace=workspace, permission_key=WORKSPACE_READ):
        raise PermissionDenied('You do not have access to this workspace.')
    return workspace


def _limit(request):
    raw = request.query_params.get('limit')
    if raw in (None, ''):
        return DEFAULT_LIMIT
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise ValidationError({'limit': 'limit must be a whole number.'})
    if value < 1 or value > MAX_LIMIT:
        raise ValidationError({'limit': f'limit must be between 1 and {MAX_LIMIT}.'})
    return value


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def dashboard_notes_to_address(request, workspace_id):
    """Unresolved notes from others on the viewer's cuts (uploaded, or linked to their tasks)."""
    workspace = _workspace(request, workspace_id)
    return Response(notes_to_address(user=request.user, workspace=workspace, limit=_limit(request)))


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def dashboard_my_cuts(request, workspace_id):
    """The viewer's own cuts with their workflow stage."""
    workspace = _workspace(request, workspace_id)
    return Response(my_cuts(user=request.user, workspace=workspace, limit=_limit(request)))


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def dashboard_workload(request, workspace_id):
    """Open tasks per team member. Owners only: it is an oversight view of everyone's load."""
    workspace = _workspace(request, workspace_id)
    if dashboard_role(user=request.user, workspace=workspace) != ROLE_OWNER:
        raise PermissionDenied('Only workspace owners and admins can see team workload.')
    return Response(team_workload(user=request.user, workspace=workspace, now=timezone.now()))
