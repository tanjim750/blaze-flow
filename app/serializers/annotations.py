from rest_framework import serializers

from app.models import Annotation, AnnotationElement, AnnotationRevision


ALLOWED_ELEMENT_TYPES = {'POINT', 'RECTANGLE', 'ELLIPSE', 'ARROW', 'PATH', 'TEXT'}


def normalized_number(value, name):
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not 0 <= value <= 1:
        raise serializers.ValidationError(f'{name} must be a number between 0 and 1.')


class AnnotationElementInputSerializer(serializers.Serializer):
    element_type = serializers.ChoiceField(choices=sorted(ALLOWED_ELEMENT_TYPES))
    geometry = serializers.JSONField()
    style = serializers.JSONField(required=False, default=dict)
    payload = serializers.JSONField(required=False, default=dict)

    def validate(self, attrs):
        kind, geometry, payload = attrs['element_type'], attrs['geometry'], attrs['payload']
        if not isinstance(geometry, dict) or not isinstance(attrs['style'], dict) or not isinstance(payload, dict):
            raise serializers.ValidationError('geometry, style, and payload must be objects.')
        if kind in {'POINT', 'TEXT'}:
            for key in ('x', 'y'):
                normalized_number(geometry.get(key), key)
        elif kind in {'RECTANGLE', 'ELLIPSE'}:
            for key in ('x', 'y', 'width', 'height'):
                normalized_number(geometry.get(key), key)
            if geometry['x'] + geometry['width'] > 1 or geometry['y'] + geometry['height'] > 1:
                raise serializers.ValidationError('The shape must fit within normalized bounds.')
        elif kind == 'ARROW':
            for point_name in ('start', 'end'):
                point = geometry.get(point_name)
                if not isinstance(point, dict):
                    raise serializers.ValidationError(f'{point_name} must be an object.')
                normalized_number(point.get('x'), f'{point_name}.x')
                normalized_number(point.get('y'), f'{point_name}.y')
        elif kind == 'PATH':
            points = geometry.get('points')
            if not isinstance(points, list) or not 2 <= len(points) <= 500:
                raise serializers.ValidationError('PATH requires between 2 and 500 points.')
            for index, point in enumerate(points):
                if not isinstance(point, dict):
                    raise serializers.ValidationError(f'points[{index}] must be an object.')
                normalized_number(point.get('x'), f'points[{index}].x')
                normalized_number(point.get('y'), f'points[{index}].y')
        if kind == 'TEXT' and not str(payload.get('text', '')).strip():
            raise serializers.ValidationError('TEXT payload requires non-empty text.')
        return attrs


class AnnotationWriteSerializer(serializers.Serializer):
    review_comment_id = serializers.UUIDField(required=False, allow_null=True)
    start_time_ms = serializers.IntegerField(required=False, allow_null=True, min_value=0)
    end_time_ms = serializers.IntegerField(required=False, allow_null=True, min_value=0)
    elements = AnnotationElementInputSerializer(many=True, allow_empty=False)

    def validate(self, attrs):
        start, end = attrs.get('start_time_ms'), attrs.get('end_time_ms')
        if end is not None and start is None:
            raise serializers.ValidationError('end_time_ms requires start_time_ms.')
        if start is not None and end is not None and end < start:
            raise serializers.ValidationError('end_time_ms cannot precede start_time_ms.')
        return attrs


class AnnotationSerializer(serializers.ModelSerializer):
    author_user_id = serializers.UUIDField(allow_null=True)
    author_guest_session_id = serializers.UUIDField(allow_null=True)
    elements = serializers.SerializerMethodField()
    revision_count = serializers.SerializerMethodField()

    class Meta:
        model = Annotation
        fields = ('id', 'review_comment_id', 'author_user_id', 'author_guest_session_id', 'start_time_ms', 'end_time_ms', 'elements', 'revision_count', 'created_at', 'updated_at')

    def get_elements(self, annotation):
        return list(AnnotationElement.objects.filter(annotation=annotation).order_by('sort_order').values('id', 'element_type', 'sort_order', 'geometry', 'style', 'payload'))

    def get_revision_count(self, annotation):
        return AnnotationRevision.objects.filter(annotation=annotation).count()


class AnnotationRevisionSerializer(serializers.ModelSerializer):
    class Meta:
        model = AnnotationRevision
        fields = ('id', 'edited_by_user_id', 'snapshot', 'created_at')
