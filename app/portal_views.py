"""Client portal v2 routes: branding, the client's project page, project requests."""
from django.core.files.storage import default_storage
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .models import Project, ProjectRequest, ProjectRequestStatus, ProjectStatus, Workspace, WorkspaceProfile
from .permissions import (
    MEDIA_DOWNLOAD, MEDIA_READ, PROJECT_CREATE, PROJECT_READ, WORKSPACE_MANAGE, active_memberships_for_user,
    has_project_permission, has_workspace_permission, memberships_with_permission,
)
from .serializers.projects import ASPECT_RATIOS, PLATFORMS
from .services.portal import (
    BUDGET_RANGES, DELIVERABLE_KINDS, PortalError, accept_request, branding_for, clear_logo, client_memberships,
    decline_request, project_overview, request_data, set_logo, submit_request, update_branding, withdraw_request,
)
from .services.subscriptions import SubscriptionError


def _error(exc):
    return Response({'detail': str(exc)}, status=exc.status)


def _workspace(workspace_id, request):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    if not active_memberships_for_user(user=request.user, workspace=workspace).exists():
        raise PermissionDenied('You are not a member of this workspace.')
    return workspace


# ------------------------------------------------------------------- branding

class BrandingSerializer(serializers.Serializer):
    brand_color = serializers.CharField(max_length=7, required=False, allow_blank=True, allow_null=True)
    portal_welcome = serializers.CharField(max_length=280, required=False, allow_blank=True, allow_null=True)


class LogoSerializer(serializers.Serializer):
    file = serializers.FileField()


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated])
def workspace_branding(request, workspace_id):
    workspace = _workspace(workspace_id, request)
    if request.method == 'PATCH':
        if not has_workspace_permission(user=request.user, workspace=workspace, permission_key=WORKSPACE_MANAGE):
            raise PermissionDenied('You do not have permission to change the studio branding.')
        serializer = BrandingSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            update_branding(workspace=workspace, user=request.user, changes=dict(serializer.validated_data))
        except PortalError as exc:
            return _error(exc)
    data = branding_for(workspace)
    data['can_edit'] = has_workspace_permission(user=request.user, workspace=workspace, permission_key=WORKSPACE_MANAGE)
    return Response(data)


@api_view(['POST', 'DELETE'])
@permission_classes([IsAuthenticated])
def workspace_branding_logo(request, workspace_id):
    workspace = _workspace(workspace_id, request)
    if not has_workspace_permission(user=request.user, workspace=workspace, permission_key=WORKSPACE_MANAGE):
        raise PermissionDenied('You do not have permission to change the studio branding.')
    if request.method == 'DELETE':
        clear_logo(workspace=workspace, user=request.user)
        return Response(branding_for(workspace))
    serializer = LogoSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        set_logo(workspace=workspace, user=request.user, upload=serializer.validated_data['file'])
    except PortalError as exc:
        return _error(exc)
    return Response(branding_for(workspace), status=status.HTTP_201_CREATED)


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def public_studio_logo(request, workspace_id):
    """A studio's logo. Public on purpose: it is what an upload page shows someone with no account."""
    profile = WorkspaceProfile.objects.filter(workspace_id=workspace_id).first()
    if not profile or not profile.logo_object_key or not default_storage.exists(profile.logo_object_key):
        raise Http404('No logo.')
    response = FileResponse(default_storage.open(profile.logo_object_key, 'rb'), content_type=profile.logo_mime_type or 'application/octet-stream')
    response['Cache-Control'] = 'public, max-age=86400'
    response['X-Content-Type-Options'] = 'nosniff'
    response['Content-Security-Policy'] = "default-src 'none'"
    return response


# ----------------------------------------------------------- project overview

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def client_project_overview(request, workspace_id, project_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    project = get_object_or_404(Project.objects.select_related('client_team', 'workspace'), id=project_id, workspace=workspace)
    if project.status in (ProjectStatus.ARCHIVED, ProjectStatus.PENDING_DELETION) or not has_project_permission(
        user=request.user, project=project, permission_key=PROJECT_READ,
    ):
        raise Http404('Project not found.')
    data = project_overview(
        project=project,
        can_see_media=has_project_permission(user=request.user, project=project, permission_key=MEDIA_READ),
        can_download=has_project_permission(user=request.user, project=project, permission_key=MEDIA_DOWNLOAD),
    )
    data['branding'] = branding_for(workspace)
    return Response(data)


# ----------------------------------------------------------- project requests

class DeliverableSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=tuple(DELIVERABLE_KINDS))
    quantity = serializers.IntegerField(min_value=1, max_value=50, default=1)


