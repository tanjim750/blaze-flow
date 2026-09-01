from rest_framework import serializers

from app.models import (
    ReviewComment,
    ReviewCommentContent,
    ReviewCommentMention,
    ReviewCommentRevision,
)


def mention_user_ids_field(**kwargs):
    return serializers.ListField(
        child=serializers.UUIDField(),
        allow_empty=True,
        **kwargs,
    )


class ReviewCommentCreateSerializer(serializers.Serializer):
    text = serializers.CharField(max_length=10000)
    mentioned_user_ids = mention_user_ids_field(required=False, default=list)
    parent_comment_id = serializers.UUIDField(required=False, allow_null=True)
    start_time_ms = serializers.IntegerField(required=False, allow_null=True, min_value=0)
    end_time_ms = serializers.IntegerField(required=False, allow_null=True, min_value=0)

    def validate(self, attrs):
        start = attrs.get('start_time_ms')
        end = attrs.get('end_time_ms')
        if attrs.get('parent_comment_id') and (start is not None or end is not None):
            raise serializers.ValidationError('Replies inherit timing from their parent comment.')
        if end is not None and start is None:
            raise serializers.ValidationError('end_time_ms requires start_time_ms.')
        if start is not None and end is not None and end < start:
            raise serializers.ValidationError('end_time_ms must be greater than or equal to start_time_ms.')
        return attrs


class ReviewCommentEditSerializer(serializers.Serializer):
    text = serializers.CharField(max_length=10000)
    mentioned_user_ids = mention_user_ids_field(required=False)


class RevisionRequestSerializer(serializers.Serializer):
    text = serializers.CharField(max_length=10000)
    mentioned_user_ids = mention_user_ids_field(required=False, default=list)
    start_time_ms = serializers.IntegerField(required=False, allow_null=True, min_value=0)
    end_time_ms = serializers.IntegerField(required=False, allow_null=True, min_value=0)

    def validate(self, attrs):
        start = attrs.get('start_time_ms')
        end = attrs.get('end_time_ms')
        if end is not None and start is None:
            raise serializers.ValidationError('end_time_ms requires start_time_ms.')
        if start is not None and end is not None and end < start:
            raise serializers.ValidationError('end_time_ms must be greater than or equal to start_time_ms.')
        return attrs


class ReviewCommentResolutionSerializer(serializers.Serializer):
    resolved = serializers.BooleanField()


class ReviewCommentSerializer(serializers.ModelSerializer):
    parent_comment_id = serializers.UUIDField(allow_null=True)
    author = serializers.SerializerMethodField()
    text = serializers.SerializerMethodField()
    revision_count = serializers.SerializerMethodField()
    mentions = serializers.SerializerMethodField()
    attachments = serializers.SerializerMethodField()

    class Meta:
        model = ReviewComment
        fields = (
            'id', 'parent_comment_id', 'author', 'text', 'start_time_ms', 'end_time_ms',
            'resolved', 'resolved_by_user_id', 'resolved_at', 'mentions', 'attachments', 'revision_count',
            'created_at', 'updated_at',
        )

    def get_author(self, comment):
        user = comment.author_user
        if user is None:
            return None
        return {
            'id': str(user.id),
            'email': user.email,
            'name': user.get_full_name(),
        }

    def get_text(self, comment):
        content = ReviewCommentContent.objects.filter(
            review_comment=comment,
            content_type='TEXT',
        ).order_by('sort_order', 'created_at').first()
        return content.text_content if content else None

    def get_revision_count(self, comment):
        return ReviewCommentRevision.objects.filter(review_comment=comment).count()

    def get_mentions(self, comment):
        mentions = ReviewCommentMention.objects.filter(review_comment=comment).select_related(
            'user'
        ).order_by('created_at')
        return [
            {
                'id': str(mention.user.id),
                'email': mention.user.email,
                'name': mention.user.get_full_name(),
            }
            for mention in mentions
        ]

    def get_attachments(self, comment):
        contents = ReviewCommentContent.objects.filter(
            review_comment=comment,
            file__isnull=False,
            deleted_at__isnull=True,
        ).select_related('file').order_by('sort_order', 'created_at')
        return [
            {
                'id': str(content.id),
                'content_type': content.content_type,
                'file': {
                    'id': str(content.file.id),
                    'name': content.file.original_name,
                    'mime_type': content.file.mime_type,
                    'size_bytes': content.file.size_bytes,
                    'checksum_sha256': content.file.checksum,
                },
            }
            for content in contents
        ]


class ReviewCommentRevisionSerializer(serializers.ModelSerializer):
    edited_by_user_id = serializers.UUIDField(allow_null=True)

    class Meta:
        model = ReviewCommentRevision
        fields = ('id', 'edited_by_user_id', 'snapshot', 'created_at')
