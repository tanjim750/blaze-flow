import uuid

from django.db import transaction
from django.utils import timezone

from app.models import (
    MediaVersionStageEntry,
    ReviewComment,
    ReviewCommentContent,
    ReviewCommentContentType,
    ReviewCommentMention,
    ReviewCommentRevision,
    WorkflowStage,
    WorkflowStageStatusState,
)

from .audit import record_guest_audit, record_user_audit
from .notifications import NotificationError, resolve_mention_users, set_comment_mentions
from .workflow import transition_media_version


class ReviewCommentError(Exception):
    pass


def _comment_snapshot(comment):
    contents = ReviewCommentContent.objects.filter(review_comment=comment).order_by(
        'sort_order', 'created_at'
    )
    return {
        'start_time_ms': comment.start_time_ms,
        'end_time_ms': comment.end_time_ms,
        'resolved': comment.resolved,
        'mentioned_user_ids': [
            str(user_id)
            for user_id in ReviewCommentMention.objects.filter(
                review_comment=comment
            ).order_by('created_at').values_list('user_id', flat=True)
        ],
        'contents': [
            {
                'content_type': content.content_type,
                'text_content': content.text_content,
                'file_id': str(content.file_id) if content.file_id else None,
                'sort_order': content.sort_order,
            }
            for content in contents
        ],
    }


@transaction.atomic
def create_review_comment(
    *, media_version, user, text, parent_comment=None, start_time_ms=None, end_time_ms=None,
    mentioned_user_ids=()
):
    if not text.strip():
        raise ReviewCommentError('Comment text cannot be empty.')
    if parent_comment is not None:
        if parent_comment.media_version_id != media_version.id or parent_comment.deleted_at is not None:
            raise ReviewCommentError('Select an active parent comment from this media version.')
        if start_time_ms is not None or end_time_ms is not None:
            raise ReviewCommentError('Replies inherit timing from their parent comment.')
    if end_time_ms is not None and start_time_ms is None:
        raise ReviewCommentError('end_time_ms requires start_time_ms.')
    if start_time_ms is not None and end_time_ms is not None and end_time_ms < start_time_ms:
        raise ReviewCommentError('end_time_ms must be greater than or equal to start_time_ms.')
    try:
        mentioned_users = resolve_mention_users(
            project=media_version.project,
            actor=user,
            user_ids=mentioned_user_ids,
        )
    except NotificationError as exc:
        raise ReviewCommentError(str(exc)) from exc

    now = timezone.now()
    comment = ReviewComment(
        id=uuid.uuid4(),
        media_version=media_version,
        parent_comment=parent_comment,
        author_user=user,
        start_time_ms=start_time_ms,
        end_time_ms=end_time_ms,
        created_at=now,
        updated_at=now,
    )
    comment.full_clean()
    comment.save()
    ReviewCommentContent.objects.create(
        id=uuid.uuid4(),
        review_comment=comment,
        content_type=ReviewCommentContentType.TEXT,
        text_content=text.strip(),
        sort_order=0,
        created_at=now,
        updated_at=now,
    )
    set_comment_mentions(
        comment=comment,
        actor=user,
        users=mentioned_users,
        excerpt=text.strip(),
    )
    record_user_audit(
        user=user,
        workspace=media_version.project.workspace,
        action='review.comment.created',
        entity_type='review_comment',
        entity_id=comment.id,
        metadata={
            'media_version_id': str(media_version.id),
            'parent_comment_id': str(parent_comment.id) if parent_comment else None,
            'mentioned_user_count': len(mentioned_users),
        },
    )
    return comment


@transaction.atomic
def create_guest_review_comment(
    *, media_version, guest_session, text, parent_comment=None,
    start_time_ms=None, end_time_ms=None,
):
    if not text.strip():
        raise ReviewCommentError('Comment text cannot be empty.')
    if parent_comment is not None:
        if parent_comment.media_version_id != media_version.id or parent_comment.deleted_at is not None:
            raise ReviewCommentError('Select an active parent comment from this media version.')
        if start_time_ms is not None or end_time_ms is not None:
            raise ReviewCommentError('Replies inherit timing from their parent comment.')
    if end_time_ms is not None and start_time_ms is None:
        raise ReviewCommentError('end_time_ms requires start_time_ms.')
    if start_time_ms is not None and end_time_ms is not None and end_time_ms < start_time_ms:
        raise ReviewCommentError('end_time_ms must be greater than or equal to start_time_ms.')
    now = timezone.now()
    comment = ReviewComment(
        id=uuid.uuid4(), media_version=media_version, parent_comment=parent_comment,
        author_guest_session=guest_session, start_time_ms=start_time_ms,
        end_time_ms=end_time_ms, created_at=now, updated_at=now,
    )
    comment.full_clean()
    comment.save()
    ReviewCommentContent.objects.create(
        id=uuid.uuid4(), review_comment=comment,
        content_type=ReviewCommentContentType.TEXT, text_content=text.strip(),
        sort_order=0, created_at=now, updated_at=now,
    )
    record_guest_audit(
        guest_session=guest_session, workspace=media_version.project.workspace,
        action='review.comment.created', entity_type='review_comment', entity_id=comment.id,
        metadata={'media_version_id': str(media_version.id)},
    )
    return comment