class ProjectRequestSerializer(serializers.Serializer):
    client_team_id = serializers.UUIDField(required=False)
    title = serializers.CharField(max_length=200)
    deliverables = DeliverableSerializer(many=True)
    platform = serializers.ChoiceField(choices=PLATFORMS, required=False, allow_null=True, allow_blank=True)
    aspect_ratio = serializers.ChoiceField(choices=ASPECT_RATIOS, required=False, allow_null=True, allow_blank=True)
    target_length_seconds = serializers.IntegerField(min_value=1, max_value=24 * 3600, required=False, allow_null=True)
    brief = serializers.CharField(max_length=5000)
    references = serializers.CharField(max_length=2000, required=False, allow_blank=True)
    wanted_by = serializers.DateField(required=False, allow_null=True)
    budget_range = serializers.ChoiceField(choices=BUDGET_RANGES, required=False, allow_blank=True)


class ProjectRequestActionSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=('accept', 'decline', 'withdraw'))
    note = serializers.CharField(max_length=2000, required=False, allow_blank=True)
    name = serializers.CharField(max_length=200, required=False, allow_blank=True)


def _client_request_memberships(request, workspace):
    return [
        membership for membership in client_memberships(user=request.user, workspace=workspace)
        if memberships_with_permission(user=request.user, workspace=workspace, permission_key=PROJECT_READ).filter(id=membership.id).exists()
    ]


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def project_requests(request, workspace_id):
    workspace = _workspace(workspace_id, request)
    is_team = memberships_with_permission(user=request.user, workspace=workspace, permission_key=PROJECT_CREATE).filter(principal_type='USER').exists()
    client_side = _client_request_memberships(request, workspace)
    if request.method == 'GET':
        rows = ProjectRequest.objects.filter(workspace=workspace).select_related('client_team', 'decided_by_user', 'requested_by_user')
        if not is_team:
            if not client_side:
                raise PermissionDenied('You cannot see project requests in this workspace.')
            rows = rows.filter(client_team_id__in=[membership.client_team_id for membership in client_side])
        wanted = request.query_params.get('status')
        if wanted:
            rows = rows.filter(status=wanted)
        return Response({
            'viewer': 'team' if is_team else 'client',
            'can_request': bool(client_side),
            'client_teams': [{'id': str(m.client_team_id), 'name': m.client_team.name} for m in client_side],
            'pending_count': ProjectRequest.objects.filter(workspace=workspace, status=ProjectRequestStatus.PENDING).count() if is_team else None,
            'requests': [request_data(row, for_team=is_team) for row in rows.order_by('-created_at')[:200]],
        })
    if not client_side:
        raise PermissionDenied('Only client contacts can ask for a new project here.')
    serializer = ProjectRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = dict(serializer.validated_data)
    team_id = data.pop('client_team_id', None)
    membership = next((m for m in client_side if team_id is None or m.client_team_id == team_id), None)
    if membership is None:
        raise PermissionDenied('You are not a contact for that client.')
    try:
        created = submit_request(user=request.user, membership=membership, data=data)
    except PortalError as exc:
        return _error(exc)
    return Response(request_data(created, for_team=False), status=status.HTTP_201_CREATED)


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def project_request_detail(request, workspace_id, request_id):
    workspace = _workspace(workspace_id, request)
    row = get_object_or_404(ProjectRequest.objects.select_related('client_team', 'workspace', 'requested_by_user'), id=request_id, workspace=workspace)
    serializer = ProjectRequestActionSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    action = serializer.validated_data['action']
    note = serializer.validated_data.get('note', '')
    try:
        if action == 'withdraw':
            if row.requested_by_user_id != request.user.id:
                raise PermissionDenied('Only the person who sent a request can withdraw it.')
            row = withdraw_request(request=row, user=request.user)
            return Response(request_data(row, for_team=False))
        membership = memberships_with_permission(user=request.user, workspace=workspace, permission_key=PROJECT_CREATE).filter(principal_type='USER').first()
        if membership is None:
            raise PermissionDenied('You do not have permission to answer project requests.')
        if action == 'accept':
            row = accept_request(request=row, user=request.user, membership=membership, name=serializer.validated_data.get('name'), note=note)
        else:
            row = decline_request(request=row, user=request.user, note=note)
    except PortalError as exc:
        return _error(exc)
    except SubscriptionError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    row.refresh_from_db()
    return Response(request_data(row, for_team=True))
