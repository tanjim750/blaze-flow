from django.contrib.auth import login, logout
from django.shortcuts import get_object_or_404
from django.middleware.csrf import get_token
from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.decorators import permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from rest_framework.exceptions import PermissionDenied

from .events import DomainEvent, dispatch
from .serializers import (
    LoginSerializer,
    MessageSerializer,
    MediaUploadSerializer,
    MediaVersionSerializer,
    ProjectCreateSerializer,
    ProjectSerializer,
    ProjectUpdateSerializer,
    ResourceAccessCreateSerializer,
    ResourceAccessSerializer,
    RegistrationSerializer,
    RoleCreateSerializer,
    RoleSerializer,
    RoleUpdateSerializer,
    UserSerializer,
    WorkspaceCreateSerializer,
    WorkspaceInviteAcceptSerializer,
    WorkspaceInviteCreateSerializer,
    WorkspaceInviteSerializer,
    WorkspaceMembershipSerializer,
    WorkspaceMembershipUpdateSerializer,
    WorkspaceSerializer,
)
from .models import (
    MediaVersion,
    Project,
    ResourceAccess,
    Role,
    RoleStatus,
    WorkflowStage,
    WorkflowStageStatusState,
    Workspace,
    WorkspaceMembership,
)
from .permissions import (
    PROJECT_CREATE,
    PROJECT_DELETE,
    PROJECT_READ,
    PROJECT_UPDATE,
    MEDIA_CREATE,
    MEDIA_READ,
    ROLE_MANAGE,
    WORKSPACE_MEMBERS_MANAGE,
    WORKSPACE_READ,
    accessible_projects,
    has_project_permission,
    has_workspace_permission,
    memberships_with_permission,
    workspace_ids_with_permission,
)
from .services import (
    InvitationError,
    MediaUploadError,
    ResourceAccessError,
    RoleError,
    WorkspaceSlugConflict,
    accept_invitation,
    archive_project,
    archive_role,
    create_invitation,
    create_project,
    create_role,
    create_workspace,
    grant_project_access,
    update_role,
    upload_media_version,
    update_project,
)


@api_view(['GET'])
def health_check(request):
    dispatch(DomainEvent(name='health.checked'))
    serializer = MessageSerializer({'message': 'ok'})
    return Response(serializer.data)


@api_view(['POST'])
@permission_classes([AllowAny])
def register(request):
    serializer = RegistrationSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = serializer.save()
    return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([AllowAny])
