from rest_framework import serializers

from app.models import ProjectFile, ProjectFolder


class ProjectFolderSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProjectFolder
        fields = ('id', 'project_id', 'parent_folder_id', 'name', 'created_at')
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

    class Meta:
        model = ProjectFile
        fields = ('id', 'project_id', 'folder_id', 'file', 'created_at')
        read_only_fields = fields

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
