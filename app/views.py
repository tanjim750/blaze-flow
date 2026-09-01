from django.contrib.auth import login, logout
from django.core.files.storage import default_storage
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from django.middleware.csrf import get_token
from django.utils import timezone
from rest_framework.decorators import api_view, authentication_classes
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
    NotificationSerializer,
    NotificationPreferenceSerializer,
    ReviewCommentCreateSerializer,
    ReviewCommentEditSerializer,
    ReviewCommentResolutionSerializer,
    ReviewCommentRevisionSerializer,
    ReviewCommentSerializer,
    RevisionRequestSerializer,
    StageHistorySerializer,
    WorkflowStageSerializer,
    WorkflowTransitionSerializer,
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
    MediaVersionStageEntry,
    Project,
    ResourceAccess,
    ReviewComment,
    ReviewCommentRevision,
    Notification,
    Role,
    RoleStatus,
    WorkflowStage,
    WorkflowStageStatus,
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
    MEDIA_DOWNLOAD,
    MEDIA_READ,
    MEDIA_TRANSITION,
    REVIEW_COMMENT_CREATE,
    REVIEW_COMMENT_MANAGE,
    REVIEW_COMMENT_READ,
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
    ReviewCommentError,
    WorkflowTransitionError,
    WorkspaceSlugConflict,
    accept_invitation,
    archive_project,
    archive_role,
    create_invitation,
    create_project,
    create_review_comment,
    create_role,
    create_workspace,
    grant_project_access,
    delete_review_comment_tree,
    edit_review_comment,
    mark_all_notifications_read,
    mark_notification_read,
    get_notification_preference,
    record_user_audit,
    request_media_revision,
    set_review_comment_resolution,
    update_notification_preference,
    transition_media_version,
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
@authentication_classes([])
@permission_classes([AllowAny])
def register(request):
    serializer = RegistrationSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = serializer.save()
    return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


