from rest_framework import serializers

from app.models import (
    ReviewComment,
    ReviewCommentContent,
    ReviewCommentMention,
    ReviewCommentReaction,
    ReviewCommentRevision,
    ReviewReactionEmoji,
    ReviewCommentVisibility,
    FileVariant,
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
    # Ignored on guest routes: a guest note is always client-visible.
    visibility = serializers.ChoiceField(
        choices=ReviewCommentVisibility.choices, default=ReviewCommentVisibility.CLIENT,
    )

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


class ReviewReactionWriteSerializer(serializers.Serializer):
    emoji = serializers.ChoiceField(choices=ReviewReactionEmoji.choices)


class _CommentBulk:
    """Everything the comment serializer reads per row, loaded once for a whole page.

    The comment tables use `related_name='+'`, so Django can't prefetch them; this does the
    same job by hand: five queries for the page instead of five per comment.
    """

    def __init__(self, comments):
        from collections import Counter, defaultdict

        ids = [comment.id for comment in comments]
        self.contents = defaultdict(list)
        for content in ReviewCommentContent.objects.filter(review_comment_id__in=ids).select_related('file').order_by('sort_order', 'created_at'):
            self.contents[content.review_comment_id].append(content)
        file_ids = {c.file_id for rows in self.contents.values() for c in rows if c.file_id and c.deleted_at is None}
        self.variants = defaultdict(list)
        if file_ids:
            for variant in FileVariant.objects.filter(file_id__in=file_ids, deleted_at__isnull=True):
                self.variants[variant.file_id].append(variant)
        self.mentions = defaultdict(list)
        for mention in ReviewCommentMention.objects.filter(review_comment_id__in=ids).select_related('user').order_by('created_at'):
            self.mentions[mention.review_comment_id].append(mention)
        self.reactions = defaultdict(list)
        for reaction in ReviewCommentReaction.objects.filter(review_comment_id__in=ids).select_related(
            'reacted_by_user', 'reacted_by_guest_session'
        ).order_by('created_at', 'id'):
            self.reactions[reaction.review_comment_id].append(reaction)
        self.revision_counts = Counter(
            ReviewCommentRevision.objects.filter(review_comment_id__in=ids).values_list('review_comment_id', flat=True)
        )


class ReviewCommentListSerializer(serializers.ListSerializer):
    def to_representation(self, data):
        comments = list(data.all() if hasattr(data, 'all') else data)
        bulk = _CommentBulk(comments)
        for comment in comments:
            comment._bulk = bulk
        return [self.child.to_representation(comment) for comment in comments]


class ReviewCommentSerializer(serializers.ModelSerializer):
    parent_comment_id = serializers.UUIDField(allow_null=True)
    author = serializers.SerializerMethodField()
    text = serializers.SerializerMethodField()
    revision_count = serializers.SerializerMethodField()
    mentions = serializers.SerializerMethodField()
    attachments = serializers.SerializerMethodField()
    reactions = serializers.SerializerMethodField()

    class Meta:
        model = ReviewComment
        list_serializer_class = ReviewCommentListSerializer
        fields = (
            'id', 'parent_comment_id', 'author', 'text', 'start_time_ms', 'end_time_ms',
            'resolved', 'resolved_by_user_id', 'resolved_at', 'visibility', 'source', 'mentions', 'attachments', 'reactions', 'revision_count',
            'created_at', 'updated_at',
        )

    def get_author(self, comment):
        user = comment.author_user
        if user is None and comment.author_guest_session:
            guest = comment.author_guest_session
            return {'id': str(guest.id), 'email': guest.email, 'name': guest.name, 'type': 'guest'}
        if user is None:
            return None
        return {
            'id': str(user.id),
            'email': user.email,
            'name': user.get_full_name(), 'type': 'user',
        }

    def get_text(self, comment):
        bulk = getattr(comment, '_bulk', None)
        if bulk is not None:
            text = next((c for c in bulk.contents[comment.id] if c.content_type == 'TEXT'), None)
            return text.text_content if text else None
        content = ReviewCommentContent.objects.filter(
            review_comment=comment,
            content_type='TEXT',
        ).order_by('sort_order', 'created_at').first()
        return content.text_content if content else None

    def get_revision_count(self, comment):
        bulk = getattr(comment, '_bulk', None)
        if bulk is not None:
            return bulk.revision_counts[comment.id]
        return ReviewCommentRevision.objects.filter(review_comment=comment).count()

    def get_mentions(self, comment):
        bulk = getattr(comment, '_bulk', None)
        mentions = bulk.mentions[comment.id] if bulk is not None else ReviewCommentMention.objects.filter(
            review_comment=comment
        ).select_related('user').order_by('created_at')
        return [
            {
                'id': str(mention.user.id),
                'email': mention.user.email,
                'name': mention.user.get_full_name(),
            }
            for mention in mentions
        ]

    def get_attachments(self, comment):
        bulk = getattr(comment, '_bulk', None)
        if bulk is not None:
            contents = [c for c in bulk.contents[comment.id] if c.file_id and c.deleted_at is None]
        else:
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
                    'status': content.file.status,
                    'previews': [
                        {'id': str(variant.id), 'mime_type': variant.mime_type, 'status': variant.status}
                        for variant in (
                            bulk.variants[content.file_id] if bulk is not None
                            else FileVariant.objects.filter(file=content.file, deleted_at__isnull=True)
                        )
                    ],
                },
            }
            for content in contents
        ]

    def get_reactions(self, comment):
        bulk = getattr(comment, '_bulk', None)
        reactions = bulk.reactions[comment.id] if bulk is not None else ReviewCommentReaction.objects.filter(
            review_comment=comment
        ).select_related('reacted_by_user', 'reacted_by_guest_session').order_by('created_at', 'id')
        grouped = {}
        for reaction in reactions:
            group = grouped.setdefault(
                reaction.emoji,
                {'emoji': reaction.emoji, 'count': 0, 'reactors': []},
            )
            group['count'] += 1
            if reaction.reacted_by_user:
                actor = reaction.reacted_by_user
                group['reactors'].append({
                    'id': str(actor.id), 'name': actor.get_full_name(), 'type': 'user',
                })
            else:
                actor = reaction.reacted_by_guest_session
                group['reactors'].append({
                    'id': str(actor.id), 'name': actor.name, 'type': 'guest',
                })
        return list(grouped.values())


class ReviewCommentRevisionSerializer(serializers.ModelSerializer):
    edited_by_user_id = serializers.UUIDField(allow_null=True)
    edited_by_guest_session_id = serializers.UUIDField(allow_null=True)

    class Meta:
        model = ReviewCommentRevision
        fields = ('id', 'edited_by_user_id', 'edited_by_guest_session_id', 'snapshot', 'created_at')
