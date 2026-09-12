from rest_framework import serializers

from app.models import PriorityLevel, Task, TaskAssignee, TaskAttachment, TaskStage, TaskStatus

from .access import WorkspaceMembershipSerializer


class TaskSerializer(serializers.ModelSerializer):
    assignees = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = (
            'id',
            'workspace_id',
            'project_id',
            'client_team_id',
            'task_stage_id',
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
            'assignees',
        )
        read_only_fields = ('id', 'workspace_id', 'project_id', 'completed_at', 'created_at', 'updated_at')

    def get_assignees(self, task):
        rows = TaskAssignee.objects.filter(task=task).select_related('workspace_membership__user')
        return [{
            'id': str(row.workspace_membership_id),
            'name': row.workspace_membership.user.get_full_name() or row.workspace_membership.user.email,
            'email': row.workspace_membership.user.email,
        } for row in rows if row.workspace_membership.user_id]


class TaskCreateSerializer(serializers.Serializer):
    project_id = serializers.UUIDField(required=False, allow_null=True)
    client_team_id = serializers.UUIDField(required=False, allow_null=True)
    assignee_id = serializers.UUIDField(required=False, allow_null=True, write_only=True)
    task_stage_id = serializers.UUIDField(required=False, allow_null=True)
    title = serializers.CharField(max_length=255)
    description = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    priority = serializers.ChoiceField(choices=PriorityLevel.choices, default=PriorityLevel.MEDIUM)
    start_at = serializers.DateTimeField(required=False, allow_null=True)
    due_at = serializers.DateTimeField(required=False, allow_null=True)
    sort_order = serializers.IntegerField(required=False, default=0)
    status = serializers.ChoiceField(choices=TaskStatus.choices, required=False, default=TaskStatus.TODO)

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


class TaskAssigneeSerializer(serializers.ModelSerializer):
    workspace_membership = WorkspaceMembershipSerializer(read_only=True)

    class Meta:
        model = TaskAssignee
        fields = ('id', 'workspace_membership', 'assigned_at')
        read_only_fields = fields


class TaskStageSerializer(serializers.ModelSerializer):
    task_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = TaskStage
        fields = ('id', 'name', 'color', 'sort_order', 'wip_limit', 'is_done', 'automation_enabled', 'task_count')
        read_only_fields = ('id', 'task_count')


class TaskStageDeleteSerializer(serializers.Serializer):
    replacement_stage_id = serializers.UUIDField(required=False, allow_null=True)


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
