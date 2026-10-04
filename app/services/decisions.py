"""Client decisions on one exact cut: Approve or Request changes.

A decision is made by a guest through a review link that allows decisions, or by a
client-team member signed in to the workspace whose role allows them. Either way it:

* is pinned to the media version on screen (a newer version starts undecided);
* moves the cut through the workspace's own workflow, exactly like the team's Approve and
  Request changes buttons (``transition_media_version``), unless it is already there;
* for Request changes, posts the message as a client-visible note on that version;
* is stored as a ``ReviewDecision`` (who, what, when, and how many client-visible notes
  were still open), audited, and announced to the cut's uploader and assignees.
"""
import uuid

from django.db import transaction
from django.utils import timezone

from app.models import (
    AuditLog, MediaVersion, MediaVersionStageEntry, MediaVersionStatus, NotificationKind, ReviewComment,
    ReviewDecision, ReviewDecisionKind, User, WorkflowStage, WorkflowStageStatusState,
)
from app.permissions import MEDIA_READ, has_project_permission

from .audit import record_guest_audit, record_user_audit
from .comments import client_visible_comments, create_guest_review_comment, create_review_comment
from .notifications import _media_payload, _notify, _snippet, cut_follower_ids, review_link, stage_outcome
from .workflow import transition_media_version

MESSAGE_MAX_LENGTH = 2000
DECISION_OUTCOME = {
    ReviewDecisionKind.APPROVED: NotificationKind.MEDIA_APPROVED,
    ReviewDecisionKind.CHANGES_REQUESTED: NotificationKind.MEDIA_CHANGES_REQUESTED,
}


