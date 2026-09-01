from django.db.models import Q

from .models import (
    ClientTeamMember,
    ClientTeamMemberStatus,
    ClientTeamStatus,
    ProjectAccessMode,
    ResourceAccess,
    RolePermission,
    RoleStatus,
    WorkspaceMembership,
    WorkspaceMembershipStatus,
    WorkspacePrincipalType,
)


WORKSPACE_READ = 'workspace.read'
WORKSPACE_MANAGE = 'workspace.manage'
WORKSPACE_MEMBERS_MANAGE = 'workspace.members.manage'
ROLE_MANAGE = 'role.manage'
PROJECT_CREATE = 'project.create'
PROJECT_READ = 'project.read'
PROJECT_UPDATE = 'project.update'
PROJECT_DELETE = 'project.delete'
MEDIA_CREATE = 'media.create'
MEDIA_READ = 'media.read'
MEDIA_DOWNLOAD = 'media.download'
MEDIA_TRANSITION = 'media.transition'
REVIEW_COMMENT_READ = 'review.comment.read'
REVIEW_COMMENT_CREATE = 'review.comment.create'
REVIEW_COMMENT_MANAGE = 'review.comment.manage'
REVIEW_REACTION_CREATE = 'review.reaction.create'
ANNOTATION_READ = 'annotation.read'
ANNOTATION_CREATE = 'annotation.create'
ANNOTATION_MANAGE = 'annotation.manage'

OWNER_PERMISSION_KEYS = (
    WORKSPACE_READ,
    WORKSPACE_MANAGE,
    WORKSPACE_MEMBERS_MANAGE,
    ROLE_MANAGE,
    PROJECT_CREATE,
    PROJECT_READ,
    PROJECT_UPDATE,
    PROJECT_DELETE,
    MEDIA_CREATE,
    MEDIA_READ,
    MEDIA_DOWNLOAD,
    MEDIA_TRANSITION,
    REVIEW_COMMENT_READ,
    REVIEW_COMMENT_CREATE,
    REVIEW_COMMENT_MANAGE,
    REVIEW_REACTION_CREATE,
    ANNOTATION_READ,
    ANNOTATION_CREATE,
    ANNOTATION_MANAGE,
)

MEMBER_PERMISSION_KEYS = (
    WORKSPACE_READ,
    PROJECT_CREATE,
    PROJECT_READ,
    PROJECT_UPDATE,
    MEDIA_CREATE,
    MEDIA_READ,
    MEDIA_DOWNLOAD,
    MEDIA_TRANSITION,
    REVIEW_COMMENT_READ,
    REVIEW_COMMENT_CREATE,
    REVIEW_COMMENT_MANAGE,
    REVIEW_REACTION_CREATE,
    ANNOTATION_READ,
    ANNOTATION_CREATE,
    ANNOTATION_MANAGE,
)

ALL_PERMISSION_KEYS = frozenset(OWNER_PERMISSION_KEYS)


def active_memberships_for_user(*, user, workspace):
    if not user or not user.is_authenticated:
        return WorkspaceMembership.objects.none()

    client_team_ids = ClientTeamMember.objects.filter(
        user=user,
        status=ClientTeamMemberStatus.ACTIVE,
        client_team__workspace=workspace,
        client_team__status=ClientTeamStatus.ACTIVE,
    ).values_list('client_team_id', flat=True)
    return WorkspaceMembership.objects.filter(
        workspace=workspace,
        status=WorkspaceMembershipStatus.ACTIVE,
    ).filter(
        Q(principal_type=WorkspacePrincipalType.USER, user=user)
        | Q(
            principal_type=WorkspacePrincipalType.CLIENT_TEAM,
            client_team_id__in=client_team_ids,
        )
    ).select_related('role')


def memberships_with_permission(*, user, workspace, permission_key):
    role_ids = RolePermission.objects.filter(
        permission_key=permission_key,
        role__status=RoleStatus.ACTIVE,
    ).values_list('role_id', flat=True)
    return active_memberships_for_user(user=user, workspace=workspace).filter(role_id__in=role_ids)


def has_workspace_permission(*, user, workspace, permission_key):
    return memberships_with_permission(
        user=user,
        workspace=workspace,
        permission_key=permission_key,
    ).exists()


def workspace_ids_with_permission(*, user, permission_key):
    if not user or not user.is_authenticated:
        return WorkspaceMembership.objects.none().values_list('workspace_id', flat=True)
    team_ids = ClientTeamMember.objects.filter(
        user=user,
        status=ClientTeamMemberStatus.ACTIVE,
        client_team__status=ClientTeamStatus.ACTIVE,
    ).values_list('client_team_id', flat=True)
    role_ids = RolePermission.objects.filter(
        permission_key=permission_key,
        role__status=RoleStatus.ACTIVE,
    ).values_list('role_id', flat=True)
    return WorkspaceMembership.objects.filter(
        status=WorkspaceMembershipStatus.ACTIVE,
        role_id__in=role_ids,
    ).filter(
        Q(principal_type=WorkspacePrincipalType.USER, user=user)
        | Q(principal_type=WorkspacePrincipalType.CLIENT_TEAM, client_team_id__in=team_ids)
    ).values_list('workspace_id', flat=True)


def accessible_projects(*, user, workspace, permission_key):
    from .models import Project

    memberships = memberships_with_permission(
        user=user,
        workspace=workspace,
        permission_key=permission_key,
    )
    if memberships.filter(project_access_mode=ProjectAccessMode.ALL).exists():
        return Project.objects.filter(workspace=workspace)
    project_ids = ResourceAccess.objects.filter(
        workspace_membership__in=memberships
    ).values_list('project_id', flat=True)
    return Project.objects.filter(workspace=workspace, id__in=project_ids)


def has_project_permission(*, user, project, permission_key):
    memberships = memberships_with_permission(
        user=user,
        workspace=project.workspace,
        permission_key=permission_key,
    )
    if memberships.filter(project_access_mode=ProjectAccessMode.ALL).exists():
        return True
    return ResourceAccess.objects.filter(
        workspace_membership__in=memberships,
        project=project,
    ).exists()
