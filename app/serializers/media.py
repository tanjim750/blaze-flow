from rest_framework import serializers

from app.models import MediaVersion, MediaVersionStageEntry, PriorityLevel, WorkflowStageStatus


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
    return MediaVersionStageEntry.objects.filter(media_version=media)


class WorkflowTransitionSerializer(serializers.Serializer):
    workflow_stage_id = serializers.UUIDField()
    workflow_stage_status_id = serializers.UUIDField(required=False, allow_null=True)


class WorkflowStageSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()
    slug = serializers.CharField()
    sort_order = serializers.IntegerField()
    statuses = serializers.SerializerMethodField()

    def get_statuses(self, stage):
        statuses = WorkflowStageStatus.objects.filter(
            workflow_stage=stage,
            status='ACTIVE',
        ).order_by('sort_order', 'name')
        return [
            {'id': str(item.id), 'name': item.name, 'slug': item.slug, 'sort_order': item.sort_order}
            for item in statuses
        ]


class StageHistorySerializer(serializers.ModelSerializer):
    stage = serializers.SerializerMethodField()
    stage_status = serializers.SerializerMethodField()

    class Meta:
        model = MediaVersionStageEntry
        fields = ('id', 'stage', 'stage_status', 'snapshot', 'entered_at', 'exited_at', 'created_at')

    def get_stage(self, entry):
        if not entry.workflow_stage:
            return None
        return {'id': str(entry.workflow_stage.id), 'name': entry.workflow_stage.name, 'slug': entry.workflow_stage.slug}

    def get_stage_status(self, entry):
        if not entry.workflow_stage_status:
            return None
        return {'id': str(entry.workflow_stage_status.id), 'name': entry.workflow_stage_status.name, 'slug': entry.workflow_stage_status.slug}