class ReviewDecisionError(Exception):
    """A decision that cannot be made. ``status`` is the HTTP status the view should use."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def decision_stage(*, workspace, decision):
    """The active stage a decision moves the cut into, by the same rule notifications use."""
    wanted = DECISION_OUTCOME[decision]
    stages = WorkflowStage.objects.filter(
        workspace=workspace, status=WorkflowStageStatusState.ACTIVE,
    ).order_by('sort_order', 'name')
    # Prefer the canonical slugs, then any stage the outcome rule recognises by name.
    preferred = 'approved' if decision == ReviewDecisionKind.APPROVED else 'revision'
    for stage in stages:
        if stage.slug == preferred:
            return stage
    return next((stage for stage in stages if stage_outcome(stage) == wanted), None)


def open_client_notes(media_version):
    """Unresolved top-level notes a client can see on this cut (team-only notes never count)."""
    return client_visible_comments(ReviewComment.objects.filter(
        media_version=media_version, parent_comment__isnull=True,
        deleted_at__isnull=True, resolved=False,
    )).count()


def latest_decision(media_version):
    return ReviewDecision.objects.filter(media_version=media_version).order_by('-created_at').first()


def decisions_for(media_versions):
    """``{media_version_id: latest ReviewDecision}`` for several cuts in one query."""
    latest = {}
    for item in ReviewDecision.objects.filter(media_version__in=media_versions).order_by('created_at'):
        latest[str(item.media_version_id)] = item
    return latest


def _day(value):
    return f'{value.day} {value.strftime("%b")}'


@transaction.atomic
def record_decision(*, media_version, decision, message=None, start_time_ms=None, guest_access=None, user=None):
    """Makes and records one decision. Exactly one of ``guest_access`` / ``user`` decides."""
    if (guest_access is None) == (user is None):
        raise ReviewDecisionError('A decision needs exactly one reviewer.')
    if decision not in DECISION_OUTCOME:
        raise ReviewDecisionError('Choose approved or changes_requested.')
    media = MediaVersion.objects.select_for_update().select_related('project__workspace').get(id=media_version.id)
    if media.status != MediaVersionStatus.ACTIVE:
        raise ReviewDecisionError('This version is no longer available for review.', status=404)
    project = media.project
    workspace = project.workspace
    message = (message or '').strip()
    if len(message) > MESSAGE_MAX_LENGTH:
        raise ReviewDecisionError(f'Keep the message under {MESSAGE_MAX_LENGTH} characters.')
    if decision == ReviewDecisionKind.CHANGES_REQUESTED and not message:
        raise ReviewDecisionError('Tell the team what to change.')

    previous = latest_decision(media)
    if decision == ReviewDecisionKind.APPROVED and previous and previous.decision == ReviewDecisionKind.APPROVED:
        raise ReviewDecisionError(
            f'V{media.version_number} was already approved by {previous.reviewer_name} on {_day(previous.created_at)}.',
            status=409,
        )
    stage = decision_stage(workspace=workspace, decision=decision)
    if stage is None:
        label = 'Approved' if decision == ReviewDecisionKind.APPROVED else 'Revision'
        raise ReviewDecisionError(f'This workspace has no active {label} stage, so the decision cannot be recorded.', status=409)

    guest_session = guest_access.guest_session if guest_access else None
    if guest_session is not None:
        reviewer_name, reviewer_email = guest_session.name or 'Guest reviewer', guest_session.email
    else:
        reviewer_name, reviewer_email = user.get_full_name() or user.email, user.email
    open_count = open_client_notes(media)
    now = timezone.now()

    comment = None
    if decision == ReviewDecisionKind.CHANGES_REQUESTED:
        # Always client-visible: the client wrote it, so the client must be able to read it.
        if guest_session is not None:
            comment = create_guest_review_comment(
                media_version=media, guest_session=guest_session, text=message,
                start_time_ms=start_time_ms, notify_followers=False,
            )
        else:
            comment = create_review_comment(
                media_version=media, user=user, text=message, start_time_ms=start_time_ms,
                notify_followers=False,
            )

    record = ReviewDecision.objects.create(
        id=uuid.uuid4(), project=project, media_version=media, decision=decision,
        guest_session=guest_session,
        guest_review_access=guest_access,
        guest_invite_id=guest_access.guest_invite_id if guest_access else None,
        decided_by_user=user, reviewer_name=reviewer_name, reviewer_email=reviewer_email,
        open_notes_count=open_count, message=message or None, review_comment=comment,
        created_at=now,
    )

    if comment is not None:
        # The note is part of the decision: the feed shows one "requested changes" row with
        # the message, not a second "commented on" row (see services/activity.py).
        for row in AuditLog.objects.filter(action='review.comment.created', entity_id=str(comment.id)):
            row.metadata = {**(row.metadata or {}), 'review_decision_id': str(record.id)}
            row.save(update_fields=['metadata'])

    current = MediaVersionStageEntry.objects.filter(media_version=media, exited_at__isnull=True).first()
    transitioned = current is None or current.workflow_stage_id != stage.id
    if transitioned and current is not None:
        entry = transition_media_version(
            media_version=media, stage=stage, stage_status=None, user=user,
            guest_session=guest_session, comment=comment, notify=False,
            audit_metadata={'review_decision_id': str(record.id)},
        )
        record.stage_entry = entry
        record.save(update_fields=['stage_entry'])
    else:
        transitioned = False

    invite = guest_access.guest_invite if guest_access else None
    metadata = {
        'review_decision_id': str(record.id), 'decision': decision,
        'media_version_id': str(media.id), 'version_number': media.version_number, 'title': media.title,
        'reviewer_name': reviewer_name, 'open_notes_count': open_count,
        'review_comment_id': str(comment.id) if comment else None,
        'workflow_transitioned': transitioned, 'stage': {'name': stage.name, 'slug': stage.slug},
        'guest_invite_id': str(invite.id) if invite else None, 'label': invite.label if invite else None,
    }
    audit = dict(
        workspace=workspace, action=f'review.decision.{decision}', entity_type='media_version',
        entity_id=media.id, project=project, team_only=False, at=now, metadata=metadata,
    )
    if guest_session is not None:
        record_guest_audit(guest_session=guest_session, **audit)
    else:
        record_user_audit(user=user, **audit)
    notify_decision(record=record, media_version=media, stage=stage, actor=user, comment=comment)
    return record, transitioned


def notify_decision(*, record, media_version, stage, actor=None, comment=None):
    """Tells the cut's uploader and assignees, once per decision, whether or not the cut moved."""
    kind = DECISION_OUTCOME[record.decision]
    project = media_version.project
    recipients = cut_follower_ids(media_version)
    if actor is not None:
        recipients.discard(actor.id)
    time_ms = comment.start_time_ms if comment is not None else None
    payload = {
        **_media_payload(media_version),
        'stage_name': stage.name,
        'client_decision': True,
        'review_decision_id': str(record.id),
        'reviewer_name': record.reviewer_name,
        'open_notes_count': record.open_notes_count,
        'review_comment_id': str(comment.id) if comment is not None else None,
        'start_time_ms': time_ms,
        'excerpt': _snippet(record.message or ''),
        'link': review_link(media_version=media_version, comment=comment, time_ms=time_ms),
    }
    created = []
    for recipient in User.objects.filter(id__in=recipients):
        if not has_project_permission(user=recipient, project=project, permission_key=MEDIA_READ):
            continue
        note = _notify(
            recipient=recipient, workspace=project.workspace, actor=actor,
            actor_name=None if actor is not None else record.reviewer_name,
            kind=kind, entity_type='review_decision', entity_id=record.id, payload=payload,
        )
        if note:
            created.append(note)
    return created


def decision_data(record, *, for_guest_session_id=None, include_private=True):
    """One decision for the API. Guests never see another reviewer's email or the link label."""
    data = {
        'id': str(record.id),
        'media_version_id': str(record.media_version_id),
        'version_number': record.media_version.version_number,
        'decision': record.decision,
        'reviewer': {
            'name': record.reviewer_name,
            'type': 'guest' if record.guest_session_id else 'client_member',
        },
        'open_notes_count': record.open_notes_count,
        'message': record.message,
        'review_comment_id': str(record.review_comment_id) if record.review_comment_id else None,
        'workflow_transitioned': record.stage_entry_id is not None,
        'created_at': record.created_at,
    }
    if for_guest_session_id is not None:
        data['mine'] = str(record.guest_session_id) == str(for_guest_session_id)
    if include_private:
        data['reviewer']['email'] = record.reviewer_email
        data['guest_invite_id'] = str(record.guest_invite_id) if record.guest_invite_id else None
        data['link_label'] = record.guest_invite.label if record.guest_invite_id else None
    return data
