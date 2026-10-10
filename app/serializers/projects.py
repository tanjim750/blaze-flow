from rest_framework import serializers

from app.models import PriorityLevel, Project, ProjectStatus


ASPECT_RATIOS = ('16:9', '9:16', '1:1', '4:5')
PLATFORMS = ('YouTube', 'Instagram', 'TikTok', 'TV', 'Other')
SPEC_KEYS = ('aspect_ratio', 'target_length_seconds', 'platform', 'resolution', 'notes')


class DeliverableSpecsSerializer(serializers.Serializer):
    """The Brief tab's structured specs. Every field is optional; null clears it."""

    aspect_ratio = serializers.ChoiceField(choices=ASPECT_RATIOS, required=False, allow_null=True)
    target_length_seconds = serializers.IntegerField(min_value=1, max_value=24 * 60 * 60, required=False, allow_null=True)
    platform = serializers.ChoiceField(choices=PLATFORMS, required=False, allow_null=True)
    resolution = serializers.CharField(max_length=40, required=False, allow_blank=True, allow_null=True)
    notes = serializers.CharField(max_length=2000, required=False, allow_blank=True, allow_null=True)

    def to_internal_value(self, data):
        if isinstance(data, dict):
            unknown = set(data) - set(SPEC_KEYS)
            if unknown:
                raise serializers.ValidationError(f"Unknown spec fields: {', '.join(sorted(unknown))}.")
        return super().to_internal_value(data)


def normalized_specs(specs):
    """Always every key, with blanks as null, so the client never guesses at a missing one."""
    specs = specs if isinstance(specs, dict) else {}
    out = {}
    for key in SPEC_KEYS:
        value = specs.get(key)
        if isinstance(value, str):
            value = value.strip() or None
        out[key] = value
    return out


class ProjectSerializer(serializers.ModelSerializer):
    deliverable_specs = serializers.SerializerMethodField()
    viewer_can_edit = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = (
            'id', 'workspace_id', 'client_team_id', 'name', 'description', 'status', 'priority',
            'start_at', 'due_at', 'deliverable_specs', 'viewer_can_edit', 'created_at', 'updated_at',
        )
        read_only_fields = ('id', 'workspace_id', 'created_at', 'updated_at')

    def get_deliverable_specs(self, project):
        return normalized_specs(project.deliverable_specs)

    def get_viewer_can_edit(self, project):
        # Only the project detail route works this out (it costs a permission query); lists
        # leave it null rather than guess.
        return self.context.get('viewer_can_edit')


class ProjectCreateSerializer(serializers.Serializer):
    client_team_id = serializers.UUIDField(required=False, allow_null=True)
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
    description = serializers.CharField(required=False, allow_blank=True, allow_null=True, max_length=20000)
    deliverable_specs = DeliverableSpecsSerializer(required=False)

    def validate_deliverable_specs(self, value):
        # A PATCH sends only the spec fields it changes; merge onto what is stored.
        current = normalized_specs(getattr(self.instance, 'deliverable_specs', None))
        current.update(value)
        return {key: item for key, item in normalized_specs(current).items() if item is not None}
    priority = serializers.ChoiceField(choices=PriorityLevel.choices, required=False)
    status = serializers.ChoiceField(choices=ProjectStatus.choices, required=False)
