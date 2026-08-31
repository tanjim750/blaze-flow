from rest_framework import serializers

from app.models import MediaVersion, PriorityLevel, WorkflowStage


class MediaUploadSerializer(serializers.Serializer):
    file = serializers.FileField()
    title = serializers.CharField(max_length=200)
    note = serializers.CharField(required=False, allow_blank=True)
    priority = serializers.ChoiceField(choices=PriorityLevel.choices, default=PriorityLevel.MEDIUM)
    allow_download = serializers.BooleanField(default=False)
    initial_stage_id = serializers.UUIDField(required=False)


class MediaVersionSerializer(serializers.ModelSerializer):
    file = serializers.SerializerMethodField()
    current_stage = serializers.SerializerMethodField()

    class Meta:
        model = MediaVersion
        fields = (
            'id', 'project_id', 'version_number', 'title', 'note', 'priority',
            'allow_download', 'status', 'file', 'current_stage', 'created_at',
        )

    def get_file(self, media):
        file_record = media.original_file
        return {
            'id': str(file_record.id),
            'name': file_record.original_name,
            'mime_type': file_record.mime_type,
            'size_bytes': file_record.size_bytes,
        }

    def get_current_stage(self, media):
        entry = media_stage_entries(media).filter(exited_at__isnull=True).select_related(
            'workflow_stage'
        ).first()
        if not entry or not entry.workflow_stage:
            return None
        return {
            'id': str(entry.workflow_stage.id),
            'name': entry.workflow_stage.name,
            'slug': entry.workflow_stage.slug,
        }


def media_stage_entries(media):
    from app.models import MediaVersionStageEntry

    return MediaVersionStageEntry.objects.filter(media_version=media)