def login_user(request):
    serializer = LoginSerializer(data=request.data, context={'request': request})
    serializer.is_valid(raise_exception=True)
    user = serializer.validated_data['user']
    login(request, user)
    data = UserSerializer(user).data
    data['csrf_token'] = get_token(request)
    return Response(data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def logout_user(request):
    logout(request)
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def current_user(request):
    return Response(UserSerializer(request.user).data)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def workspace_list_create(request):
    if request.method == 'GET':
        workspace_ids = workspace_ids_with_permission(
            user=request.user,
            permission_key=WORKSPACE_READ,
        )
        workspaces = Workspace.objects.filter(id__in=workspace_ids).distinct().order_by('name')
        return Response(WorkspaceSerializer(workspaces, many=True).data)

    serializer = WorkspaceCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        workspace, membership = create_workspace(
            owner=request.user,
            name=serializer.validated_data['name'],
            slug=serializer.validated_data['slug'],
            workspace_timezone=serializer.validated_data['timezone'],
        )
    except WorkspaceSlugConflict:
        return Response(
            {'slug': ['This workspace slug is already in use.']},
            status=status.HTTP_400_BAD_REQUEST,
        )
    data = WorkspaceSerializer(workspace).data
    data['membership_id'] = str(membership.id)
    return Response(data, status=status.HTTP_201_CREATED)


def _require_workspace_permission(request, workspace, permission_key):
    if not has_workspace_permission(
        user=request.user,
        workspace=workspace,
        permission_key=permission_key,
    ):
        raise PermissionDenied('You do not have permission to perform this action.')


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def workspace_roles(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    if request.method == 'GET':
        _require_workspace_permission(request, workspace, WORKSPACE_READ)
        roles = Role.objects.filter(workspace=workspace).order_by('name')
        return Response(RoleSerializer(roles, many=True).data)
    _require_workspace_permission(request, workspace, ROLE_MANAGE)
    serializer = RoleCreateSerializer(data=request.data, context={'workspace': workspace})
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data.copy()
    permission_keys = data.pop('permission_keys', [])
    try:
        role = create_role(
            workspace=workspace,
            created_by_user=request.user,
            permission_keys=permission_keys,
            **data,
        )
    except RoleError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(RoleSerializer(role).data, status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def workspace_role_detail(request, workspace_id, role_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    _require_workspace_permission(request, workspace, ROLE_MANAGE)
    role = get_object_or_404(Role, id=role_id, workspace=workspace)
    try:
        if request.method == 'DELETE':
            archive_role(role=role)
            return Response(status=status.HTTP_204_NO_CONTENT)
        serializer = RoleUpdateSerializer(
            data=request.data,
            partial=True,
            context={'workspace': workspace, 'role': role},
        )
        serializer.is_valid(raise_exception=True)
        role = update_role(role=role, **serializer.validated_data)
    except RoleError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(RoleSerializer(role).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def workspace_members(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    _require_workspace_permission(request, workspace, WORKSPACE_READ)
    memberships = WorkspaceMembership.objects.filter(workspace=workspace).select_related(
        'user', 'role'
    ).order_by('joined_at')
    return Response(WorkspaceMembershipSerializer(memberships, many=True).data)


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def workspace_member_detail(request, workspace_id, membership_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    _require_workspace_permission(request, workspace, WORKSPACE_MEMBERS_MANAGE)
    membership = get_object_or_404(
        WorkspaceMembership.objects.select_related('role', 'user'),
        id=membership_id,
        workspace=workspace,
    )
    if membership.is_primary_owner:
        return Response(
            {'detail': 'The primary owner cannot be modified through this endpoint.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    serializer = WorkspaceMembershipUpdateSerializer(data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    if 'role_id' in serializer.validated_data:
        membership.role = get_object_or_404(
            Role,
            id=serializer.validated_data['role_id'],
            workspace=workspace,
            status=RoleStatus.ACTIVE,
        )
    for field in ('project_access_mode', 'status'):
        if field in serializer.validated_data:
            setattr(membership, field, serializer.validated_data[field])
    membership.updated_at = timezone.now()
    membership.full_clean()
    membership.save()
    return Response(WorkspaceMembershipSerializer(membership).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def workspace_invitations(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    authorizing_membership = memberships_with_permission(
        user=request.user,
        workspace=workspace,
        permission_key=WORKSPACE_MEMBERS_MANAGE,
    ).first()
    if authorizing_membership is None:
        raise PermissionDenied('You do not have permission to invite workspace members.')
    serializer = WorkspaceInviteCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    role = get_object_or_404(
        Role,
        id=serializer.validated_data['role_id'],
        workspace=workspace,
        status=RoleStatus.ACTIVE,
    )
    try:
        invitation, token = create_invitation(
            workspace=workspace,
            email=serializer.validated_data['email'],
            role=role,
            invited_by_membership=authorizing_membership,
            project_access_mode=serializer.validated_data['project_access_mode'],
            expires_in_days=serializer.validated_data['expires_in_days'],
        )
    except InvitationError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    data = WorkspaceInviteSerializer(invitation).data
    data['token'] = token
    return Response(data, status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def accept_workspace_invitation(request):
    serializer = WorkspaceInviteAcceptSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        membership = accept_invitation(
            user=request.user,
            token=serializer.validated_data['token'],
        )
    except InvitationError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(WorkspaceMembershipSerializer(membership).data, status=status.HTTP_201_CREATED)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def project_list_create(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    if request.method == 'GET':
        _require_workspace_permission(request, workspace, PROJECT_READ)
        projects = accessible_projects(
            user=request.user,
            workspace=workspace,
            permission_key=PROJECT_READ,
        ).order_by('-created_at')
        return Response(ProjectSerializer(projects, many=True).data)

    authorizing_membership = memberships_with_permission(
        user=request.user,
        workspace=workspace,
        permission_key=PROJECT_CREATE,
    ).first()
    if authorizing_membership is None:
        raise PermissionDenied('You do not have permission to create projects.')
    serializer = ProjectCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    project = create_project(
        workspace=workspace,
        created_by_user=request.user,
        authorizing_membership=authorizing_membership,
        **serializer.validated_data,
    )
    return Response(ProjectSerializer(project).data, status=status.HTTP_201_CREATED)


@api_view(['GET', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def project_detail(request, workspace_id, project_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    project = get_object_or_404(Project, id=project_id, workspace=workspace)
    permission_key = {
        'GET': PROJECT_READ,
        'PATCH': PROJECT_UPDATE,
        'DELETE': PROJECT_DELETE,
    }[request.method]
    if not has_project_permission(
        user=request.user,
        project=project,
        permission_key=permission_key,
    ):
        raise PermissionDenied('You do not have permission to access this project.')
    if request.method == 'GET':
        return Response(ProjectSerializer(project).data)
    if request.method == 'PATCH':
        serializer = ProjectUpdateSerializer(project, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        project = update_project(project=project, **serializer.validated_data)
        return Response(ProjectSerializer(project).data)
    archive_project(project=project)
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def project_access_list_create(request, workspace_id, project_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    _require_workspace_permission(request, workspace, WORKSPACE_MEMBERS_MANAGE)
    project = get_object_or_404(Project, id=project_id, workspace=workspace)
    if request.method == 'GET':
        grants = ResourceAccess.objects.filter(project=project).select_related(
            'workspace_membership__user',
            'workspace_membership__role',
        ).order_by('created_at')
        return Response(ResourceAccessSerializer(grants, many=True).data)

    serializer = ResourceAccessCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    membership = get_object_or_404(
        WorkspaceMembership,
        id=serializer.validated_data['membership_id'],
        workspace=workspace,
    )
    try:
        grant = grant_project_access(project=project, membership=membership)
    except ResourceAccessError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(ResourceAccessSerializer(grant).data, status=status.HTTP_201_CREATED)


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def project_access_detail(request, workspace_id, project_id, grant_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    _require_workspace_permission(request, workspace, WORKSPACE_MEMBERS_MANAGE)
    project = get_object_or_404(Project, id=project_id, workspace=workspace)
    grant = get_object_or_404(ResourceAccess, id=grant_id, project=project)
    grant.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def media_version_list_create(request, workspace_id, project_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    project = get_object_or_404(Project, id=project_id, workspace=workspace)
    permission_key = MEDIA_READ if request.method == 'GET' else MEDIA_CREATE
    if not has_project_permission(
        user=request.user,
        project=project,
        permission_key=permission_key,
    ):
        raise PermissionDenied('You do not have permission to access media in this project.')
    if request.method == 'GET':
        media_versions = MediaVersion.objects.filter(project=project).select_related(
            'original_file'
        ).order_by('version_number')
        return Response(MediaVersionSerializer(media_versions, many=True).data)

    serializer = MediaUploadSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data.copy()
    initial_stage_id = data.pop('initial_stage_id', None)
    initial_stage = None
    if initial_stage_id:
        initial_stage = get_object_or_404(
            WorkflowStage,
            id=initial_stage_id,
            workspace=workspace,
            status=WorkflowStageStatusState.ACTIVE,
        )
    try:
        media_version = upload_media_version(
            project=project,
            user=request.user,
            upload=data.pop('file'),
            initial_stage=initial_stage,
            **data,
        )
    except MediaUploadError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(MediaVersionSerializer(media_version).data, status=status.HTTP_201_CREATED)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def media_version_detail(request, workspace_id, project_id, media_version_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    project = get_object_or_404(Project, id=project_id, workspace=workspace)
    media_version = get_object_or_404(
        MediaVersion.objects.select_related('original_file'),
        id=media_version_id,
        project=project,
    )
    if not has_project_permission(
        user=request.user,
        project=project,
        permission_key=MEDIA_READ,
    ):
        raise PermissionDenied('You do not have permission to access this media version.')
    return Response(MediaVersionSerializer(media_version).data)
