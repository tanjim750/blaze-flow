"""Upload links (public, no account) and client-portal uploads. See services/client_uploads."""
import uuid

from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .models import ClientUpload, Project, UploadLink, Workspace, WorkspaceProfile
from .permissions import (
    PROJECT_FILE_CREATE, PROJECT_FILE_READ, PROJECT_READ, PROJECT_UPDATE, accessible_projects, has_project_permission,
    memberships_with_permission,
)
from .services.portal import branding_for
from .services.client_uploads import (
    KIND_ACCEPT, UPLOAD_KINDS, ClientUploadError, create_upload_link, effective_max_bytes, file_kind, link_status,
    portal_upload_membership, receive_client_upload, resolve_link, revoke_upload_link, update_upload_link,
)
from .throttles import UploadLinkThrottle


# ------------------------------------------------------------------ serializers

class UploadLinkWriteSerializer(serializers.Serializer):
    label = serializers.CharField(max_length=150)
    instructions = serializers.CharField(max_length=2000, required=False, allow_blank=True)
    due_at = serializers.DateTimeField(required=False, allow_null=True)
    expires_at = serializers.DateTimeField(required=False, allow_null=True)
    max_file_bytes = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    allowed_kinds = serializers.ListField(child=serializers.ChoiceField(choices=UPLOAD_KINDS), required=False)


class ClientUploadFormSerializer(serializers.Serializer):
    file = serializers.FileField()
    name = serializers.CharField(max_length=120)
    email = serializers.EmailField(max_length=255)
    batch_id = serializers.UUIDField(required=False)


class PortalUploadFormSerializer(serializers.Serializer):
    file = serializers.FileField()
    batch_id = serializers.UUIDField(required=False)


def _person(user):
    return {'id': str(user.id), 'name': user.get_full_name() or user.email, 'email': user.email} if user else None


def _studio_name(workspace):
    profile = WorkspaceProfile.objects.filter(workspace=workspace).first()
    return (profile.business_name if profile and profile.business_name else None) or workspace.name


def _accept(kinds):
    return [token for kind in (kinds or UPLOAD_KINDS) for token in KIND_ACCEPT[kind]]


def link_data(link, *, stats=None):
    stats = stats or {}
    return {
        'id': str(link.id), 'project_id': str(link.project_id), 'label': link.label, 'instructions': link.instructions,
        'token': link.token, 'path': f'/upload/{link.token}', 'due_at': link.due_at, 'expires_at': link.expires_at,
        'max_file_bytes': link.max_file_bytes, 'allowed_kinds': link.allowed_kinds, 'status': link_status(link),
        'created_by': _person(link.created_by_user), 'created_at': link.created_at, 'revoked_at': link.revoked_at,
        'upload_count': stats.get('count', 0), 'last_upload_at': stats.get('last'),
    }


def upload_data(row):
    project_file = row.project_file
    return {
        'id': str(row.id), 'project_id': str(row.project_id), 'project_file_id': str(project_file.id),
        'folder_id': str(project_file.folder_id) if project_file.folder_id else None,
        'file_name': project_file.file.original_name, 'mime_type': project_file.file.mime_type,
        'size_bytes': project_file.file.size_bytes, 'kind': file_kind(project_file.file.mime_type),
        'status': project_file.file.status, 'removed': project_file.deleted_at is not None,
        'uploader_name': row.uploader_name, 'uploader_email': row.uploader_email,
        'via': 'link' if row.upload_link_id else 'portal',
        'upload_link_label': row.upload_link.label if row.upload_link_id else None,
        'batch_id': str(row.batch_id), 'created_at': row.created_at,
    }


