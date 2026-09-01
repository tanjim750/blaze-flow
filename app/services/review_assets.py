import uuid
from pathlib import Path

from django.conf import settings
from django.core.files.storage import default_storage
from django.db import transaction
from django.utils import timezone

from app.models import File, FileSecurityScan, FileStatus, FileVariant, ReviewCommentContent, ReviewCommentContentType

from .audit import record_guest_audit, record_user_audit
from .media import _storage_backend, detect_media_type, sha256_upload
from .file_processing import SCAN_TOPIC, enqueue_file_event


class ReviewAttachmentError(Exception):
    pass


def detect_attachment_type(header):
    media_type = detect_media_type(header)
    if media_type and media_type.startswith('image/'):
        return media_type
    if header.startswith(b'%PDF-'):
        return 'application/pdf'
    if header.startswith(b'RIFF') and header[8:12] == b'WAVE':
        return 'audio/wav'
    if header.startswith(b'ID3') or (len(header) >= 2 and header[0] == 0xFF and header[1] & 0xE0 == 0xE0):
        return 'audio/mpeg'
    return None


def validate_attachment(upload):
    if upload.size <= 0:
        raise ReviewAttachmentError('The attachment is empty.')
    if upload.size > settings.MAX_REVIEW_ATTACHMENT_BYTES:
        raise ReviewAttachmentError('The attachment exceeds the configured size limit.')
    header = upload.read(32)
    upload.seek(0)
    detected = detect_attachment_type(header)
    declared = (getattr(upload, 'content_type', '') or '').lower()
    aliases = {'image/jpg': 'image/jpeg', 'audio/x-wav': 'audio/wav'}
    if detected is None or aliases.get(declared, declared) != detected:
        raise ReviewAttachmentError('The attachment signature does not match a supported type.')
    return detected


def upload_review_attachment(*, comment, upload, user=None, guest_session=None):
    if (user is None) == (guest_session is None):
        raise ReviewAttachmentError('Exactly one attachment actor is required.')
    mime_type = validate_attachment(upload)
    checksum = sha256_upload(upload)
    clean_name = Path(upload.name).name or 'attachment'
    project = comment.media_version.project
    object_key = (
        f'workspaces/{project.workspace_id}/projects/{project.id}/comments/'
        f'{comment.id}/{uuid.uuid4()}/{clean_name}'
    )
    stored_key = default_storage.save(object_key, upload)
    now = timezone.now()
    try:
        with transaction.atomic():
            file_record = File.objects.create(
                id=uuid.uuid4(), storage_backend=_storage_backend(now), object_key=stored_key,
                original_name=clean_name, mime_type=mime_type, size_bytes=upload.size,
                checksum=checksum, checksum_algorithm='sha256', metadata={},
                status=FileStatus.PENDING, created_at=now, updated_at=now,
            )
            FileSecurityScan.objects.create(
                file=file_record, engine=settings.FILE_SECURITY_SCANNER,
            )
            content_type = ReviewCommentContentType.IMAGE if mime_type.startswith('image/') else (
                ReviewCommentContentType.AUDIO if mime_type.startswith('audio/') else ReviewCommentContentType.FILE
            )
            content = ReviewCommentContent.objects.create(
                id=uuid.uuid4(), review_comment=comment, content_type=content_type,
                file=file_record, sort_order=ReviewCommentContent.objects.filter(
                    review_comment=comment, deleted_at__isnull=True
                ).count(), created_at=now, updated_at=now,
            )
            audit = record_user_audit if user is not None else record_guest_audit
            audit(
                **({'user': user} if user is not None else {'guest_session': guest_session}),
                workspace=project.workspace, action='review.attachment.uploaded',
                entity_type='review_comment_content', entity_id=content.id,
                metadata={'comment_id': str(comment.id), 'file_id': str(file_record.id), 'checksum_sha256': checksum},
            )
            enqueue_file_event(file=file_record, topic=SCAN_TOPIC)
            return content
    except Exception:
        default_storage.delete(stored_key)
        raise


@transaction.atomic
def delete_review_attachment(*, content, user):
    locked = ReviewCommentContent.objects.select_for_update().select_related(
        'file', 'review_comment__media_version__project__workspace'
    ).get(id=content.id)
    if locked.deleted_at is not None:
        raise ReviewAttachmentError('This attachment is already deleted.')
    now = timezone.now()
    locked.deleted_at = now
    locked.deleted_by_user = user
    locked.updated_at = now
    locked.save(update_fields=['deleted_at', 'deleted_by_user', 'updated_at'])
    locked.file.deleted_at = now
    locked.file.updated_at = now
    locked.file.save(update_fields=['deleted_at', 'updated_at'])
    FileVariant.objects.filter(file=locked.file, deleted_at__isnull=True).update(
        deleted_at=now, updated_at=now,
    )
    record_user_audit(
        user=user, workspace=locked.review_comment.media_version.project.workspace,
        action='review.attachment.deleted', entity_type='review_comment_content', entity_id=locked.id,
    )
    return locked
