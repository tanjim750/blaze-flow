from rest_framework import serializers

from app.models import AIFinding, AIReview, GlossaryTerm, GlossaryTermKind


class AIReviewSerializer(serializers.ModelSerializer):
    media_version_id = serializers.UUIDField(read_only=True)
    requested_by = serializers.SerializerMethodField()
    summary = serializers.SerializerMethodField()

    class Meta:
        model = AIReview
        fields = (
            'id', 'media_version_id', 'status', 'stage', 'progress', 'mode', 'language', 'engine',
            'engine_version', 'pipeline_version', 'error_code', 'error_message', 'requested_by',
            'summary', 'usage', 'started_at', 'completed_at', 'created_at', 'updated_at',
        )

    def get_requested_by(self, review):
        user = review.requested_by
        return {'id': str(user.id), 'name': user.get_full_name() or user.email} if user else None

    def get_summary(self, review):
        summary = {'total': 0, 'by_category': {}, 'by_band': {}, 'by_status': {}}
        for category, band, status in AIFinding.objects.filter(ai_review=review).values_list('category', 'band', 'status'):
            summary['total'] += 1
            for key, value in (('by_category', category), ('by_band', band), ('by_status', status)):
                summary[key][value] = summary[key].get(value, 0) + 1
        return summary


class AIFindingSerializer(serializers.ModelSerializer):
    comment_id = serializers.SerializerMethodField()

    class Meta:
        model = AIFinding
        fields = (
            'id', 'category', 'band', 'detected_text', 'suggested_text', 'edited_suggestion',
            'context_text', 'explanation', 'ocr_confidence', 'decision_confidence', 'region',
            'start_time_ms', 'end_time_ms', 'track', 'status', 'comment_id', 'reviewed_at', 'created_at',
        )

    def get_comment_id(self, finding):
        comment = finding.comment
        return str(comment.id) if comment and comment.deleted_at is None else None


class AIReviewStartSerializer(serializers.Serializer):
    language = serializers.ChoiceField(choices=('en-GB', 'en-US'), default='en-GB')


class AIFindingUpdateSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=('PENDING', 'ACCEPTED', 'DISMISSED', 'NOT_AN_ERROR'), required=False)
    edited_suggestion = serializers.CharField(max_length=500, required=False, allow_blank=True)
    add_to_glossary = serializers.ChoiceField(choices=('project', 'workspace'), required=False)


class AIFindingCommentSerializer(serializers.Serializer):
    visibility = serializers.ChoiceField(choices=('team', 'client'), default='team')
    text = serializers.CharField(max_length=5000, required=False, allow_blank=True)


class GlossaryTermSerializer(serializers.ModelSerializer):
    project_id = serializers.UUIDField(read_only=True, allow_null=True)

    class Meta:
        model = GlossaryTerm
        fields = ('id', 'project_id', 'term', 'normalized', 'kind', 'enabled', 'created_at')
        read_only_fields = ('normalized', 'created_at')


class GlossaryTermWriteSerializer(serializers.Serializer):
    term = serializers.CharField(max_length=200)
    kind = serializers.ChoiceField(choices=GlossaryTermKind.values, default=GlossaryTermKind.OTHER)
    project_id = serializers.UUIDField(required=False, allow_null=True)
