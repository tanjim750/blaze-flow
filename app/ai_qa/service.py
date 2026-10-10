"""What the API calls: start/retry a run, record a reviewer's decision, add a comment."""
import hashlib
import json
import uuid
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from app.models import (
    AI_REVIEW_ACTIVE_STATUSES, AIFinding, AIFindingCategory, AIFindingStatus, AIReview,
    AIReviewStatus, GlossaryTerm, OutboxEvent, OutboxEventStatus, ReviewCommentSource,
    ReviewCommentVisibility,
)
from app.services.annotations import create_annotation
from app.services.audit import record_user_audit
from app.services.comments import create_review_comment

from . import PIPELINE_VERSION, TOPIC
from .spelling import normalize

LANGUAGES = ('en-GB', 'en-US')


class AIQAError(Exception):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def is_supported(media_version):
    return (media_version.original_file.mime_type or '').startswith(('image/', 'video/'))


def is_video(media_version):
    return (media_version.original_file.mime_type or '').startswith('video/')


def options_hash(options):
    return hashlib.sha256(json.dumps(options, sort_keys=True).encode()).hexdigest()


def _enqueue(review):
    now = timezone.now()
    OutboxEvent.objects.create(
        id=uuid.uuid4(), topic=TOPIC, aggregate_type='ai_review', aggregate_id=str(review.id),
        deduplication_key=f'{TOPIC}:{review.id}:{review.attempts}',
        payload={'ai_review_id': str(review.id)}, status=OutboxEventStatus.PENDING,
        available_at=now, created_at=now, updated_at=now,
    )


@transaction.atomic
def start_review(*, media_version, user, language='en-GB'):
    """Returns (review, created). Joins an identical active run instead of starting another."""
    if language not in LANGUAGES:
        raise AIQAError('ai_qa_bad_language', 'Choose English (UK) or English (US).')
    if not is_supported(media_version):
        raise AIQAError('ai_qa_unsupported_media', 'AI Visual QA checks images, posters and videos.')
    file = media_version.original_file
    if is_video(media_version):
        duration_ms = (file.metadata or {}).get('duration_ms') or 0
        limit = settings.AI_QA_MAX_VIDEO_SECONDS
        if duration_ms > limit * 1000:
            raise AIQAError(
                'ai_qa_too_long',
                f'Videos up to {limit // 60} minutes can be checked; this one is {duration_ms // 60000} min {duration_ms // 1000 % 60} s. Export a shorter cut to check it.',
            )
        if file.size_bytes > settings.AI_QA_MAX_VIDEO_BYTES:
            raise AIQAError('ai_qa_too_large', 'This video is too large to check.')
    elif file.size_bytes > settings.AI_QA_MAX_IMAGE_BYTES:
        raise AIQAError('ai_qa_too_large', 'This image is too large to check.')
    workspace = media_version.project.workspace
    options = {'mode': 'PROOFREAD', 'language': language, 'engine': settings.AI_QA_ENGINE}
    digest = options_hash(options)
    existing = AIReview.objects.select_for_update().filter(
        media_version=media_version, options_hash=digest, pipeline_version=PIPELINE_VERSION,
        status__in=AI_REVIEW_ACTIVE_STATUSES,
    ).first()
    if existing:
        return existing, False
    busy = AIReview.objects.filter(workspace=workspace, status__in=AI_REVIEW_ACTIVE_STATUSES)
    if busy.count() >= settings.AI_QA_MAX_CONCURRENT_PER_WORKSPACE:
        raise AIQAError('ai_qa_busy', 'Another AI Visual QA check is running in this workspace. Try again when it finishes.', 409)
    since = timezone.now() - timedelta(hours=24)
    if AIReview.objects.filter(workspace=workspace, created_at__gte=since).count() >= settings.AI_QA_DAILY_RUNS_PER_WORKSPACE:
        raise AIQAError('ai_qa_quota', 'This workspace has used today’s AI Visual QA checks. Try again tomorrow.', 429)
    review = AIReview.objects.create(
        workspace=workspace, media_version=media_version, file_checksum=file.checksum,
        requested_by=user, language=language, options=options, options_hash=digest,
        pipeline_version=PIPELINE_VERSION, engine=settings.AI_QA_ENGINE,
        progress={'kind': 'video' if is_video(media_version) else 'image'},
    )
    _enqueue(review)
    record_user_audit(
        user=user, workspace=workspace, action='ai_qa.review.started', entity_type='ai_review',
        entity_id=review.id, metadata={'media_version_id': str(media_version.id), 'language': language},
    )
    return review, True


