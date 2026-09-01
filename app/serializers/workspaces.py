from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.utils.text import slugify
from rest_framework import serializers

from app.models import Workspace


class WorkspaceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Workspace
        fields = ('id', 'name', 'slug', 'timezone', 'status', 'created_at')
        read_only_fields = fields


class WorkspaceCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=150)
    slug = serializers.SlugField(max_length=150, required=False)
    timezone = serializers.CharField(max_length=100)

    def validate_slug(self, value):
        value = slugify(value)
        if not value:
            raise serializers.ValidationError('The slug must contain letters or numbers.')
        if Workspace.objects.filter(slug=value).exists():
            raise serializers.ValidationError('This workspace slug is already in use.')
        return value

    def validate_timezone(self, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise serializers.ValidationError('Use a valid IANA timezone, such as Europe/London.') from exc
        return value

    def validate(self, attrs):
        if 'slug' not in attrs:
            generated_slug = slugify(attrs['name'])
            if not generated_slug:
                raise serializers.ValidationError({'name': 'The name must contain letters or numbers.'})
            if Workspace.objects.filter(slug=generated_slug).exists():
                raise serializers.ValidationError(
                    {'slug': 'The generated slug is already in use; provide a different slug.'}
                )
            attrs['slug'] = generated_slug
        return attrs


class WorkspaceRetentionPolicyUpdateSerializer(serializers.Serializer):
    review_file_cleanup_enabled = serializers.BooleanField(required=False)
    review_file_retention_days = serializers.IntegerField(
        required=False, min_value=1, max_value=3650
    )

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError('Provide at least one retention-policy field.')
        return attrs
