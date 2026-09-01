import uuid

from django.db import transaction
from django.utils import timezone

from app.models import Annotation, AnnotationElement, AnnotationRevision
from .audit import record_guest_audit, record_user_audit


class AnnotationError(Exception):
    pass


def annotation_snapshot(annotation):
    return {
        'review_comment_id': str(annotation.review_comment_id) if annotation.review_comment_id else None,
        'start_time_ms': annotation.start_time_ms,
        'end_time_ms': annotation.end_time_ms,
        'elements': list(AnnotationElement.objects.filter(annotation=annotation).order_by('sort_order').values('element_type', 'sort_order', 'geometry', 'style', 'payload')),
    }


def _create_elements(annotation, elements, now):
    AnnotationElement.objects.bulk_create([
        AnnotationElement(
            id=uuid.uuid4(), annotation=annotation, element_type=item['element_type'],
            sort_order=index, geometry=item['geometry'], style=item.get('style', {}),
            payload=item.get('payload', {}), created_at=now, updated_at=now,
        ) for index, item in enumerate(elements)
    ])


@transaction.atomic
def create_annotation(*, media_version, user, elements, review_comment=None, start_time_ms=None, end_time_ms=None):
    if review_comment and review_comment.media_version_id != media_version.id:
        raise AnnotationError('The linked comment must belong to this media version.')
    now = timezone.now()
    annotation = Annotation(
        id=uuid.uuid4(), media_version=media_version, review_comment=review_comment,
        author_user=user, start_time_ms=start_time_ms, end_time_ms=end_time_ms,
        created_at=now, updated_at=now,
    )
    annotation.full_clean()
    annotation.save()
    _create_elements(annotation, elements, now)
    record_user_audit(user=user, workspace=media_version.project.workspace, action='annotation.created', entity_type='annotation', entity_id=annotation.id, metadata={'element_count': len(elements)})
    return annotation


@transaction.atomic
def create_guest_annotation(*, media_version, guest_session, elements, review_comment=None, start_time_ms=None, end_time_ms=None):
    if review_comment and review_comment.media_version_id != media_version.id:
        raise AnnotationError('The linked comment must belong to this media version.')
    now = timezone.now()
    annotation = Annotation(
        id=uuid.uuid4(), media_version=media_version, review_comment=review_comment,
        author_guest_session=guest_session, start_time_ms=start_time_ms,
        end_time_ms=end_time_ms, created_at=now, updated_at=now,
    )
    annotation.full_clean()
    annotation.save()
    _create_elements(annotation, elements, now)
    record_guest_audit(
        guest_session=guest_session, workspace=media_version.project.workspace,
        action='annotation.created', entity_type='annotation', entity_id=annotation.id,
        metadata={'element_count': len(elements)},
    )
    return annotation


@transaction.atomic
def update_annotation(*, annotation, user, elements, review_comment=None, start_time_ms=None, end_time_ms=None):
    locked = Annotation.objects.select_for_update().select_related('media_version__project__workspace').get(id=annotation.id)
    if locked.deleted_at:
        raise AnnotationError('Deleted annotations cannot be edited.')
    if locked.author_user_id != user.id:
        raise AnnotationError('Only the original author can edit this annotation.')
    if review_comment and review_comment.media_version_id != locked.media_version_id:
        raise AnnotationError('The linked comment must belong to this media version.')
    now = timezone.now()
    revision = AnnotationRevision.objects.create(id=uuid.uuid4(), annotation=locked, edited_by_user=user, snapshot=annotation_snapshot(locked), created_at=now)
    locked.review_comment = review_comment
    locked.start_time_ms = start_time_ms
    locked.end_time_ms = end_time_ms
    locked.updated_at = now
    locked.save(update_fields=['review_comment', 'start_time_ms', 'end_time_ms', 'updated_at'])
    AnnotationElement.objects.filter(annotation=locked).delete()
    _create_elements(locked, elements, now)
    record_user_audit(user=user, workspace=locked.media_version.project.workspace, action='annotation.edited', entity_type='annotation', entity_id=locked.id, metadata={'revision_id': str(revision.id)})
    return locked


@transaction.atomic
def update_guest_annotation(*, annotation, guest_session, elements, review_comment=None, start_time_ms=None, end_time_ms=None):
    locked = Annotation.objects.select_for_update().select_related('media_version__project__workspace').get(id=annotation.id)
    if locked.deleted_at:
        raise AnnotationError('Deleted annotations cannot be edited.')
    if locked.author_guest_session_id != guest_session.id:
        raise AnnotationError('Guests can edit only their own annotations.')
    if review_comment and review_comment.media_version_id != locked.media_version_id:
        raise AnnotationError('The linked comment must belong to this media version.')
    now = timezone.now()
    revision = AnnotationRevision.objects.create(
        id=uuid.uuid4(), annotation=locked,
        edited_by_guest_session=guest_session,
        snapshot=annotation_snapshot(locked), created_at=now,
    )
    locked.review_comment = review_comment
    locked.start_time_ms = start_time_ms
    locked.end_time_ms = end_time_ms
    locked.updated_at = now
    locked.save(update_fields=['review_comment', 'start_time_ms', 'end_time_ms', 'updated_at'])
    AnnotationElement.objects.filter(annotation=locked).delete()
    _create_elements(locked, elements, now)
    record_guest_audit(
        guest_session=guest_session, workspace=locked.media_version.project.workspace,
        action='annotation.edited', entity_type='annotation', entity_id=locked.id,
        metadata={'revision_id': str(revision.id)},
    )
    return locked


@transaction.atomic
def delete_guest_annotation(*, annotation, guest_session):
    locked = Annotation.objects.select_for_update().select_related('media_version__project__workspace').get(id=annotation.id)
    if locked.deleted_at:
        raise AnnotationError('This annotation is already deleted.')
    if locked.author_guest_session_id != guest_session.id:
        raise AnnotationError('Guests can delete only their own annotations.')
    now = timezone.now()
    locked.deleted_at = now
    locked.deleted_by_guest_session = guest_session
    locked.updated_at = now
    locked.save(update_fields=['deleted_at', 'deleted_by_guest_session', 'updated_at'])
    record_guest_audit(
        guest_session=guest_session, workspace=locked.media_version.project.workspace,
        action='annotation.deleted', entity_type='annotation', entity_id=locked.id,
    )
    return locked


@transaction.atomic
def delete_annotation(*, annotation, user):
    locked = Annotation.objects.select_for_update().select_related('media_version__project__workspace').get(id=annotation.id)
    if locked.deleted_at:
        raise AnnotationError('This annotation is already deleted.')
    now = timezone.now()
    locked.deleted_at = now
    locked.deleted_by_user = user
    locked.updated_at = now
    locked.save(update_fields=['deleted_at', 'deleted_by_user', 'updated_at'])
    record_user_audit(user=user, workspace=locked.media_version.project.workspace, action='annotation.deleted', entity_type='annotation', entity_id=locked.id)
    return locked
