from rest_framework import serializers

from app.models import FileStatus, FileVariant, ProjectFile, ProjectFolder
from app.services.file_processing import POSTER_VARIANT_TYPE


class ProjectFolderSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProjectFolder
        fields = ('id', 'workspace_id', 'client_team_id', 'project_id', 'parent_folder_id', 'name', 'created_at')
        read_only_fields = fields


class ProjectFolderCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255)
    parent_folder_id = serializers.UUIDField(required=False, allow_null=True)


class ProjectFolderUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255)


class ProjectFileUploadSerializer(serializers.Serializer):
    file = serializers.FileField()
    folder_id = serializers.UUIDField(required=False, allow_null=True)


class ProjectFileSerializer(serializers.ModelSerializer):
    file = serializers.SerializerMethodField()
    added_by = serializers.SerializerMethodField()
    poster = serializers.SerializerMethodField()

    class Meta:
        model = ProjectFile
        fields = ('id', 'workspace_id', 'client_team_id', 'project_id', 'folder_id', 'task_stage_id', 'file', 'added_by', 'poster', 'created_at')
        read_only_fields = fields

    def get_poster(self, project_file):
        """The still a list shows, with the frame's own dimensions.

        The dimensions are what let a card size its box to the media rather than cropping
        it into a fixed rectangle. Read from an annotation where the view supplies one, so
        rendering a list costs one query rather than one per row.
        """
        if hasattr(project_file, 'poster_metadata_annotation'):
            metadata = project_file.poster_metadata_annotation
        else:
            metadata = FileVariant.objects.filter(
                file_id=project_file.file_id, status=FileStatus.READY, deleted_at__isnull=True,
                metadata__variant_type__in=(POSTER_VARIANT_TYPE, 'IMAGE_THUMBNAIL'),
            ).values_list('metadata', flat=True).first()
        if not metadata:
            return None
        width, height = metadata.get('width'), metadata.get('height')
        return {'width': width, 'height': height} if width and height else {'width': None, 'height': None}

    def get_added_by(self, project_file):
        """Who uploaded it. Recorded all along, but never returned, so every card that
        wanted to name an uploader had to say "Workspace member"."""
        membership = project_file.added_by_workspace_membership
        user = getattr(membership, 'user', None)
        if user is None:
            return None
        name = f'{user.first_name} {user.last_name}'.strip()
        return {'id': str(user.id), 'name': name or user.email, 'email': user.email}

    def get_file(self, project_file):
        item = project_file.file
        return {
            'id': str(item.id),
            'name': item.original_name,
            'mime_type': item.mime_type,
            'size_bytes': item.size_bytes,
            'checksum_sha256': item.checksum,
            'status': item.status,
        }


class AssetFolderWriteSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255, required=False)
    client_team_id = serializers.UUIDField(required=False, allow_null=True)
    project_id = serializers.UUIDField(required=False, allow_null=True)
    parent_folder_id = serializers.UUIDField(required=False, allow_null=True)


class AssetFileUploadSerializer(serializers.Serializer):
    file = serializers.FileField()
    client_team_id = serializers.UUIDField(required=False, allow_null=True)
    project_id = serializers.UUIDField(required=False, allow_null=True)
    folder_id = serializers.UUIDField(required=False, allow_null=True)
    task_stage_id = serializers.UUIDField(required=False, allow_null=True)


class AssetFileUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=512, required=False)
    client_team_id = serializers.UUIDField(required=False, allow_null=True)
    project_id = serializers.UUIDField(required=False, allow_null=True)
    folder_id = serializers.UUIDField(required=False, allow_null=True)
    task_stage_id = serializers.UUIDField(required=False, allow_null=True)
