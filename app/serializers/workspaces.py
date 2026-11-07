from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.utils.text import slugify
from rest_framework import serializers

from app.models import Workspace, WorkspaceProfile
from app.services.nav_order import NAV_KEYS, effective_nav_order


class WorkspaceSerializer(serializers.ModelSerializer):
    # Always the full, valid order (stored order first, then any keys added since).
    nav_order = serializers.SerializerMethodField()

    class Meta:
        model = Workspace
        fields = ('id', 'name', 'slug', 'timezone', 'status', 'deletion_scheduled_at', 'created_at', 'nav_order')
        read_only_fields = fields

    def get_nav_order(self, workspace):
        return effective_nav_order(workspace.nav_order)


class NavOrderSerializer(serializers.Serializer):
    """PUT body: the whole order, or ``reset`` for the default."""
    order = serializers.ListField(child=serializers.CharField(max_length=40), required=False, max_length=len(NAV_KEYS))
    reset = serializers.BooleanField(required=False, default=False)

    def validate_order(self, value):
        unknown = [key for key in value if key not in NAV_KEYS]
        if unknown:
            raise serializers.ValidationError(f'Unknown sidebar item: {", ".join(unknown)}.')
        if len(set(value)) != len(value):
            raise serializers.ValidationError('Each sidebar item may appear only once.')
        if set(value) != set(NAV_KEYS):
            raise serializers.ValidationError('Send every sidebar item: ' + ', '.join(NAV_KEYS) + '.')
        return value

    def validate(self, attrs):
        if not attrs.get('reset') and 'order' not in attrs:
            raise serializers.ValidationError('Send an order, or reset: true.')
        return attrs


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


class WorkspaceUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=150, required=False)
    timezone = serializers.CharField(max_length=100, required=False)

    def validate_timezone(self, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise serializers.ValidationError('Use a valid IANA timezone, such as Europe/London.') from exc
        return value

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError('Provide at least one field to update.')
        return attrs


class WorkspaceProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkspaceProfile
        fields = (
            'business_name', 'description', 'email', 'phone', 'website_url',
            'address_line_1', 'address_line_2', 'city', 'state', 'postal_code',
            'country_code', 'updated_at',
        )
        read_only_fields = ('updated_at',)


class WorkspaceProfileUpdateSerializer(serializers.Serializer):
    business_name = serializers.CharField(max_length=200, required=False, allow_blank=True, allow_null=True)
    description = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    email = serializers.EmailField(max_length=255, required=False, allow_null=True)
    phone = serializers.CharField(max_length=50, required=False, allow_blank=True, allow_null=True)
    website_url = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    address_line_1 = serializers.CharField(max_length=255, required=False, allow_blank=True, allow_null=True)
    address_line_2 = serializers.CharField(max_length=255, required=False, allow_blank=True, allow_null=True)
    city = serializers.CharField(max_length=100, required=False, allow_blank=True, allow_null=True)
    state = serializers.CharField(max_length=100, required=False, allow_blank=True, allow_null=True)
    postal_code = serializers.CharField(max_length=30, required=False, allow_blank=True, allow_null=True)
    country_code = serializers.CharField(max_length=2, required=False, allow_blank=True, allow_null=True)


class WorkspaceRetentionPolicyUpdateSerializer(serializers.Serializer):
    review_file_cleanup_enabled = serializers.BooleanField(required=False)
    review_file_retention_days = serializers.IntegerField(
        required=False, min_value=1, max_value=3650
    )

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError('Provide at least one retention-policy field.')
        return attrs