def _project(workspace_id, project_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    return get_object_or_404(Project.objects.select_related('workspace'), id=project_id, workspace=workspace)


def _require_manager(request, project):
    for key in (PROJECT_UPDATE, PROJECT_FILE_CREATE):
        if not has_project_permission(user=request.user, project=project, permission_key=key):
            raise PermissionDenied('You do not have permission to manage upload links on this project.')


def _error(exc):
    return Response({'detail': str(exc)}, status=exc.status)


# ------------------------------------------------------------- team: links

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def project_upload_links(request, workspace_id, project_id):
    project = _project(workspace_id, project_id)
    _require_manager(request, project)
    if request.method == 'GET':
        links = list(UploadLink.objects.filter(project=project).select_related('created_by_user').order_by('-created_at'))
        stats = {}
        for row in ClientUpload.objects.filter(upload_link__in=links).values('upload_link_id', 'created_at'):
            entry = stats.setdefault(row['upload_link_id'], {'count': 0, 'last': None})
            entry['count'] += 1
            entry['last'] = max(filter(None, (entry['last'], row['created_at'])))
        return Response([link_data(link, stats=stats.get(link.id)) for link in links])
    serializer = UploadLinkWriteSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    membership = memberships_with_permission(user=request.user, workspace=project.workspace, permission_key=PROJECT_FILE_CREATE).first()
    try:
        link = create_upload_link(project=project, user=request.user, membership=membership, **serializer.validated_data)
    except ClientUploadError as exc:
        return _error(exc)
    return Response(link_data(link), status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def project_upload_link_detail(request, workspace_id, project_id, link_id):
    project = _project(workspace_id, project_id)
    _require_manager(request, project)
    link = get_object_or_404(UploadLink.objects.select_related('created_by_user', 'project', 'workspace'), id=link_id, project=project)
    try:
        if request.method == 'DELETE' or request.data.get('revoked') is True:
            link = revoke_upload_link(link=link, user=request.user)
        else:
            serializer = UploadLinkWriteSerializer(data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            link = update_upload_link(link=link, user=request.user, changes=dict(serializer.validated_data))
    except ClientUploadError as exc:
        return _error(exc)
    return Response(link_data(link, stats={'count': link.uploads.count()}))


# --------------------------------------------- signed in: uploads + portal

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def project_client_uploads(request, workspace_id, project_id):
    project = _project(workspace_id, project_id)
    if request.method == 'GET':
        rows = ClientUpload.objects.filter(project=project).select_related('project_file__file', 'upload_link')
        if not has_project_permission(user=request.user, project=project, permission_key=PROJECT_FILE_READ):
            if portal_upload_membership(user=request.user, project=project) is None:
                raise PermissionDenied('You do not have permission to see files sent to this project.')
            # A client sees what their side sent, never another sender's address book.
            rows = rows.filter(uploaded_by_user=request.user)
        return Response([upload_data(row) for row in rows.order_by('-created_at')[:100]])
    membership = portal_upload_membership(user=request.user, project=project)
    if membership is None:
        raise PermissionDenied('You cannot send files to this project.')
    serializer = PortalUploadFormSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = request.user
    try:
        received = receive_client_upload(
            project=project, upload=serializer.validated_data['file'], name=user.get_full_name() or user.email,
            email=user.email, batch_id=serializer.validated_data.get('batch_id') or uuid.uuid4(), user=user, membership=membership,
        )
    except ClientUploadError as exc:
        return _error(exc)
    return Response(upload_data(received), status=status.HTTP_201_CREATED)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def client_portal(request, workspace_id):
    """What the portal home's upload area needs: where this user may send files, and what they sent."""
    workspace = get_object_or_404(Workspace, id=workspace_id)
    projects = accessible_projects(user=request.user, workspace=workspace, permission_key=PROJECT_READ).order_by('name')
    targets = [
        {'id': str(project.id), 'name': project.name, 'status': project.status}
        for project in projects if portal_upload_membership(user=request.user, project=project) is not None
    ]
    # Live work first, so the picker opens on the project a client is most likely sending to.
    targets.sort(key=lambda project: (project['status'] != 'ACTIVE', project['name'].lower()))
    recent = ClientUpload.objects.filter(
        workspace=workspace, uploaded_by_user=request.user,
    ).select_related('project_file__file', 'upload_link').order_by('-created_at')[:12]
    return Response({
        'projects': targets, 'recent_uploads': [upload_data(row) for row in recent],
        'max_file_bytes': effective_max_bytes(None), 'accept': _accept(None),
        'branding': branding_for(workspace),
    })


# ------------------------------------------------------------------ public

def _public_link(link):
    return {
        'studio_name': _studio_name(link.workspace), 'project_name': link.project.name, 'label': link.label,
        'instructions': link.instructions, 'due_at': link.due_at, 'expires_at': link.expires_at,
        'max_file_bytes': effective_max_bytes(link), 'allowed_kinds': link.allowed_kinds or list(UPLOAD_KINDS),
        'accept': _accept(link.allowed_kinds), 'branding': branding_for(link.workspace),
    }


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([UploadLinkThrottle])
def public_upload_link(request, token):
    try:
        link = resolve_link(token)
    except ClientUploadError as exc:
        return _error(exc)
    return Response(_public_link(link))


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([UploadLinkThrottle])
def public_upload_link_file(request, token):
    try:
        link = resolve_link(token)
    except ClientUploadError as exc:
        return _error(exc)
    serializer = ClientUploadFormSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    try:
        received = receive_client_upload(
            project=link.project, upload=data['file'], name=data['name'], email=data['email'],
            batch_id=data.get('batch_id') or uuid.uuid4(), link=link,
        )
    except ClientUploadError as exc:
        return _error(exc)
    # The sender sees their own file back, and nothing else about the project.
    return Response({
        'id': str(received.id), 'file_name': received.project_file.file.original_name,
        'size_bytes': received.project_file.file.size_bytes, 'created_at': received.created_at,
    }, status=status.HTTP_201_CREATED)
