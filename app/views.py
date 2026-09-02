from django.contrib.auth import login, logout, update_session_auth_hash
from django.core.files.storage import default_storage
from django.http import FileResponse, Http404, HttpResponse
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.middleware.csrf import get_token
from django.utils import timezone
from rest_framework.decorators import api_view, authentication_classes, throttle_classes
from rest_framework.decorators import permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from rest_framework.exceptions import PermissionDenied

from .events import DomainEvent, dispatch
from .pagination import paginated_response
from .serializers import (
    EmailVerificationConfirmSerializer,
    EmailVerificationRequestSerializer,
    GoogleLoginSerializer,
    LoginSerializer,
    PasswordChangeSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    AnnotationRevisionSerializer,
    AnnotationSerializer,
    AnnotationWriteSerializer,
    ClientTeamCreateSerializer,
    ClientTeamInviteAcceptSerializer,
    ClientTeamInviteCreateSerializer,
    ClientTeamInviteSerializer,
    ClientTeamMemberCreateSerializer,
    ClientTeamMemberSerializer,
    ClientTeamSerializer,
    ClientTeamUpdateSerializer,
    ClientTeamWorkspaceAccessCreateSerializer,
    MessageSerializer,
    MediaUploadSerializer,
    MediaVersionSerializer,
    NotificationSerializer,
    NotificationPreferenceSerializer,
    ReviewCommentCreateSerializer,
    ReviewCommentEditSerializer,
    ReviewCommentResolutionSerializer,
    ReviewReactionWriteSerializer,
    ReviewCommentRevisionSerializer,
    ReviewCommentSerializer,
    ReviewAttachmentSerializer,
    ReviewAttachmentUploadSerializer,
    RevisionRequestSerializer,
    StageHistorySerializer,
    SubscriptionSerializer,
    TaskAssigneeCreateSerializer,
    TaskAssigneeSerializer,
    TaskAttachmentSerializer,
    TaskAttachmentUploadSerializer,
    TaskCreateSerializer,
    TaskSerializer,
    TaskUpdateSerializer,
    WorkflowStageSerializer,
    WorkflowTransitionSerializer,
    ProjectCreateSerializer,
    ProjectFileSerializer,
    ProjectFileUploadSerializer,
    ProjectFolderCreateSerializer,
    ProjectFolderSerializer,
    ProjectFolderUpdateSerializer,
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
    WorkspaceProfileSerializer,
    WorkspaceProfileUpdateSerializer,
    WorkspaceRetentionPolicyUpdateSerializer,
    WorkspaceInviteAcceptSerializer,
    WorkspaceInviteCreateSerializer,
    WorkspaceInviteSerializer,
    WorkspaceMembershipSerializer,
    WorkspaceMembershipUpdateSerializer,
    WorkspaceSerializer,
    WorkspaceUpdateSerializer,
)
from .services.passwords import (
    PasswordError, change_password, confirm_password_reset, request_password_reset,
)
from .services.email_verification import (
    EmailVerificationError, confirm_email_verification, request_email_verification,
)
from .services.reactions import (
    ReviewReactionError, add_user_reaction, remove_user_reaction,
)
from .services.retention import (
    update_workspace_retention_policy, workspace_retention_policy_data,
)
from .throttles import (
    EmailVerificationThrottle, LoginThrottle, PasswordResetThrottle, RegistrationThrottle,
)
from .models import (
    MediaVersion,
    FileVariant,
    Annotation,
    AnnotationRevision,
    ClientTeam,
    ClientTeamInvite,
    ClientTeamMember,
    ClientTeamMemberStatus,
    ClientTeamStatus,
    FileStatus,
    MediaVersionStageEntry,
    Project,
    ProjectFile,
    ProjectFolder,
    ResourceAccess,
    ReviewComment,
    ReviewCommentContent,
    ReviewCommentRevision,
    Notification,
    NotificationDelivery,
    OutboxEvent,
    Role,
    RoleStatus,
    Task,
    TaskAssignee,
    TaskAttachment,
    WorkflowStage,
    WorkflowStageStatus,
    WorkflowStageStatusState,
    Workspace,
    WorkspaceMembership,
    WorkspaceProfile,
)
from .permissions import (
    PROJECT_CREATE,
    PROJECT_DELETE,
    PROJECT_FILE_CREATE,
    PROJECT_FILE_DELETE,
    PROJECT_FILE_READ,
    PROJECT_FILE_UPDATE,
    PROJECT_READ,
    PROJECT_UPDATE,
    MEDIA_CREATE,
    MEDIA_DOWNLOAD,
    MEDIA_READ,
    MEDIA_TRANSITION,
    ANNOTATION_CREATE,
    ANNOTATION_MANAGE,
    ANNOTATION_READ,
    CLIENT_TEAM_MANAGE,
    CLIENT_TEAM_READ,
    REVIEW_COMMENT_CREATE,
    REVIEW_COMMENT_MANAGE,
    REVIEW_COMMENT_READ,
    REVIEW_REACTION_CREATE,
    ROLE_MANAGE,
    TASK_CREATE,
    TASK_DELETE,
    TASK_READ,
    TASK_UPDATE,
    WORKSPACE_MEMBERS_MANAGE,
    WORKSPACE_MANAGE,
    WORKSPACE_READ,
    accessible_projects,
    has_project_permission,
    has_workspace_permission,
    memberships_with_permission,
    workspace_ids_with_permission,
)
from .services import (
    InvitationError,
    ClientTeamError,
    ClientTeamInviteError,
    GoogleOAuthError,
    MediaUploadError,
    ResourceAccessError,
    RoleError,
    ReviewCommentError,
    AnnotationError,
    ReviewAttachmentError,
    ProjectFileError,
    SubscriptionError,
    TaskError,
    WorkflowTransitionError,
    WorkspaceLifecycleError,
    WorkspaceSlugConflict,
    accept_client_team_invite,
    accept_invitation,
    add_client_team_member,
    authenticate_with_google,
    cancel_subscription,
    add_task_assignee,
    archive_client_team,
    archive_project,
    archive_role,
    create_client_team,
    create_client_team_invite,
    create_invitation,
    create_project,
    create_project_folder,
    create_review_comment,
    create_annotation,
    create_role,
    create_task,
    create_workspace,
    enforce_project_creation_limit,
    enforce_workspace_creation_limit,
    grant_client_team_workspace_access,
    grant_project_access,
    delete_review_comment_tree,
    delete_annotation,
    delete_project_file,
    delete_project_folder,
    delete_review_attachment,
    delete_task,
    delete_task_attachment,
    edit_review_comment,
    mark_all_notifications_read,
    mark_notification_read,
    get_effective_subscription,
    get_notification_preference,
    get_plan_limit,
    provision_free_subscription,
    record_user_audit,
    remove_client_team_member,
    remove_task_assignee,
    rename_project_folder,
    restore_workspace,
    resume_subscription,
    revoke_client_team_invite,
    request_media_revision,
    schedule_workspace_deletion,
    set_review_comment_resolution,
    update_client_team,
    update_notification_preference,
    update_annotation,
    update_workspace,
    update_workspace_profile,
    update_task,
    upgrade_to_pro,
    upload_project_file,
    upload_review_attachment,
    upload_task_attachment,
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
@throttle_classes([RegistrationThrottle])
def register(request):
    serializer = RegistrationSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = serializer.save()
    provision_free_subscription(user=user)
    request_email_verification(email=user.email)
    return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([LoginThrottle])
def login_user(request):
    serializer = LoginSerializer(data=request.data, context={'request': request})
    serializer.is_valid(raise_exception=True)
    user = serializer.validated_data['user']
    login(request, user)
    data = UserSerializer(user).data
    data['csrf_token'] = get_token(request)
    return Response(data)


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([LoginThrottle])
def google_login(request):
    serializer = GoogleLoginSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        user = authenticate_with_google(id_token=serializer.validated_data['id_token'])
    except GoogleOAuthError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    login(request, user)
    data = UserSerializer(user).data
    data['csrf_token'] = get_token(request)
    return Response(data)


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([PasswordResetThrottle])
def password_reset_request(request):
    serializer = PasswordResetRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    request_password_reset(email=serializer.validated_data['email'])
    return Response(
        {'detail': 'If an active account exists, password-reset instructions have been sent.'},
        status=status.HTTP_202_ACCEPTED,
    )


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([PasswordResetThrottle])
def password_reset_confirm(request):
    serializer = PasswordResetConfirmSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        confirm_password_reset(**serializer.validated_data)
    except PasswordError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([EmailVerificationThrottle])
def email_verification_request(request):
    serializer = EmailVerificationRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    request_email_verification(email=serializer.validated_data['email'])
    return Response(
        {'detail': 'If an unverified active account exists, verification instructions have been sent.'},
        status=status.HTTP_202_ACCEPTED,
    )


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([EmailVerificationThrottle])
def email_verification_confirm(request):
    serializer = EmailVerificationConfirmSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        confirm_email_verification(**serializer.validated_data)
    except EmailVerificationError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def password_change(request):
    serializer = PasswordChangeSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        change_password(user=request.user, **serializer.validated_data)
    except PasswordError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    update_session_auth_hash(request, request.user)
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def logout_user(request):
    logout(request)
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def current_user(request):
    return Response(UserSerializer(request.user).data)


def _subscription_response(subscription):
    data = SubscriptionSerializer(subscription).data
    data['limits'] = {
        'max_workspaces_owned': get_plan_limit(subscription.plan, 'max_workspaces_owned'),
        'max_projects_per_workspace': get_plan_limit(subscription.plan, 'max_projects_per_workspace'),
    }
    return data


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def subscription_detail(request):
    subscription = get_effective_subscription(user=request.user)
    return Response(_subscription_response(subscription))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def subscription_upgrade(request):
    try:
        subscription = upgrade_to_pro(user=request.user)
    except SubscriptionError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(_subscription_response(subscription), status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def subscription_cancel(request):
    try:
        subscription = cancel_subscription(user=request.user)
    except SubscriptionError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(_subscription_response(subscription))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def subscription_resume(request):
    try:
        subscription = resume_subscription(user=request.user)
    except SubscriptionError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(_subscription_response(subscription))


def _require_verified_email(request):
    if request.user.email_verified_at is None:
        raise PermissionDenied('Verify your email address before creating a workspace.')


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

    _require_verified_email(request)
    serializer = WorkspaceCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        enforce_workspace_creation_limit(user=request.user)
        workspace, membership = create_workspace(
            owner=request.user,
            name=serializer.validated_data['name'],
            slug=serializer.validated_data['slug'],
            workspace_timezone=serializer.validated_data['timezone'],
        )
    except SubscriptionError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
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


@api_view(['GET', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def workspace_detail(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    if request.method == 'GET':
        _require_workspace_permission(request, workspace, WORKSPACE_READ)
        return Response(WorkspaceSerializer(workspace).data)

    _require_workspace_permission(request, workspace, WORKSPACE_MANAGE)
    try:
        if request.method == 'DELETE':
            schedule_workspace_deletion(workspace=workspace)
            return Response(WorkspaceSerializer(workspace).data)
        serializer = WorkspaceUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        workspace = update_workspace(workspace=workspace, **serializer.validated_data)
    except WorkspaceLifecycleError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(WorkspaceSerializer(workspace).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def workspace_restore(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    _require_workspace_permission(request, workspace, WORKSPACE_MANAGE)
    try:
        workspace = restore_workspace(workspace=workspace)
    except WorkspaceLifecycleError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(WorkspaceSerializer(workspace).data)


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated])
def workspace_profile(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    if request.method == 'GET':
        _require_workspace_permission(request, workspace, WORKSPACE_READ)
        profile = WorkspaceProfile.objects.filter(workspace=workspace).first() or WorkspaceProfile(workspace=workspace)
        return Response(WorkspaceProfileSerializer(profile).data)

    _require_workspace_permission(request, workspace, WORKSPACE_MANAGE)
    serializer = WorkspaceProfileUpdateSerializer(data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    profile = update_workspace_profile(workspace=workspace, **serializer.validated_data)
    return Response(WorkspaceProfileSerializer(profile).data)


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
        'user', 'client_team', 'role'
    ).order_by('joined_at')
    return Response(WorkspaceMembershipSerializer(memberships, many=True).data)


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def workspace_member_detail(request, workspace_id, membership_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    _require_workspace_permission(request, workspace, WORKSPACE_MEMBERS_MANAGE)
    membership = get_object_or_404(
        WorkspaceMembership.objects.select_related('role', 'user', 'client_team'),
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


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def client_team_list_create(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    if request.method == 'GET':
        _require_workspace_permission(request, workspace, CLIENT_TEAM_READ)
        client_teams = ClientTeam.objects.filter(workspace=workspace).order_by('name')
        return Response(ClientTeamSerializer(client_teams, many=True).data)

    _require_workspace_permission(request, workspace, CLIENT_TEAM_MANAGE)
    serializer = ClientTeamCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    creating_membership = memberships_with_permission(
        user=request.user,
        workspace=workspace,
        permission_key=CLIENT_TEAM_MANAGE,
    ).first()
    client_team = create_client_team(
        workspace=workspace,
        created_by_membership=creating_membership,
        **serializer.validated_data,
    )
    return Response(ClientTeamSerializer(client_team).data, status=status.HTTP_201_CREATED)


@api_view(['GET', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def client_team_detail(request, workspace_id, client_team_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    client_team = get_object_or_404(ClientTeam, id=client_team_id, workspace=workspace)
    if request.method == 'GET':
        _require_workspace_permission(request, workspace, CLIENT_TEAM_READ)
        return Response(ClientTeamSerializer(client_team).data)

    _require_workspace_permission(request, workspace, CLIENT_TEAM_MANAGE)
    try:
        if request.method == 'DELETE':
            archive_client_team(client_team=client_team)
            return Response(status=status.HTTP_204_NO_CONTENT)
        serializer = ClientTeamUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        client_team = update_client_team(client_team=client_team, **serializer.validated_data)
    except ClientTeamError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(ClientTeamSerializer(client_team).data)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def client_team_members(request, workspace_id, client_team_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    client_team = get_object_or_404(ClientTeam, id=client_team_id, workspace=workspace)
    if request.method == 'GET':
        _require_workspace_permission(request, workspace, CLIENT_TEAM_READ)
        members = ClientTeamMember.objects.filter(client_team=client_team).select_related(
            'user'
        ).order_by('joined_at')
        return Response(ClientTeamMemberSerializer(members, many=True).data)

    _require_workspace_permission(request, workspace, CLIENT_TEAM_MANAGE)
    serializer = ClientTeamMemberCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    adding_membership = memberships_with_permission(
        user=request.user,
        workspace=workspace,
        permission_key=CLIENT_TEAM_MANAGE,
    ).first()
    try:
        member = add_client_team_member(
            client_team=client_team,
            user=serializer.validated_data['user'],
            added_by_membership=adding_membership,
            title=serializer.validated_data.get('title'),
        )
    except ClientTeamError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(ClientTeamMemberSerializer(member).data, status=status.HTTP_201_CREATED)


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def client_team_member_detail(request, workspace_id, client_team_id, member_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    client_team = get_object_or_404(ClientTeam, id=client_team_id, workspace=workspace)
    _require_workspace_permission(request, workspace, CLIENT_TEAM_MANAGE)
    member = get_object_or_404(ClientTeamMember, id=member_id, client_team=client_team)
    try:
        remove_client_team_member(member=member)
    except ClientTeamError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def client_team_workspace_access(request, workspace_id, client_team_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    client_team = get_object_or_404(
        ClientTeam, id=client_team_id, workspace=workspace, status=ClientTeamStatus.ACTIVE
    )
    _require_workspace_permission(request, workspace, WORKSPACE_MEMBERS_MANAGE)
    serializer = ClientTeamWorkspaceAccessCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    role = get_object_or_404(
        Role,
        id=serializer.validated_data['role_id'],
        workspace=workspace,
        status=RoleStatus.ACTIVE,
    )
    try:
        membership = grant_client_team_workspace_access(
            client_team=client_team,
            role=role,
            project_access_mode=serializer.validated_data['project_access_mode'],
        )
    except ClientTeamError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(WorkspaceMembershipSerializer(membership).data, status=status.HTTP_201_CREATED)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def client_team_invites(request, workspace_id, client_team_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    client_team = get_object_or_404(ClientTeam, id=client_team_id, workspace=workspace)
    _require_workspace_permission(request, workspace, CLIENT_TEAM_MANAGE)
    if request.method == 'GET':
        invites = ClientTeamInvite.objects.filter(client_team=client_team).order_by('-created_at')
        return Response(ClientTeamInviteSerializer(invites, many=True).data)

    serializer = ClientTeamInviteCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    creating_membership = memberships_with_permission(
        user=request.user,
        workspace=workspace,
        permission_key=CLIENT_TEAM_MANAGE,
    ).first()
    try:
        invite, token = create_client_team_invite(
            client_team=client_team,
            created_by_membership=creating_membership,
            **serializer.validated_data,
        )
    except ClientTeamInviteError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    data = ClientTeamInviteSerializer(invite).data
    data['token'] = token
    return Response(data, status=status.HTTP_201_CREATED)


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def client_team_invite_detail(request, workspace_id, client_team_id, invite_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    client_team = get_object_or_404(ClientTeam, id=client_team_id, workspace=workspace)
    _require_workspace_permission(request, workspace, CLIENT_TEAM_MANAGE)
    invite = get_object_or_404(ClientTeamInvite, id=invite_id, client_team=client_team)
    revoking_membership = memberships_with_permission(
        user=request.user,
        workspace=workspace,
        permission_key=CLIENT_TEAM_MANAGE,
    ).first()
    try:
        revoke_client_team_invite(invite=invite, revoked_by_membership=revoking_membership)
    except ClientTeamInviteError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def accept_client_team_invitation(request):
    serializer = ClientTeamInviteAcceptSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        member = accept_client_team_invite(
            user=request.user,
            token=serializer.validated_data['token'],
        )
    except ClientTeamInviteError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(ClientTeamMemberSerializer(member).data, status=status.HTTP_201_CREATED)


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
    try:
        enforce_project_creation_limit(workspace=workspace)
    except SubscriptionError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
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
def project_folder_list_create(request, workspace_id, project_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    project = get_object_or_404(Project, id=project_id, workspace=workspace)
    if request.method == 'GET':
        _require_project_permission(request, project, PROJECT_FILE_READ, 'You do not have permission to read project files.')
        folders = ProjectFolder.objects.filter(project=project, deleted_at__isnull=True).order_by('name')
        return Response(ProjectFolderSerializer(folders, many=True).data)

    _require_project_permission(request, project, PROJECT_FILE_CREATE, 'You do not have permission to create project folders.')
    serializer = ProjectFolderCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    parent_folder = None
    parent_folder_id = serializer.validated_data.get('parent_folder_id')
    if parent_folder_id is not None:
        parent_folder = get_object_or_404(
            ProjectFolder, id=parent_folder_id, project=project, deleted_at__isnull=True
        )
    creating_membership = memberships_with_permission(
        user=request.user,
        workspace=workspace,
        permission_key=PROJECT_FILE_CREATE,
    ).first()
    try:
        folder = create_project_folder(
            project=project,
            created_by_membership=creating_membership,
            name=serializer.validated_data['name'],
            parent_folder=parent_folder,
        )
    except ProjectFileError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(ProjectFolderSerializer(folder).data, status=status.HTTP_201_CREATED)


@api_view(['GET', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def project_folder_detail(request, workspace_id, project_id, folder_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    project = get_object_or_404(Project, id=project_id, workspace=workspace)
    folder = get_object_or_404(
        ProjectFolder, id=folder_id, project=project, deleted_at__isnull=True
    )
    if request.method == 'GET':
        _require_project_permission(request, project, PROJECT_FILE_READ, 'You do not have permission to read this folder.')
        return Response(ProjectFolderSerializer(folder).data)

    permission_key = PROJECT_FILE_UPDATE if request.method == 'PATCH' else PROJECT_FILE_DELETE
    _require_project_permission(request, project, permission_key, 'You do not have permission to modify this folder.')
    try:
        if request.method == 'DELETE':
            delete_project_folder(folder=folder)
            return Response(status=status.HTTP_204_NO_CONTENT)
        serializer = ProjectFolderUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        folder = rename_project_folder(folder=folder, name=serializer.validated_data['name'])
    except ProjectFileError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(ProjectFolderSerializer(folder).data)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def project_file_list_create(request, workspace_id, project_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    project = get_object_or_404(Project, id=project_id, workspace=workspace)
    if request.method == 'GET':
        _require_project_permission(request, project, PROJECT_FILE_READ, 'You do not have permission to read project files.')
        files = ProjectFile.objects.filter(project=project, deleted_at__isnull=True).select_related('file').order_by('-created_at')
        return Response(ProjectFileSerializer(files, many=True).data)

    _require_project_permission(request, project, PROJECT_FILE_CREATE, 'You do not have permission to add project files.')
    serializer = ProjectFileUploadSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    folder = None
    folder_id = serializer.validated_data.get('folder_id')
    if folder_id is not None:
        folder = get_object_or_404(
            ProjectFolder, id=folder_id, project=project, deleted_at__isnull=True
        )
    adding_membership = memberships_with_permission(
        user=request.user,
        workspace=workspace,
        permission_key=PROJECT_FILE_CREATE,
    ).first()
    try:
        project_file = upload_project_file(
            project=project,
            upload=serializer.validated_data['file'],
            membership=adding_membership,
            folder=folder,
        )
    except (ProjectFileError, SubscriptionError) as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(ProjectFileSerializer(project_file).data, status=status.HTTP_201_CREATED)


@api_view(['GET', 'DELETE'])
@permission_classes([IsAuthenticated])
def project_file_detail(request, workspace_id, project_id, file_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    project = get_object_or_404(Project, id=project_id, workspace=workspace)
    project_file = get_object_or_404(
        ProjectFile.objects.select_related('file'), id=file_id, project=project, deleted_at__isnull=True
    )
    if request.method == 'GET':
        _require_project_permission(request, project, PROJECT_FILE_READ, 'You do not have permission to read this file.')
        return Response(ProjectFileSerializer(project_file).data)

    _require_project_permission(request, project, PROJECT_FILE_DELETE, 'You do not have permission to remove this file.')
    try:
        delete_project_file(project_file=project_file)
    except ProjectFileError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(status=status.HTTP_204_NO_CONTENT)


def _require_task_permission(request, workspace, task, permission_key):
    if task.project_id:
        if not has_project_permission(
            user=request.user,
            project=task.project,
            permission_key=permission_key,
        ):
            raise PermissionDenied('You do not have permission to access this task.')
    else:
        _require_workspace_permission(request, workspace, permission_key)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def task_list_create(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    if request.method == 'GET':
        _require_workspace_permission(request, workspace, TASK_READ)
        accessible_project_ids = accessible_projects(
            user=request.user,
            workspace=workspace,
            permission_key=TASK_READ,
        ).values_list('id', flat=True)
        tasks = Task.objects.filter(workspace=workspace, deleted_at__isnull=True).filter(
            Q(project__isnull=True) | Q(project_id__in=accessible_project_ids)
        ).order_by('sort_order', '-created_at')
        return Response(TaskSerializer(tasks, many=True).data)

    _require_workspace_permission(request, workspace, TASK_CREATE)
    serializer = TaskCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data.copy()
    project_id = data.pop('project_id', None)
    project = None
    if project_id is not None:
        project = get_object_or_404(Project, id=project_id, workspace=workspace)
        if not has_project_permission(user=request.user, project=project, permission_key=TASK_CREATE):
            raise PermissionDenied('You do not have permission to create tasks in this project.')
    creating_membership = memberships_with_permission(
        user=request.user,
        workspace=workspace,
        permission_key=TASK_CREATE,
    ).first()
    task = create_task(
        workspace=workspace,
        project=project,
        created_by_membership=creating_membership,
        **data,
    )
    return Response(TaskSerializer(task).data, status=status.HTTP_201_CREATED)


@api_view(['GET', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def task_detail(request, workspace_id, task_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    task = get_object_or_404(Task, id=task_id, workspace=workspace, deleted_at__isnull=True)
    permission_key = {
        'GET': TASK_READ,
        'PATCH': TASK_UPDATE,
        'DELETE': TASK_DELETE,
    }[request.method]
    _require_task_permission(request, workspace, task, permission_key)
    if request.method == 'GET':
        return Response(TaskSerializer(task).data)
    if request.method == 'PATCH':
        serializer = TaskUpdateSerializer(task, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        task = update_task(task=task, **serializer.validated_data)
        return Response(TaskSerializer(task).data)
    try:
        delete_task(task=task)
    except TaskError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def task_assignees(request, workspace_id, task_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    task = get_object_or_404(Task, id=task_id, workspace=workspace, deleted_at__isnull=True)
    if request.method == 'GET':
        _require_task_permission(request, workspace, task, TASK_READ)
        assignees = TaskAssignee.objects.filter(task=task).select_related(
            'workspace_membership__user', 'workspace_membership__client_team', 'workspace_membership__role'
        ).order_by('assigned_at')
        return Response(TaskAssigneeSerializer(assignees, many=True).data)

    _require_task_permission(request, workspace, task, TASK_UPDATE)
    serializer = TaskAssigneeCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    membership = get_object_or_404(
        WorkspaceMembership, id=serializer.validated_data['membership_id'], workspace=workspace
    )
    try:
        assignee = add_task_assignee(task=task, membership=membership)
    except TaskError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(TaskAssigneeSerializer(assignee).data, status=status.HTTP_201_CREATED)


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def task_assignee_detail(request, workspace_id, task_id, assignee_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    task = get_object_or_404(Task, id=task_id, workspace=workspace, deleted_at__isnull=True)
    _require_task_permission(request, workspace, task, TASK_UPDATE)
    assignee = get_object_or_404(TaskAssignee, id=assignee_id, task=task)
    remove_task_assignee(assignee=assignee)
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def task_attachments(request, workspace_id, task_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    task = get_object_or_404(Task, id=task_id, workspace=workspace, deleted_at__isnull=True)
    if request.method == 'GET':
        _require_task_permission(request, workspace, task, TASK_READ)
        attachments = TaskAttachment.objects.filter(task=task).select_related('file').order_by('attached_at')
        return Response(TaskAttachmentSerializer(attachments, many=True).data)

    _require_task_permission(request, workspace, task, TASK_UPDATE)
    serializer = TaskAttachmentUploadSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    attaching_membership = memberships_with_permission(
        user=request.user,
        workspace=workspace,
        permission_key=TASK_UPDATE,
    ).first()
    try:
        attachment = upload_task_attachment(
            task=task, upload=serializer.validated_data['file'], membership=attaching_membership
        )
    except (TaskError, SubscriptionError) as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(TaskAttachmentSerializer(attachment).data, status=status.HTTP_201_CREATED)


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def task_attachment_detail(request, workspace_id, task_id, attachment_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    task = get_object_or_404(Task, id=task_id, workspace=workspace, deleted_at__isnull=True)
    _require_task_permission(request, workspace, task, TASK_UPDATE)
    attachment = get_object_or_404(TaskAttachment, id=attachment_id, task=task)
    delete_task_attachment(attachment=attachment)
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
    except (MediaUploadError, SubscriptionError) as exc:
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


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def media_version_preview(request, workspace_id, project_id, media_version_id):
    workspace, project, media_version = _media_from_route(workspace_id, project_id, media_version_id)
    if not has_project_permission(user=request.user, project=project, permission_key=MEDIA_READ):
        raise PermissionDenied('You do not have permission to view this media version.')
    variant = FileVariant.objects.filter(
        file=media_version.original_file, status=FileStatus.READY, deleted_at__isnull=True,
    ).order_by('-created_at').first()
    if variant is None or not default_storage.exists(variant.object_key):
        raise Http404('No preview is available for this media version yet.')
    return FileResponse(default_storage.open(variant.object_key, 'rb'), filename=variant.original_name, content_type=variant.mime_type)


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
        return paginated_response(
            request=request, queryset=comments,
            serializer_class=ReviewCommentSerializer,
        )

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


@api_view(['POST', 'DELETE'])
@permission_classes([IsAuthenticated])
def review_comment_reactions(request, workspace_id, project_id, media_version_id, comment_id):
    workspace, project, media_version, comment = _comment_from_route(
        workspace_id, project_id, media_version_id, comment_id
    )
    _require_project_permission(
        request,
        project,
        REVIEW_REACTION_CREATE,
        'You do not have permission to react to comments.',
    )
    serializer = ReviewReactionWriteSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        if request.method == 'POST':
            _, created = add_user_reaction(
                comment=comment, user=request.user, **serializer.validated_data
            )
            return Response(
                ReviewCommentSerializer(comment).data,
                status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
            )
        remove_user_reaction(
            comment=comment, user=request.user, **serializer.validated_data
        )
    except ReviewReactionError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(status=status.HTTP_204_NO_CONTENT)


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


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def review_attachment_upload(request, workspace_id, project_id, media_version_id, comment_id):
    workspace, project, media_version, comment = _comment_from_route(workspace_id, project_id, media_version_id, comment_id)
    _require_project_permission(request, project, REVIEW_COMMENT_CREATE, 'You do not have permission to attach review files.')
    if comment.author_user_id != request.user.id:
        raise PermissionDenied('Only the comment author can add attachments.')
    serializer = ReviewAttachmentUploadSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        content = upload_review_attachment(comment=comment, user=request.user, upload=serializer.validated_data['file'])
    except (ReviewAttachmentError, SubscriptionError) as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(ReviewAttachmentSerializer(content).data, status=status.HTTP_201_CREATED)


def _attachment_from_route(workspace_id, project_id, media_version_id, comment_id, content_id):
    workspace, project, media_version, comment = _comment_from_route(workspace_id, project_id, media_version_id, comment_id)
    content = get_object_or_404(
        ReviewCommentContent.objects.select_related('file'), id=content_id,
        review_comment=comment, file__isnull=False, deleted_at__isnull=True,
    )
    return workspace, project, media_version, comment, content


@api_view(['GET', 'DELETE'])
@permission_classes([IsAuthenticated])
def review_attachment_detail(request, workspace_id, project_id, media_version_id, comment_id, content_id):
    workspace, project, media_version, comment, content = _attachment_from_route(workspace_id, project_id, media_version_id, comment_id, content_id)
    if request.method == 'GET':
        _require_project_permission(request, project, REVIEW_COMMENT_READ, 'You do not have permission to download this attachment.')
        if content.file.status != 'READY':
            return Response({'detail': 'This attachment is still being scanned or was rejected.'}, status=status.HTTP_409_CONFLICT)
        if not default_storage.exists(content.file.object_key):
            raise Http404('The stored attachment was not found.')
        record_user_audit(user=request.user, workspace=workspace, action='review.attachment.downloaded', entity_type='review_comment_content', entity_id=content.id)
        return FileResponse(default_storage.open(content.file.object_key, 'rb'), as_attachment=True, filename=content.file.original_name, content_type=content.file.mime_type)
    can_manage = has_project_permission(user=request.user, project=project, permission_key=REVIEW_COMMENT_MANAGE)
    can_delete_as_author = (
        comment.author_user_id == request.user.id
        and has_project_permission(
            user=request.user,
            project=project,
            permission_key=REVIEW_COMMENT_CREATE,
        )
    )
    if not can_delete_as_author and not can_manage:
        raise PermissionDenied('Only the author or a comment manager can delete attachments.')
    delete_review_attachment(content=content, user=request.user)
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def review_attachment_preview(request, workspace_id, project_id, media_version_id, comment_id, content_id, variant_id):
    workspace, project, media_version, comment, content = _attachment_from_route(workspace_id, project_id, media_version_id, comment_id, content_id)
    _require_project_permission(request, project, REVIEW_COMMENT_READ, 'You do not have permission to view this attachment preview.')
    variant = get_object_or_404(
        FileVariant, id=variant_id, file=content.file, status='READY', deleted_at__isnull=True,
    )
    if not default_storage.exists(variant.object_key):
        raise Http404('The stored preview was not found.')
    return FileResponse(default_storage.open(variant.object_key, 'rb'), filename=variant.original_name, content_type=variant.mime_type)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def annotation_list_create(request, workspace_id, project_id, media_version_id):
    workspace, project, media_version = _media_from_route(workspace_id, project_id, media_version_id)
    permission_key = ANNOTATION_READ if request.method == 'GET' else ANNOTATION_CREATE
    _require_project_permission(request, project, permission_key, 'You do not have permission to access annotations.')
    if request.method == 'GET':
        items = Annotation.objects.filter(media_version=media_version, deleted_at__isnull=True).order_by('created_at')
        return paginated_response(
            request=request, queryset=items, serializer_class=AnnotationSerializer,
        )
    serializer = AnnotationWriteSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data.copy()
    comment_id = data.pop('review_comment_id', None)
    comment = get_object_or_404(ReviewComment, id=comment_id, media_version=media_version, deleted_at__isnull=True) if comment_id else None
    try:
        item = create_annotation(media_version=media_version, user=request.user, review_comment=comment, **data)
    except AnnotationError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(AnnotationSerializer(item).data, status=status.HTTP_201_CREATED)


def _annotation_from_route(workspace_id, project_id, media_version_id, annotation_id):
    workspace, project, media_version = _media_from_route(workspace_id, project_id, media_version_id)
    annotation = get_object_or_404(Annotation, id=annotation_id, media_version=media_version, deleted_at__isnull=True)
    return workspace, project, media_version, annotation


@api_view(['PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def annotation_detail(request, workspace_id, project_id, media_version_id, annotation_id):
    workspace, project, media_version, annotation = _annotation_from_route(workspace_id, project_id, media_version_id, annotation_id)
    if request.method == 'PATCH':
        _require_project_permission(request, project, ANNOTATION_CREATE, 'You do not have permission to edit annotations.')
        if annotation.author_user_id != request.user.id:
            raise PermissionDenied('Only the original author can edit this annotation.')
        payload = request.data.copy()
        if 'review_comment_id' not in payload and annotation.review_comment_id:
            payload['review_comment_id'] = str(annotation.review_comment_id)
        if 'start_time_ms' not in payload and annotation.start_time_ms is not None:
            payload['start_time_ms'] = annotation.start_time_ms
        if 'end_time_ms' not in payload and annotation.end_time_ms is not None:
            payload['end_time_ms'] = annotation.end_time_ms
        serializer = AnnotationWriteSerializer(data=payload)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data.copy()
        comment_id = data.pop('review_comment_id', annotation.review_comment_id)
        data['start_time_ms'] = data.get('start_time_ms', annotation.start_time_ms)
        data['end_time_ms'] = data.get('end_time_ms', annotation.end_time_ms)
        comment = get_object_or_404(ReviewComment, id=comment_id, media_version=media_version, deleted_at__isnull=True) if comment_id else None
        item = update_annotation(annotation=annotation, user=request.user, review_comment=comment, **data)
        return Response(AnnotationSerializer(item).data)
    _require_project_permission(request, project, ANNOTATION_MANAGE, 'You do not have permission to delete annotations.')
    delete_annotation(annotation=annotation, user=request.user)
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def annotation_revisions(request, workspace_id, project_id, media_version_id, annotation_id):
    workspace, project, media_version, annotation = _annotation_from_route(workspace_id, project_id, media_version_id, annotation_id)
    _require_project_permission(request, project, ANNOTATION_READ, 'You do not have permission to read annotation revisions.')
    revisions = AnnotationRevision.objects.filter(annotation=annotation).order_by('created_at')
    return Response(AnnotationRevisionSerializer(revisions, many=True).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def delivery_health(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    _require_workspace_permission(request, workspace, WORKSPACE_MANAGE)
    notification_ids = Notification.objects.filter(workspace=workspace).values_list('id', flat=True)
    delivery_counts = dict(NotificationDelivery.objects.filter(notification_id__in=notification_ids).values_list('status').annotate(count=Count('id')))
    outbox_counts = dict(OutboxEvent.objects.filter(aggregate_id__in=[str(item) for item in notification_ids]).values_list('status').annotate(count=Count('id')))
    return Response({'workspace_id': str(workspace.id), 'deliveries': delivery_counts, 'outbox': outbox_counts, 'checked_at': timezone.now()})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def operations_health(request, workspace_id):
    from .services.operations import workspace_operations_report
    workspace = get_object_or_404(Workspace, id=workspace_id)
    _require_workspace_permission(request, workspace, WORKSPACE_MANAGE)
    return Response(workspace_operations_report(workspace=workspace))


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def operations_metrics(request, workspace_id):
    from .services.operations import workspace_prometheus_metrics
    workspace = get_object_or_404(Workspace, id=workspace_id)
    _require_workspace_permission(request, workspace, WORKSPACE_MANAGE)
    return HttpResponse(
        workspace_prometheus_metrics(workspace=workspace),
        content_type='text/plain; version=0.0.4; charset=utf-8',
    )


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated])
def workspace_retention_policy(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    _require_workspace_permission(request, workspace, WORKSPACE_MANAGE)
    if request.method == 'GET':
        return Response(workspace_retention_policy_data(workspace=workspace))
    serializer = WorkspaceRetentionPolicyUpdateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    update_workspace_retention_policy(
        workspace=workspace, user=request.user, **serializer.validated_data
    )
    return Response(workspace_retention_policy_data(workspace=workspace))
