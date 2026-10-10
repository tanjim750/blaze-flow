"""Runs one stored AIReview end to end inside the dedicated AI QA worker."""
import logging
import tempfile
import time
from pathlib import Path

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from app.models import (
    AIFinding, AIFindingStatus, AIFrameObservation, AIReview, AIReviewStatus,
    FileSecurityScan, FileSecurityScanStatus,
)
from app.services.file_processing import _copy_private_object

from .engines import get_engine
from .service import effective_glossary
from .spelling import check_line

log = logging.getLogger(__name__)

CARRIED = (AIFindingStatus.DISMISSED, AIFindingStatus.NOT_AN_ERROR, AIFindingStatus.COMMENT_CREATED)
BAND_RANK = {'high': 3, 'medium': 2, 'low': 1}


class PipelineFailure(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


class NotReadyYet(Exception):
    """Raised so the outbox retries later (e.g. the virus scan has not finished)."""


def _set(review, **fields):
    for key, value in fields.items():
        setattr(review, key, value)
    review.save(update_fields=[*fields, 'updated_at'])


def _claim(review_id):
    with transaction.atomic():
        review = AIReview.objects.select_for_update().select_related(
            'media_version__original_file', 'media_version__project__workspace',
        ).get(id=review_id)
        if review.status not in (AIReviewStatus.QUEUED, AIReviewStatus.PROCESSING):
            return None  # finished or cancelled: a duplicate delivery is a no-op
        review.status = AIReviewStatus.PROCESSING
        review.stage = 'reading'
        review.attempts += 1
        review.started_at = review.started_at or timezone.now()
        review.save()
        return review


def _prepare_image(source, workdir):
    from PIL import Image, ImageOps

    Image.MAX_IMAGE_PIXELS = settings.AI_QA_MAX_DECODE_PIXELS
    try:
        with Image.open(source) as image:
            image = ImageOps.exif_transpose(image).convert('RGB')
    except Exception as exc:  # malformed / decompression bomb / unsupported
        raise PipelineFailure('ai_qa_unreadable_image', 'This image could not be read.') from exc
    width, height = image.size
    pixels = width * height
    if pixels > settings.AI_QA_MAX_PIXELS:
        scale = (settings.AI_QA_MAX_PIXELS / pixels) ** 0.5
        image = image.resize((int(width * scale), int(height * scale)), Image.LANCZOS)
    elif max(width, height) < 1000:
        image = image.resize((width * 2, height * 2), Image.LANCZOS)  # small text reads better upscaled
    target = Path(workdir) / 'ocr.png'
    image.save(target)
    return target, image.size, (width, height)


def _finish_findings(review, candidates):
    best = {}
    for cand in candidates:
        key = cand.dedupe_key
        if key not in best or BAND_RANK[cand.band] > BAND_RANK[best[key].band]:
            best[key] = cand
    prior = {}
    for old in AIFinding.objects.filter(
        media_version=review.media_version, dedupe_key__in=list(best), status__in=CARRIED,
    ).exclude(ai_review=review).order_by('created_at'):
        prior[old.dedupe_key] = old
    rows = []
    for key, cand in best.items():
        carried = prior.get(key)
        rows.append(AIFinding(
            workspace=review.workspace, ai_review=review, media_version=review.media_version,
            category=cand.category, band=cand.band, detected_text=cand.detected_text[:500],
            suggested_text=cand.suggested_text[:500], context_text=cand.context_text,
            explanation=cand.explanation[:500], ocr_confidence=cand.ocr_confidence,
            decision_confidence=cand.decision_confidence, region=cand.region, dedupe_key=key,
            status=carried.status if carried else AIFindingStatus.PENDING,
            edited_suggestion=carried.edited_suggestion if carried else '',
        ))
    with transaction.atomic():
        AIFinding.objects.filter(ai_review=review).delete()  # a resumed attempt starts clean
        created = AIFinding.objects.bulk_create(rows)
        for finding in created:
            old = prior.get(finding.dedupe_key)
            if old and old.comment_id:
                comment_id = old.comment_id
                AIFinding.objects.filter(id=old.id).update(comment=None)
                AIFinding.objects.filter(id=finding.id).update(comment_id=comment_id)
    return created


def run_review(review_id):
    review = _claim(review_id)
    if review is None:
        return None
    started = time.monotonic()
    try:
        file = review.media_version.original_file
        if not (file.mime_type or '').startswith('image/'):
            raise PipelineFailure('ai_qa_unsupported_media', 'Only images and posters can be checked for now.')
        scan = FileSecurityScan.objects.filter(file_id=file.id).first()
        if scan and scan.status == FileSecurityScanStatus.INFECTED:
            raise PipelineFailure('ai_qa_unsafe_file', 'This file failed its security scan.')
        if scan and scan.status == FileSecurityScanStatus.PENDING and settings.AI_QA_REQUIRE_CLEAN_SCAN:
            _set(review, status=AIReviewStatus.QUEUED, stage='waiting_for_scan', attempts=review.attempts - 1)
            raise NotReadyYet('security scan pending')
        engine = get_engine(review.engine or None)
        with tempfile.TemporaryDirectory(prefix='aiqa-') as workdir:
            source = Path(workdir) / 'source'
            try:
                _copy_private_object(file, source, max_bytes=settings.AI_QA_MAX_IMAGE_BYTES)
            except ValueError as exc:
                raise PipelineFailure('ai_qa_too_large', 'This image is too large to check.') from exc
            prepared, (width, height), original_size = _prepare_image(source, workdir)
            _set(review, engine=engine.name, engine_version=str(engine.version or ''),
                 progress={**review.progress, 'frames_total': 1, 'frames_done': 0})
            lines = engine.read(prepared, width=width, height=height, source_path=source)
        AIFrameObservation.objects.filter(ai_review=review).delete()
        AIFrameObservation.objects.bulk_create([
            AIFrameObservation(
                ai_review=review, frame_index=0, text=line.text[:5000], confidence=line.confidence,
                polygon=line.polygon, engine=engine.name,
            ) for line in lines
        ])
        _set(review, stage='checking', progress={**review.progress, 'frames_total': 1, 'frames_done': 1, 'lines': len(lines)})
        glossary = effective_glossary(workspace=review.workspace, project=review.media_version.project)
        candidates = [cand for line in lines for cand in check_line(line, glossary=glossary)]
        findings = _finish_findings(review, candidates)
        _set(
            review, status=AIReviewStatus.SUCCEEDED, stage='done', completed_at=timezone.now(),
            usage={
                **review.usage, 'duration_ms': int((time.monotonic() - started) * 1000),
                'lines': len(lines), 'findings': len(findings), 'image_px': list(original_size),
                'cost_usd': 0,
            },
        )
        return review
    except NotReadyYet:
        raise
    except PipelineFailure as exc:
        _set(review, status=AIReviewStatus.FAILED, stage='failed', error_code=exc.code,
             error_message=exc.message[:500], completed_at=timezone.now())
        return review
    except Exception:
        log.exception('AI QA run %s failed', review.id)
        if review.attempts < settings.AI_QA_MAX_ATTEMPTS:
            _set(review, status=AIReviewStatus.QUEUED, stage='retrying')
            raise  # the outbox retries with backoff
        _set(review, status=AIReviewStatus.FAILED, stage='failed', error_code='ai_qa_internal',
             error_message='The check could not finish. Try again.', completed_at=timezone.now())
        return review


def handle_run_event(event):
    return run_review(event.payload['ai_review_id'])
