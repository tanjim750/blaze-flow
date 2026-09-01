import uuid

from django.db import transaction
from django.utils import timezone

from app.models import ReviewComment, ReviewCommentReaction

from .audit import record_guest_audit, record_user_audit


class ReviewReactionError(Exception):
    pass


def _active_comment(comment):
    locked = ReviewComment.objects.select_for_update().select_related(
        'media_version__project__workspace'
    ).get(id=comment.id)
    if locked.deleted_at is not None:
        raise ReviewReactionError('Deleted comments cannot be reacted to.')
    return locked


@transaction.atomic
def add_user_reaction(*, comment, user, emoji):
    locked = _active_comment(comment)
    reaction, created = ReviewCommentReaction.objects.get_or_create(
        review_comment=locked,
        emoji=emoji,
        reacted_by_user=user,
        defaults={'id': uuid.uuid4(), 'created_at': timezone.now()},
    )
    if created:
        record_user_audit(
            user=user,
            workspace=locked.media_version.project.workspace,
            action='review.reaction.created',
            entity_type='review_comment_reaction',
            entity_id=reaction.id,
            metadata={'review_comment_id': str(locked.id), 'emoji': emoji},
        )
    return reaction, created


@transaction.atomic
def remove_user_reaction(*, comment, user, emoji):
    locked = _active_comment(comment)
    reaction = ReviewCommentReaction.objects.filter(
        review_comment=locked, emoji=emoji, reacted_by_user=user
    ).first()
    if reaction is None:
        return False
    reaction_id = reaction.id
    reaction.delete()
    record_user_audit(
        user=user,
        workspace=locked.media_version.project.workspace,
        action='review.reaction.deleted',
        entity_type='review_comment_reaction',
        entity_id=reaction_id,
        metadata={'review_comment_id': str(locked.id), 'emoji': emoji},
    )
    return True


@transaction.atomic
def add_guest_reaction(*, comment, guest_session, emoji):
    locked = _active_comment(comment)
    reaction, created = ReviewCommentReaction.objects.get_or_create(
        review_comment=locked,
        emoji=emoji,
        reacted_by_guest_session=guest_session,
        defaults={'id': uuid.uuid4(), 'created_at': timezone.now()},
    )
    if created:
        record_guest_audit(
            guest_session=guest_session,
            workspace=locked.media_version.project.workspace,
            action='review.reaction.created',
            entity_type='review_comment_reaction',
            entity_id=reaction.id,
            metadata={'review_comment_id': str(locked.id), 'emoji': emoji},
        )
    return reaction, created


@transaction.atomic
def remove_guest_reaction(*, comment, guest_session, emoji):
    locked = _active_comment(comment)
    reaction = ReviewCommentReaction.objects.filter(
        review_comment=locked, emoji=emoji, reacted_by_guest_session=guest_session
    ).first()
    if reaction is None:
        return False
    reaction_id = reaction.id
    reaction.delete()
    record_guest_audit(
        guest_session=guest_session,
        workspace=locked.media_version.project.workspace,
        action='review.reaction.deleted',
        entity_type='review_comment_reaction',
        entity_id=reaction_id,
        metadata={'review_comment_id': str(locked.id), 'emoji': emoji},
    )
    return True
