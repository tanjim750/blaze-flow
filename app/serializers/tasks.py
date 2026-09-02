from rest_framework import serializers

from app.models import PriorityLevel, Task, TaskAssignee, TaskAttachment, TaskStatus

from .access import WorkspaceMembershipSerializer


class TaskSerializer(serializers.ModelSerializer):
    class Meta:
        model = Task
        fields = (
            'id',
            'workspace_id',
            'project_id',
            'title',
            'description',
            'status',
            'priority',
            'start_at',
            'due_at',
            'completed_at',
            'sort_order',
            'created_at',
            'updated_at',
        )
        read_only_fields = ('id', 'workspace_id', 'project_id', 'completed_at', 'created_at', 'updated_at')


class TaskCreateSerializer(serializers.Serializer):
    project_id = serializers.UUIDField(required=False, allow_null=True)
    title = serializers.CharField(max_length=255)
    description = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    priority = serializers.ChoiceField(choices=PriorityLevel.choices, default=PriorityLevel.MEDIUM)
    start_at = serializers.DateTimeField(required=False, allow_null=True)
    due_at = serializers.DateTimeField(required=False, allow_null=True)
    sort_order = serializers.IntegerField(required=False, default=0)

    def validate(self, attrs):
        start_at = attrs.get('start_at', getattr(self.instance, 'start_at', None))
        due_at = attrs.get('due_at', getattr(self.instance, 'due_at', None))
        if start_at and due_at and due_at < start_at:
            raise serializers.ValidationError({'due_at': 'The due date cannot be before the start date.'})
        return attrs


class TaskUpdateSerializer(TaskCreateSerializer):
    title = serializers.CharField(max_length=255, required=False)
    priority = serializers.ChoiceField(choices=PriorityLevel.choices, required=False)
    status = serializers.ChoiceField(choices=TaskStatus.choices, required=False)

    def get_fields(self):
        # A task cannot be moved between projects through this endpoint; its project
        # scope is fixed at creation since that scope determines who may edit it.
        fields = super().get_fields()
        fields.pop('project_id', None)
        return fields


class TaskAssigneeSerializer(serializers.ModelSerializer):
    workspace_membership = WorkspaceMembershipSerializer(read_only=True)

    class Meta:
        model = TaskAssignee
        fields = ('id', 'workspace_membership', 'assigned_at')
        read_only_fields = fields


class TaskAssigneeCreateSerializer(serializers.Serializer):
    membership_id = serializers.UUIDField()


class TaskAttachmentUploadSerializer(serializers.Serializer):
    file = serializers.FileField()


class TaskAttachmentSerializer(serializers.ModelSerializer):
    file = serializers.SerializerMethodField()

    class Meta:
        model = TaskAttachment
        fields = ('id', 'file', 'attached_at')
        read_only_fields = fields

    def get_file(self, attachment):
        item = attachment.file
        return {
            'id': str(item.id),
            'name': item.original_name,
            'mime_type': item.mime_type,
            'size_bytes': item.size_bytes,
            'checksum_sha256': item.checksum,
            'status': item.status,
        }