@transaction.atomic
def retry_review(*, review, user):
    review = AIReview.objects.select_for_update().get(id=review.id)
    if review.status not in (AIReviewStatus.FAILED, AIReviewStatus.PARTIAL, AIReviewStatus.CANCELLED):
        raise AIQAError('ai_qa_not_retryable', 'Only a failed or partial check can be retried.', 409)
    busy = AIReview.objects.filter(workspace=review.workspace, status__in=AI_REVIEW_ACTIVE_STATUSES)
    if busy.count() >= settings.AI_QA_MAX_CONCURRENT_PER_WORKSPACE:
        raise AIQAError('ai_qa_busy', 'Another AI Visual QA check is running in this workspace.', 409)
    review.status = AIReviewStatus.QUEUED
    review.stage = 'queued'
    review.attempts = 0
    review.error_code = ''
    review.error_message = ''
    review.completed_at = None
    review.usage = {**review.usage, 'retries': review.usage.get('retries', 0) + 1}
    review.save()
    # Distinct dedupe key per retry round, so the outbox does not swallow it.
    now = timezone.now()
    OutboxEvent.objects.create(
        id=uuid.uuid4(), topic=TOPIC, aggregate_type='ai_review', aggregate_id=str(review.id),
        deduplication_key=f'{TOPIC}:{review.id}:retry:{review.usage["retries"]}',
        payload={'ai_review_id': str(review.id)}, status=OutboxEventStatus.PENDING,
        available_at=now, created_at=now, updated_at=now,
    )
    return review


@transaction.atomic
def cancel_review(*, review, user):
    review = AIReview.objects.select_for_update().get(id=review.id)
    if review.status not in AI_REVIEW_ACTIVE_STATUSES:
        raise AIQAError('ai_qa_not_running', 'Only a queued or running check can be cancelled.', 409)
    review.status = AIReviewStatus.CANCELLED
    review.stage = 'cancelled'
    review.completed_at = timezone.now()
    review.usage = {**review.usage, 'cancelled_by': str(user.id)}
    review.save()
    record_user_audit(user=user, workspace=review.workspace, action='ai_qa.review.cancelled',
                      entity_type='ai_review', entity_id=review.id, metadata={})
    return review


def notify_review_finished(review):
    """In-app note to whoever started the check. Never allowed to undo stored findings."""
    try:
        from app.models import NotificationKind
        from app.services.notifications import _media_payload, _notify, review_link

        if review.requested_by is None:
            return None
        payload = {
            **_media_payload(review.media_version),
            'link': review_link(media_version=review.media_version) + '&panel=ai',
            'status': review.status, 'finding_count': review.findings.count(),
            'error_message': review.error_message or None,
        }
        return _notify(
            recipient=review.requested_by, workspace=review.workspace, actor=None, actor_name='AI Visual QA',
            kind=NotificationKind.AI_QA_COMPLETED, entity_type='ai_review', entity_id=review.id, payload=payload,
        )
    except Exception:  # pragma: no cover - a notification problem must not fail the run
        import logging
        logging.getLogger(__name__).warning('AI QA notification failed for %s', review.id, exc_info=True)
        return None


def effective_glossary(*, workspace, project):
    terms = GlossaryTerm.objects.filter(workspace=workspace, enabled=True).filter(
        project__isnull=True,
    ) | GlossaryTerm.objects.filter(workspace=workspace, enabled=True, project=project)
    return frozenset(terms.values_list('normalized', flat=True))


def add_glossary_term(*, workspace, project, term, user, kind='other'):
    norm = normalize(term)
    if not norm or len(norm) > 200:
        raise AIQAError('ai_qa_bad_term', 'Enter a word or phrase up to 200 characters.')
    obj, _ = GlossaryTerm.objects.get_or_create(
        workspace=workspace, project=project, normalized=norm,
        defaults={'term': term.strip()[:200], 'kind': kind, 'created_by': user},
    )
    if not obj.enabled:
        obj.enabled = True
        obj.save(update_fields=['enabled', 'updated_at'])
    return obj


DECIDABLE = {AIFindingStatus.PENDING, AIFindingStatus.ACCEPTED, AIFindingStatus.DISMISSED, AIFindingStatus.NOT_AN_ERROR}


