"""``GET /api/workspaces/<id>/permissions/[?project_id=<id>]``: what the viewer may do here.

The UI used to discover permissions by trying: a list that 403'd meant "read-only", a write
that failed showed an error after the fact. That works for reads but not for controls —
a read-only member was handed a comment composer that could only fail. This answers the
question up front, with exactly the rules the API enforces (``permissions.py``):

- ``workspace``: keys any of the viewer's active memberships grants here (their own and any
  client team's), the same union ``has_workspace_permission`` checks.
- ``project``: keys that apply on that project, the same as ``has_project_permission`` — a
  membership counts if it reaches every project or was given that one.

Billing keys only count on the viewer's own membership, as ``billing.billing_access`` does.
It is a hint for the UI; every write is still checked on its own route.
"""
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import (
    Project, ProjectAccessMode, ResourceAccess, RolePermission, RoleStatus, Workspace, WorkspacePrincipalType,
)
from .permissions import BILLING_PERMISSION_KEYS, active_memberships_for_user
from .services.dashboard import dashboard_role


def _keys_by_membership(memberships):
    role_ids = {membership.role_id for membership in memberships if membership.role_id}
    by_role = {}
    for role_id, key in RolePermission.objects.filter(role_id__in=role_ids, role__status=RoleStatus.ACTIVE).values_list('role_id', 'permission_key'):
        by_role.setdefault(role_id, set()).add(key)
    result = {}
    for membership in memberships:
        keys = set(by_role.get(membership.role_id, ()))
        if membership.principal_type != WorkspacePrincipalType.USER:
            keys -= set(BILLING_PERMISSION_KEYS)
        result[membership.id] = keys
    return result


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def workspace_permissions(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    memberships = list(active_memberships_for_user(user=request.user, workspace=workspace))
    if not memberships:
        raise PermissionDenied('You do not have access to this workspace.')
    keys = _keys_by_membership(memberships)
    workspace_keys = set().union(*keys.values())

    project_payload = None
    project_id = request.query_params.get('project_id')
    if project_id:
        project = get_object_or_404(Project, id=project_id, workspace=workspace)
        granted = set(ResourceAccess.objects.filter(
            workspace_membership_id__in=[membership.id for membership in memberships], project=project,
        ).values_list('workspace_membership_id', flat=True))
        project_keys = set()
        for membership in memberships:
            if membership.project_access_mode == ProjectAccessMode.ALL or membership.id in granted:
                project_keys |= keys[membership.id]
        project_payload = {'id': str(project.id), 'permissions': sorted(project_keys)}

    return Response({
        'workspace_id': str(workspace.id),
        'dashboard_role': dashboard_role(user=request.user, workspace=workspace),
        'permissions': sorted(workspace_keys),
        'project': project_payload,
    })
