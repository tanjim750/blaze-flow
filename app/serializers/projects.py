from rest_framework import serializers

from app.models import PriorityLevel, Project, ProjectStatus


class ProjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Project
        fields = (
            'id', 'workspace_id', 'name', 'description', 'status', 'priority',
            'start_at', 'due_at', 'created_at', 'updated_at',
        )
        read_only_fields = ('id', 'workspace_id', 'created_at', 'updated_at')


class ProjectCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200)
    description = serializers.CharField(required=False, allow_blank=True)
    priority = serializers.ChoiceField(choices=PriorityLevel.choices, default=PriorityLevel.MEDIUM)
    start_at = serializers.DateTimeField(required=False, allow_null=True)
    due_at = serializers.DateTimeField(required=False, allow_null=True)

    def validate(self, attrs):
        start_at = attrs.get('start_at', getattr(self.instance, 'start_at', None))
        due_at = attrs.get('due_at', getattr(self.instance, 'due_at', None))
        if start_at and due_at and due_at < start_at:
            raise serializers.ValidationError({'due_at': 'The due date cannot be before the start date.'})
        return attrs


class ProjectUpdateSerializer(ProjectCreateSerializer):
    name = serializers.CharField(max_length=200, required=False)
    priority = serializers.ChoiceField(choices=PriorityLevel.choices, required=False)
    status = serializers.ChoiceField(choices=ProjectStatus.choices, required=False)