@transaction.atomic
def _require_finished(finding):
    """Findings streamed during a run are a preview: they are rewritten until the run ends."""
    if AIReview.objects.filter(id=finding.ai_review_id, status__in=AI_REVIEW_ACTIVE_STATUSES).exists():
        raise AIQAError('ai_qa_still_running', 'This check is still running. You can act on findings once it finishes.', 409)


def decide_finding(*, finding, user, status=None, edited_suggestion=None, add_to_glossary=None):
    finding = AIFinding.objects.select_for_update().get(id=finding.id)
    _require_finished(finding)
    if status is not None:
        if status not in DECIDABLE:
            raise AIQAError('ai_qa_bad_status', 'Choose accept, dismiss, not an error or pending.')
        if finding.status == AIFindingStatus.COMMENT_CREATED and finding.comment_id:
            raise AIQAError('ai_qa_has_comment', 'This finding is already a comment; resolve or delete the comment instead.', 409)
        finding.status = status
    if edited_suggestion is not None:
        finding.edited_suggestion = edited_suggestion.strip()[:500]
    finding.reviewed_by = user
    finding.reviewed_at = timezone.now()
    finding.save()
    if add_to_glossary:
        project = finding.media_version.project if add_to_glossary == 'project' else None
        add_glossary_term(workspace=finding.workspace, project=project, term=finding.detected_text, user=user)
    return finding


def comment_text(finding):
    suggestion = finding.edited_suggestion or finding.suggested_text
    if finding.category == AIFindingCategory.OCR_UNCERTAIN:
        line = f'AI-suggested: check “{finding.detected_text}”'
        return line + (f' — it may read “{suggestion}”.' if suggestion else ' — the text was hard to read here.')
    line = f'AI-suggested: “{finding.detected_text}” may be misspelt'
    return line + (f' — suggest “{suggestion}”.' if suggestion else '.')


def _padded(region, pad=0.01):
    x = max(0.0, region.get('x', 0) - pad)
    y = max(0.0, region.get('y', 0) - pad)
    return {
        'x': round(x, 4), 'y': round(y, 4),
        'width': round(min(1 - x, region.get('width', 0) + 2 * pad), 4),
        'height': round(min(1 - y, region.get('height', 0) + 2 * pad), 4),
    }


@transaction.atomic
def create_comment_from_finding(*, finding, user, visibility=ReviewCommentVisibility.TEAM, text=None):
    """Idempotent: the same finding (or the same issue on a re-run) never gets two comments."""
    finding = AIFinding.objects.select_for_update().select_related('media_version__project__workspace').get(id=finding.id)
    _require_finished(finding)
    if finding.comment_id and finding.comment.deleted_at is None:
        return finding.comment, False
    sibling = AIFinding.objects.filter(
        media_version=finding.media_version, dedupe_key=finding.dedupe_key,
        comment__isnull=False, comment__deleted_at__isnull=True,
    ).exclude(id=finding.id).select_related('comment').first()
    if sibling:
        comment = sibling.comment
        sibling.comment = None
        sibling.save(update_fields=['comment', 'updated_at'])
        finding.comment = comment
        finding.status = AIFindingStatus.COMMENT_CREATED
        finding.save()
        return comment, False
    if visibility not in ReviewCommentVisibility.values:
        raise AIQAError('ai_qa_bad_visibility', 'Choose team or client visibility.')
    body = (text or '').strip() or comment_text(finding)
    comment = create_review_comment(
        media_version=finding.media_version, user=user, text=body[:5000], visibility=visibility,
        start_time_ms=finding.start_time_ms, end_time_ms=finding.end_time_ms,
    )
    comment.source = ReviewCommentSource.AI_VISUAL_QA
    comment.save(update_fields=['source'])
    if finding.region:
        # A brief sighting still deserves a highlight you can see: hold it at least 1.5 s.
        end_ms = finding.end_time_ms
        if finding.start_time_ms is not None:
            end_ms = max(end_ms or finding.start_time_ms, finding.start_time_ms + 1500)
        create_annotation(
            media_version=finding.media_version, user=user, review_comment=comment,
            start_time_ms=finding.start_time_ms, end_time_ms=end_ms,
            elements=[{
                'element_type': 'RECTANGLE', 'geometry': _padded(finding.region),
                'style': {'color': '#f5a524', 'stroke_width': 2},
                'payload': {'ai_finding_id': str(finding.id)},
            }],
        )
    finding.comment = comment
    finding.status = AIFindingStatus.COMMENT_CREATED
    finding.reviewed_by = user
    finding.reviewed_at = timezone.now()
    finding.save()
    return comment, True
