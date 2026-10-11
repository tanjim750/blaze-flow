"""Direct-to-storage upload API (see app/services/direct_uploads.py).

Routes (under /api/workspaces/<workspace_id>/uploads/):
    GET    config/            -> {"enabled": bool, ...} so the client can pick a transport
    POST   ""                 -> initialize: quota reserved; presigned PUT or multipart id
    POST   <id>/parts/        -> presigned UploadPart URLs for {"part_numbers": [...]}
    POST   <id>/complete/     -> verify + create File/ProjectFile, enqueue scan (idempotent)
    DELETE <id>/              -> abort and release the reservation
"""
from django.conf import settings
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import DirectUpload, Workspace
from .serializers import ProjectFileSerializer
from .services import direct_uploads as service
from .services.project_files import ProjectFileError
from .services.subscriptions import SubscriptionError
from .views import (
    PROJECT_FILE_CREATE, _asset_relations, _asset_stage, _require_project_permission,
    _require_workspace_permission, memberships_with_permission,
)


class InitializeSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=512)
    size = serializers.IntegerField(min_value=1)
    content_type = serializers.CharField(max_length=255, allow_blank=True, required=False, default='')
    sha256 = serializers.RegexField(r'^[0-9a-fA-F]{64}$', required=False, allow_blank=True, default='')
    client_team_id = serializers.UUIDField(required=False, allow_null=True)
    project_id = serializers.UUIDField(required=False, allow_null=True)
    folder_id = serializers.UUIDField(required=False, allow_null=True)
    task_stage_id = serializers.UUIDField(required=False, allow_null=True)


class PartsSerializer(serializers.Serializer):
    part_numbers = serializers.ListField(child=serializers.IntegerField(min_value=1, max_value=10_000), min_length=1, max_length=service.MAX_PART_URLS_PER_REQUEST)


def _bad(exc):
    return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)


def _describe(upload, extra):
    data = {
        'id': str(upload.id), 'mode': upload.mode.lower(), 'state': upload.state.lower(),
        'size': upload.expected_size, 'expires_at': upload.expires_at.isoformat(),
    }
    if upload.mode == 'MULTIPART':
        data['part_size'] = upload.part_size
        data['part_count'] = -(-upload.expected_size // upload.part_size)
    data.update(extra)
    return data


def _own_upload(request, workspace_id, upload_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    # Only the user who started an upload can continue, finish or cancel it.
    upload = get_object_or_404(DirectUpload.objects.select_related('workspace'), id=upload_id, workspace=workspace, created_by_user=request.user)
    _require_workspace_permission(request, workspace, PROJECT_FILE_CREATE)
    if upload.project_id:
        _require_project_permission(request, upload.project, PROJECT_FILE_CREATE, 'You do not have permission to add assets to this project.')
    return upload


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def direct_upload_config(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    _require_workspace_permission(request, workspace, PROJECT_FILE_CREATE)
    enabled = service.direct_uploads_enabled()
    return Response({
        'enabled': enabled,
        'single_put_max_bytes': settings.DIRECT_UPLOAD_SINGLE_PUT_MAX_BYTES if enabled else None,
        'max_file_bytes': settings.MAX_PROJECT_FILE_BYTES,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def direct_upload_initialize(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    _require_workspace_permission(request, workspace, PROJECT_FILE_CREATE)
    if not service.direct_uploads_enabled():
        return Response({'detail': 'Direct uploads are not enabled.', 'code': 'direct_uploads_disabled'}, status=status.HTTP_409_CONFLICT)
    serializer = InitializeSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    try:
        client_team, project, folder = _asset_relations(workspace, data, folder_key='folder_id')
        if project:
            _require_project_permission(request, project, PROJECT_FILE_CREATE, 'You do not have permission to add assets to this project.')
        membership = memberships_with_permission(user=request.user, workspace=workspace, permission_key=PROJECT_FILE_CREATE).first()
        upload, extra = service.initialize(
            workspace=workspace, user=request.user, membership=membership, client_team=client_team, project=project,
            folder=folder, task_stage=_asset_stage(workspace, data)[0], name=data['name'], size=data['size'],
            content_type=data['content_type'], sha256=data['sha256'],
        )
    except (ProjectFileError, SubscriptionError, service.DirectUploadError) as exc:
        return _bad(exc)
    return Response(_describe(upload, extra), status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def direct_upload_parts(request, workspace_id, upload_id):
    upload = _own_upload(request, workspace_id, upload_id)
    serializer = PartsSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        return Response({'parts': service.part_urls(upload, serializer.validated_data['part_numbers'])})
    except service.DirectUploadError as exc:
        return _bad(exc)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def direct_upload_complete(request, workspace_id, upload_id):
    upload = _own_upload(request, workspace_id, upload_id)
    try:
        item = service.complete(upload)
    except (ProjectFileError, SubscriptionError, service.DirectUploadError) as exc:
        return _bad(exc)
    return Response(ProjectFileSerializer(item).data, status=status.HTTP_201_CREATED)


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def direct_upload_cancel(request, workspace_id, upload_id):
    upload = _own_upload(request, workspace_id, upload_id)
    service.cancel(upload)
    return Response(status=status.HTTP_204_NO_CONTENT)