@transaction.atomic
def edit_review_comment(*, comment, user, text, mentioned_user_ids=None):
    locked = ReviewComment.objects.select_for_update().get(id=comment.id)
    if locked.deleted_at is not None:
        raise ReviewCommentError('Deleted comments cannot be edited.')
    if locked.author_user_id != user.id:
        raise ReviewCommentError('Only the original author can edit this comment.')
    normalized_text = text.strip()
    if not normalized_text:
        raise ReviewCommentError('Comment text cannot be empty.')
    content = ReviewCommentContent.objects.select_for_update().filter(
        review_comment=locked,
        content_type=ReviewCommentContentType.TEXT,
    ).order_by('sort_order', 'created_at').first()
    if content is None:
        raise ReviewCommentError('This comment has no editable text content.')
    mentioned_users = None
    desired_mention_ids = None
    if mentioned_user_ids is not None:
        try:
            mentioned_users = resolve_mention_users(
                project=locked.media_version.project,
                actor=user,
                user_ids=mentioned_user_ids,
            )
        except NotificationError as exc:
            raise ReviewCommentError(str(exc)) from exc
        desired_mention_ids = {mentioned_user.id for mentioned_user in mentioned_users}
    existing_mention_ids = set(
        ReviewCommentMention.objects.filter(review_comment=locked).values_list(
            'user_id', flat=True
        )
    )
    text_changed = content.text_content != normalized_text
    mentions_changed = (
        desired_mention_ids is not None and desired_mention_ids != existing_mention_ids
    )
    if not text_changed and not mentions_changed:
        raise ReviewCommentError('The comment text and mentions have not changed.')

    now = timezone.now()
    revision = ReviewCommentRevision.objects.create(
        id=uuid.uuid4(),
        review_comment=locked,
        edited_by_user=user,
        snapshot=_comment_snapshot(locked),
        created_at=now,
    )
    if text_changed:
        content.text_content = normalized_text
        content.updated_at = now
        content.save(update_fields=['text_content', 'updated_at'])
    if mentioned_users is not None:
        set_comment_mentions(
            comment=locked,
            actor=user,
            users=mentioned_users,
            excerpt=normalized_text,
        )
    locked.updated_at = now
    locked.save(update_fields=['updated_at'])
    record_user_audit(
        user=user,
        workspace=locked.media_version.project.workspace,
        action='review.comment.edited',
        entity_type='review_comment',
        entity_id=locked.id,
        metadata={
            'revision_id': str(revision.id),
            'mentioned_user_count': len(desired_mention_ids or existing_mention_ids),
        },
    )
    return locked


@transaction.atomic
def set_review_comment_resolution(*, comment, user, resolved):
    locked = ReviewComment.objects.select_for_update().get(id=comment.id)
    if locked.deleted_at is not None:
        raise ReviewCommentError('Deleted comments cannot be resolved or reopened.')
    if locked.parent_comment_id is not None:
        raise ReviewCommentError('Resolve or reopen the top-level thread instead of a reply.')
    if locked.resolved == resolved:
        state = 'resolved' if resolved else 'open'
        raise ReviewCommentError(f'This comment thread is already {state}.')
    now = timezone.now()
    locked.resolved = resolved
    locked.resolved_by_user = user if resolved else None
    locked.resolved_at = now if resolved else None
    locked.updated_at = now
    locked.save(update_fields=['resolved', 'resolved_by_user', 'resolved_at', 'updated_at'])
    record_user_audit(
        user=user,
        workspace=locked.media_version.project.workspace,
        action='review.comment.resolved' if resolved else 'review.comment.reopened',
        entity_type='review_comment',
        entity_id=locked.id,
    )
    return locked


@transaction.atomic
def delete_review_comment_tree(*, comment, user):
    root = ReviewComment.objects.select_for_update().get(id=comment.id)
    if root.deleted_at is not None:
        raise ReviewCommentError('This comment is already deleted.')
    comment_ids = {root.id}
    frontier = {root.id}
    while frontier:
        children = set(
            ReviewComment.objects.filter(
                parent_comment_id__in=frontier,
                deleted_at__isnull=True,
            ).values_list('id', flat=True)
        ) - comment_ids
        comment_ids.update(children)
        frontier = children
    list(ReviewComment.objects.select_for_update().filter(id__in=comment_ids))
    now = timezone.now()
    ReviewComment.objects.filter(id__in=comment_ids).update(
        deleted_at=now,
        deleted_by_user=user,
        updated_at=now,
    )
    record_user_audit(
        user=user,
        workspace=root.media_version.project.workspace,
        action='review.comment.deleted',
        entity_type='review_comment',
        entity_id=root.id,
        metadata={'deleted_comment_count': len(comment_ids)},
    )
    return len(comment_ids)


@transaction.atomic
def request_media_revision(
    *, media_version, user, text, start_time_ms=None, end_time_ms=None,
    mentioned_user_ids=()
):
    stage = WorkflowStage.objects.filter(
        workspace=media_version.project.workspace,
        slug='revision',
        status=WorkflowStageStatusState.ACTIVE,
    ).first()
    if stage is None:
        raise ReviewCommentError('This workspace has no active Revision stage.')
    comment = create_review_comment(
        media_version=media_version,
        user=user,
        text=text,
        start_time_ms=start_time_ms,
        end_time_ms=end_time_ms,
        mentioned_user_ids=mentioned_user_ids,
    )
    current = MediaVersionStageEntry.objects.filter(
        media_version=media_version,
        exited_at__isnull=True,
    ).first()
    transitioned = current is None or current.workflow_stage_id != stage.id
    entry = (
        transition_media_version(
            media_version=media_version,
            stage=stage,
            stage_status=None,
            user=user,
        )
        if transitioned
        else current
    )
    record_user_audit(
        user=user,
        workspace=media_version.project.workspace,
        action='media.revision.requested',
        entity_type='media_version',
        entity_id=media_version.id,
        metadata={'review_comment_id': str(comment.id), 'workflow_transitioned': transitioned},
    )
    return comment, entry, transitioned
