"""``POST /api/workspaces/<id>/asset-files/<id>/publish/``: a library file becomes a review version.

See ``services/publish.py`` for what publishing does. This module only checks who may do it
and validates the payload. The caller needs, on the destination project: moving assets in
(``project_file.update``) and adding review media (``media.create``); plus comment and
annotation create rights when it brings notes or drawings along, and comment manage when
any of those notes were resolved. On the file's current location it needs
``project_file.update`` — publishing moves it.
"""
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Project, ProjectFile, ProjectFolder, Workspace
from .permissions import (
    ANNOTATION_CREATE, MEDIA_CREATE, PROJECT_FILE_UPDATE, REVIEW_COMMENT_CREATE, REVIEW_COMMENT_MANAGE,
    has_project_permission, has_workspace_permission,
)
from .serializers import MediaVersionSerializer, ProjectFileSerializer
from .serializers.annotations import AnnotationElementInputSerializer
from .serializers.comments import mention_user_ids_field
from .services.publish import PublishError, publish_library_file

MAX_NOTES = 500


class PublishReplySerializer(serializers.Serializer):
    key = serializers.CharField(max_length=100)
    text = serializers.CharField(max_length=10000)
    mentioned_user_ids = mention_user_ids_field(required=False, default=list)


class PublishNoteSerializer(serializers.Serializer):
    key = serializers.CharField(max_length=100)
    text = serializers.CharField(max_length=10000)
    start_time_ms = serializers.IntegerField(required=False, allow_null=True, min_value=0)
    resolved = serializers.BooleanField(required=False, default=False)
    mentioned_user_ids = mention_user_ids_field(required=False, default=list)
    elements = AnnotationElementInputSerializer(many=True, required=False, default=list)
    replies = PublishReplySerializer(many=True, required=False, default=list)


class PublishDrawingSerializer(serializers.Serializer):
    start_time_ms = serializers.IntegerField(required=False, allow_null=True, min_value=0)
    elements = AnnotationElementInputSerializer(many=True, allow_empty=False)


class PublishSerializer(serializers.Serializer):
    project_id = serializers.UUIDField()
    folder_id = serializers.UUIDField(required=False, allow_null=True)
    version_of_id = serializers.UUIDField(required=False, allow_null=True, help_text='An asset file in the project to add this as the next version of.')
    title = serializers.CharField(required=False, allow_blank=True, max_length=200)
    notes = PublishNoteSerializer(many=True, required=False, default=list)
    annotations = PublishDrawingSerializer(many=True, required=False, default=list)

    def validate(self, attrs):
        if len(attrs['notes']) + sum(len(note['replies']) for note in attrs['notes']) > MAX_NOTES:
            raise serializers.ValidationError(f'At most {MAX_NOTES} notes can be published at once.')
        keys = [note['key'] for note in attrs['notes']] + [reply['key'] for note in attrs['notes'] for reply in note['replies']]
        if len(keys) != len(set(keys)):
            raise serializers.ValidationError('Every note needs its own key.')
        return attrs


def _require(user, project, key, message):
    if not has_project_permission(user=user, project=project, permission_key=key):
        raise PermissionDenied(message)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def asset_file_publish(request, workspace_id, file_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    item = get_object_or_404(ProjectFile.objects.select_related('file', 'project'), id=file_id, workspace=workspace, deleted_at__isnull=True)
    if item.project_id:
        _require(request.user, item.project, PROJECT_FILE_UPDATE, 'You do not have permission to move this file.')
    elif not has_workspace_permission(user=request.user, workspace=workspace, permission_key=PROJECT_FILE_UPDATE):
        raise PermissionDenied('You do not have permission to move this file.')

    serializer = PublishSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    project = get_object_or_404(Project, id=data['project_id'], workspace=workspace)
    _require(request.user, project, PROJECT_FILE_UPDATE, 'You do not have permission to add files to that project.')
    _require(request.user, project, MEDIA_CREATE, 'You do not have permission to add review versions to that project.')
    notes, drawings = data['notes'], data['annotations']
    if notes:
        _require(request.user, project, REVIEW_COMMENT_CREATE, 'You do not have permission to comment in that project, so your notes cannot be saved there.')
    if drawings or any(note['elements'] for note in notes):
        _require(request.user, project, ANNOTATION_CREATE, 'You do not have permission to draw on review versions in that project.')
    if any(note['resolved'] for note in notes):
        _require(request.user, project, REVIEW_COMMENT_MANAGE, 'You do not have permission to resolve comments in that project.')

    folder = None
    if data.get('folder_id'):
        folder = get_object_or_404(ProjectFolder, id=data['folder_id'], workspace=workspace, deleted_at__isnull=True)
    version_of = None
    if data.get('version_of_id'):
        version_of = get_object_or_404(ProjectFile.objects.select_related('file'), id=data['version_of_id'], workspace=workspace, deleted_at__isnull=True)

    try:
        media_version, project_file, comment_ids = publish_library_file(
            project_file=item, project=project, user=request.user, folder=folder, version_of=version_of,
            title=data.get('title') or None, notes=notes, annotations=drawings,
        )
    except PublishError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response({
        'media_version': MediaVersionSerializer(media_version).data,
        'asset_file': ProjectFileSerializer(project_file).data,
        'comment_ids': comment_ids,
    }, status=status.HTTP_201_CREATED)