@api_view(['POST'])
@authentication_classes([])
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


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def workspace_workflow_stages(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    _require_workspace_permission(request, workspace, WORKSPACE_READ)
    stages = WorkflowStage.objects.filter(
        workspace=workspace,
        status=WorkflowStageStatusState.ACTIVE,
    ).order_by('sort_order', 'name')
    return Response(WorkflowStageSerializer(stages, many=True).data)


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


def _media_from_route(workspace_id, project_id, media_version_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    project = get_object_or_404(Project, id=project_id, workspace=workspace)
    media_version = get_object_or_404(
        MediaVersion.objects.select_related('original_file', 'project__workspace'),
        id=media_version_id,
        project=project,
    )
    return workspace, project, media_version


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def media_version_download(request, workspace_id, project_id, media_version_id):
    workspace, project, media_version = _media_from_route(workspace_id, project_id, media_version_id)
    if not has_project_permission(user=request.user, project=project, permission_key=MEDIA_DOWNLOAD):
        raise PermissionDenied('You do not have permission to download this media version.')
    if not media_version.allow_download:
        raise PermissionDenied('Downloading is disabled for this media version.')
    file_record = media_version.original_file
    if not default_storage.exists(file_record.object_key):
        raise Http404('The stored media object was not found.')
    record_user_audit(
        user=request.user,
        workspace=workspace,
        action='media.downloaded',
        entity_type='media_version',
        entity_id=media_version.id,
        metadata={'file_id': str(file_record.id)},
    )
    return FileResponse(
        default_storage.open(file_record.object_key, 'rb'),
        as_attachment=True,
        filename=file_record.original_name,
        content_type=file_record.mime_type,
    )


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def media_version_workflow(request, workspace_id, project_id, media_version_id):
    workspace, project, media_version = _media_from_route(workspace_id, project_id, media_version_id)
    permission_key = MEDIA_READ if request.method == 'GET' else MEDIA_TRANSITION
    if not has_project_permission(user=request.user, project=project, permission_key=permission_key):
        raise PermissionDenied('You do not have permission to access this workflow.')
    if request.method == 'GET':
        entries = MediaVersionStageEntry.objects.filter(media_version=media_version).select_related(
            'workflow_stage', 'workflow_stage_status'
        ).order_by('entered_at')
        return Response(StageHistorySerializer(entries, many=True).data)

    serializer = WorkflowTransitionSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    stage = get_object_or_404(
        WorkflowStage,
        id=serializer.validated_data['workflow_stage_id'],
        workspace=workspace,
    )
    stage_status = None
    if serializer.validated_data.get('workflow_stage_status_id'):
        stage_status = get_object_or_404(
            WorkflowStageStatus,
            id=serializer.validated_data['workflow_stage_status_id'],
            workflow_stage=stage,
        )
    try:
        entry = transition_media_version(
            media_version=media_version,
            stage=stage,
            stage_status=stage_status,
            user=request.user,
        )
    except WorkflowTransitionError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(StageHistorySerializer(entry).data, status=status.HTTP_201_CREATED)


def _require_project_permission(request, project, permission_key, message):
    if not has_project_permission(
        user=request.user,
        project=project,
        permission_key=permission_key,
    ):
        raise PermissionDenied(message)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def review_comment_list_create(request, workspace_id, project_id, media_version_id):
    workspace, project, media_version = _media_from_route(workspace_id, project_id, media_version_id)
    permission_key = REVIEW_COMMENT_READ if request.method == 'GET' else REVIEW_COMMENT_CREATE
    _require_project_permission(
        request,
        project,
        permission_key,
        'You do not have permission to access comments for this media version.',
    )
    if request.method == 'GET':
        comments = ReviewComment.objects.filter(
            media_version=media_version,
            deleted_at__isnull=True,
        ).select_related('author_user').order_by('created_at')
        return Response(ReviewCommentSerializer(comments, many=True).data)

    serializer = ReviewCommentCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data.copy()
    parent_comment_id = data.pop('parent_comment_id', None)
    parent_comment = None
    if parent_comment_id:
        parent_comment = get_object_or_404(
            ReviewComment,
            id=parent_comment_id,
            media_version=media_version,
            deleted_at__isnull=True,
        )
    try:
        comment = create_review_comment(
            media_version=media_version,
            user=request.user,
            parent_comment=parent_comment,
            **data,
        )
    except ReviewCommentError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(ReviewCommentSerializer(comment).data, status=status.HTTP_201_CREATED)


def _comment_from_route(workspace_id, project_id, media_version_id, comment_id):
    workspace, project, media_version = _media_from_route(
        workspace_id, project_id, media_version_id
    )
    comment = get_object_or_404(
        ReviewComment.objects.select_related('author_user', 'media_version__project__workspace'),
        id=comment_id,
        media_version=media_version,
        deleted_at__isnull=True,
    )
    return workspace, project, media_version, comment


@api_view(['PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def review_comment_detail(request, workspace_id, project_id, media_version_id, comment_id):
    workspace, project, media_version, comment = _comment_from_route(
        workspace_id, project_id, media_version_id, comment_id
    )
    if request.method == 'PATCH':
        _require_project_permission(
            request,
            project,
            REVIEW_COMMENT_CREATE,
            'You do not have permission to edit comments.',
        )
        if comment.author_user_id != request.user.id:
            raise PermissionDenied('Only the original author can edit this comment.')
        serializer = ReviewCommentEditSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            comment = edit_review_comment(
                comment=comment,
                user=request.user,
                **serializer.validated_data,
            )
        except ReviewCommentError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(ReviewCommentSerializer(comment).data)

    _require_project_permission(
        request,
        project,
        REVIEW_COMMENT_MANAGE,
        'You do not have permission to delete comments.',
    )
    try:
        delete_review_comment_tree(comment=comment, user=request.user)
    except ReviewCommentError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def review_comment_resolution(request, workspace_id, project_id, media_version_id, comment_id):
    workspace, project, media_version, comment = _comment_from_route(
        workspace_id, project_id, media_version_id, comment_id
    )
    _require_project_permission(
        request,
        project,
        REVIEW_COMMENT_MANAGE,
        'You do not have permission to resolve or reopen comments.',
    )
    serializer = ReviewCommentResolutionSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        comment = set_review_comment_resolution(
            comment=comment,
            user=request.user,
            **serializer.validated_data,
        )
    except ReviewCommentError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(ReviewCommentSerializer(comment).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def review_comment_revisions(request, workspace_id, project_id, media_version_id, comment_id):
    workspace, project, media_version, comment = _comment_from_route(
        workspace_id, project_id, media_version_id, comment_id
    )
    _require_project_permission(
        request,
        project,
        REVIEW_COMMENT_READ,
        'You do not have permission to read comment revisions.',
    )
    revisions = ReviewCommentRevision.objects.filter(review_comment=comment).order_by('created_at')
    return Response(ReviewCommentRevisionSerializer(revisions, many=True).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def media_revision_request(request, workspace_id, project_id, media_version_id):
    workspace, project, media_version = _media_from_route(workspace_id, project_id, media_version_id)
    for permission_key in (REVIEW_COMMENT_CREATE, MEDIA_TRANSITION):
        _require_project_permission(
            request,
            project,
            permission_key,
            'You do not have permission to request a revision.',
        )
    serializer = RevisionRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        comment, entry, transitioned = request_media_revision(
            media_version=media_version,
            user=request.user,
            **serializer.validated_data,
        )
    except (ReviewCommentError, WorkflowTransitionError) as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(
        {
            'comment': ReviewCommentSerializer(comment).data,
            'workflow': StageHistorySerializer(entry).data,
            'workflow_transitioned': transitioned,
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def notification_list(request):
    notifications = Notification.objects.filter(recipient_user=request.user).select_related(
        'actor_user'
    ).order_by('-created_at')
    if request.query_params.get('unread', '').lower() == 'true':
        notifications = notifications.filter(read_at__isnull=True)
    return Response(NotificationSerializer(notifications, many=True).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def notification_read(request, notification_id):
    notification = get_object_or_404(
        Notification,
        id=notification_id,
        recipient_user=request.user,
    )
    notification = mark_notification_read(notification=notification)
    return Response(NotificationSerializer(notification).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def notification_read_all(request):
    updated_count = mark_all_notifications_read(user=request.user)
    return Response({'updated_count': updated_count})


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated])
def notification_preferences(request):
    preference = get_notification_preference(user=request.user)
    if request.method == 'GET':
        return Response(NotificationPreferenceSerializer(preference).data)
    serializer = NotificationPreferenceSerializer(
        preference,
        data=request.data,
        partial=True,
    )
    serializer.is_valid(raise_exception=True)
    preference = update_notification_preference(
        user=request.user,
        email_mentions_enabled=serializer.validated_data.get(
            'email_mentions_enabled',
            preference.email_mentions_enabled,
        ),
    )
    return Response(NotificationPreferenceSerializer(preference).data)
