from rest_framework import serializers

from app.models import FileVariant, ReviewCommentContent


class ReviewAttachmentUploadSerializer(serializers.Serializer):
    file = serializers.FileField()


class ReviewAttachmentSerializer(serializers.ModelSerializer):
    file = serializers.SerializerMethodField()

    class Meta:
        model = ReviewCommentContent
        fields = ('id', 'content_type', 'sort_order', 'file', 'created_at')

    def get_file(self, content):
        item = content.file
        return {
            'id': str(item.id), 'name': item.original_name, 'mime_type': item.mime_type,
            'size_bytes': item.size_bytes, 'checksum_sha256': item.checksum, 'status': item.status,
            'previews': [
                {'id': str(variant.id), 'mime_type': variant.mime_type, 'status': variant.status}
                for variant in FileVariant.objects.filter(file=item, deleted_at__isnull=True)
            ],
        }
