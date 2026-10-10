"""Runs one stored AIReview end to end inside the dedicated AI QA worker."""
import hashlib
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

from . import video as vid
from .engines import get_engine
from .service import effective_glossary, notify_review_finished
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


class Cancelled(Exception):
    pass


def _set(review, **fields):
    for key, value in fields.items():
        setattr(review, key, value)
    review.save(update_fields=[*fields, 'updated_at'])


def _check_cancelled(review):
    if AIReview.objects.filter(id=review.id, status=AIReviewStatus.CANCELLED).exists():
        raise Cancelled


def _progress(review, **changes):
    _check_cancelled(review)
    review.progress = {**review.progress, **changes}
    AIReview.objects.filter(id=review.id).exclude(status=AIReviewStatus.CANCELLED).update(
        progress=review.progress, stage=review.stage, updated_at=timezone.now(),
    )


def _claim(review_id):
    with transaction.atomic():
        review = AIReview.objects.select_for_update().select_related(
            'media_version__original_file', 'media_version__project__workspace', 'requested_by',
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


def _row(review, cand, *, key, start_ms=None, end_ms=None, track=None, category=None, band=None, explanation=None):
    return {
        'key': key, 'category': category or cand.category, 'band': band or cand.band,
        'detected_text': cand.detected_text[:500], 'suggested_text': cand.suggested_text[:500],
        'context_text': cand.context_text, 'explanation': (explanation or cand.explanation)[:500],
        'ocr_confidence': cand.ocr_confidence, 'decision_confidence': cand.decision_confidence,
        'region': cand.region, 'start_time_ms': start_ms, 'end_time_ms': end_ms, 'track': track or [],
    }


def _finish_findings(review, rows):
    best = {}
    for row in rows:
        if row['key'] not in best or BAND_RANK[row['band']] > BAND_RANK[best[row['key']]['band']]:
            best[row['key']] = row
    prior = {}
    for old in AIFinding.objects.filter(
        media_version=review.media_version, dedupe_key__in=list(best), status__in=CARRIED,
    ).exclude(ai_review=review).order_by('created_at'):
        prior[old.dedupe_key] = old
    objects = []
    for key, row in best.items():
        carried = prior.get(key)
        fields = {k: v for k, v in row.items() if k != 'key'}
        objects.append(AIFinding(
            workspace=review.workspace, ai_review=review, media_version=review.media_version,
            dedupe_key=key, status=carried.status if carried else AIFindingStatus.PENDING,
            edited_suggestion=carried.edited_suggestion if carried else '', **fields,
        ))
    with transaction.atomic():
        AIFinding.objects.filter(ai_review=review).delete()  # a resumed attempt starts clean
        created = AIFinding.objects.bulk_create(objects)
        for finding in created:
            old = prior.get(finding.dedupe_key)
            if old and old.comment_id:
                comment_id = old.comment_id
                AIFinding.objects.filter(id=old.id).update(comment=None)
                AIFinding.objects.filter(id=finding.id).update(comment_id=comment_id)
    return created


def _run_image(review, engine, file, workdir, glossary):
    source = Path(workdir) / 'source'
    try:
        _copy_private_object(file, source, max_bytes=settings.AI_QA_MAX_IMAGE_BYTES)
    except ValueError as exc:
        raise PipelineFailure('ai_qa_too_large', 'This image is too large to check.') from exc
    prepared, (width, height), original_size = _prepare_image(source, workdir)
    _progress(review, frames_total=1, frames_done=0)
    lines = engine.read(prepared, width=width, height=height, source_path=source)
    AIFrameObservation.objects.bulk_create([
        AIFrameObservation(ai_review=review, frame_index=0, text=line.text[:5000], confidence=line.confidence,
                           polygon=line.polygon, engine=engine.name) for line in lines
    ])
    review.stage = 'checking'
    _progress(review, frames_done=1, lines=len(lines))
    rows = [_row(review, cand, key=cand.dedupe_key) for line in lines for cand in check_line(line, glossary=glossary)]
    return rows, {'lines': len(lines), 'image_px': list(original_size), 'frames_ocr': 1}


def _line_box(line):
    xs = [p[0] for p in line.polygon] or [0]
    ys = [p[1] for p in line.polygon] or [0]
    return {'x': min(xs), 'y': min(ys), 'width': max(xs) - min(xs), 'height': max(ys) - min(ys)}


def analyse_video(source, workdir, *, engine, glossary, file_metadata=None, on_progress=lambda **_: None):
    """Sample, OCR, track and decide for one video file. No database access (the eval uses it).

    Returns (rows, observed, usage): finding rows, {time_ms: [OcrLine]} and counters.
    """
    try:
        info = vid.probe(source)
        limit_ms = settings.AI_QA_MAX_VIDEO_SECONDS * 1000
        if info['duration_ms'] > limit_ms:
            raise PipelineFailure('ai_qa_too_long', f'Videos up to {settings.AI_QA_MAX_VIDEO_SECONDS // 60} minutes can be checked; this one is {info["duration_ms"] // 60000} min {info["duration_ms"] // 1000 % 60} s.')
        on_progress(stage='sampling', duration_ms=info['duration_ms'], frames_total=0, frames_done=0)
        baseline = vid.sample_baseline(source, Path(workdir) / 'base', max_frames=settings.AI_QA_MAX_FRAMES)
    except vid.VideoError as exc:
        raise PipelineFailure(exc.code, exc.message) from exc
    if not baseline:
        raise PipelineFailure('ai_qa_unreadable_video', 'No frames could be read from this video.')

    observed = {}  # time_ms -> lines
    stats = {'frames_sampled': 0, 'frames_ocr': 0, 'frames_duplicate': 0}
    state = {'hash': None, 'lines': []}

    def ocr_frames(frames, done_before, total, stage):
        for index, (time_ms, path) in enumerate(frames):
            if time_ms in observed:
                continue
            stats['frames_sampled'] += 1
            digest = vid.fingerprint(path)
            if (settings.AI_QA_DEDUPE_FRAMES and state['hash'] is not None
                    and vid.changed_fraction(digest, state['hash']) <= settings.AI_QA_DUP_MAX_CHANGED):
                lines = state['lines']
                stats['frames_duplicate'] += 1
            else:
                from PIL import Image
                with Image.open(path) as image:
                    width, height = image.size
                lines = engine.read(path, width=width, height=height, time_ms=time_ms, file_metadata=file_metadata)
                stats['frames_ocr'] += 1
                state['hash'], state['lines'] = digest, lines
            observed[time_ms] = lines
            if index % 5 == 0 or index == len(frames) - 1:
                on_progress(stage=stage, frames_done=done_before + index + 1, frames_total=total)

    ocr_frames(baseline, 0, len(baseline), 'reading')
    signatures = [(t, vid.text_signature(observed[t])) for t, _ in baseline]
    windows = vid.dense_windows(signatures)
    dense = []
    room = settings.AI_QA_MAX_FRAMES - len(baseline)
    if windows and room > 0:
        on_progress(stage='refining', frames_done=len(baseline), frames_total=len(baseline))
        try:
            dense = vid.sample_windows(source, Path(workdir) / 'dense', windows, max_frames=room)
        except vid.VideoError:
            dense = []  # the baseline still stands; refinement is best effort
        state['hash'] = None
        ocr_frames(sorted(dense), len(baseline), len(baseline) + len(dense), 'refining')
    total = len(baseline) + len(dense)
    on_progress(stage='checking', frames_done=total, frames_total=total)

    times = sorted(observed)
    frames = [(t, [c for line in observed[t] for c in check_line(line, glossary=glossary)]) for t in times]
    frame_regions = [(t, [_line_box(line) for line in observed[t]]) for t in times]
    rows = []
    for track in vid.build_tracks(frames):
        best = max(track.sightings, key=lambda s: (BAND_RANK[s.candidate.band], s.candidate.ocr_confidence))
        cand = best.candidate
        visible = vid.visible_frames(track, frame_regions)
        seen = len(track.sightings)
        category, band, explanation = None, None, None
        if visible >= 3 and seen / visible < 0.5:
            # Read this way in a minority of the frames it was on screen: far more likely an
            # OCR slip than a typo in the artwork.
            category, band = 'OCR_UNCERTAIN', 'low'
            explanation = f'Read as “{cand.detected_text}” in only {seen} of {visible} frames — likely a reading slip. Check the frame.'
        elif seen == 1 and cand.band == 'high':
            band = 'medium'  # one sighting is weaker evidence than a sustained one
        start = track.start_ms
        end = max(track.end_ms, start)
        key = hashlib.sha256(f'{cand.dedupe_key}:{start // 2000}'.encode()).hexdigest()
        path = [{'t': s.time_ms, **s.candidate.region} for s in track.sightings][:200]
        rows.append(_row(None, cand, key=key, start_ms=start, end_ms=end, track=path,
                         category=category, band=band, explanation=explanation))
    usage = {**stats, 'duration_ms_media': info['duration_ms'], 'frames_total': len(times),
             'dense_windows': len(windows), 'lines': sum(len(v) for v in observed.values())}
    return rows, observed, usage


def _run_video(review, engine, file, workdir, glossary):
    source = Path(workdir) / 'source'
    try:
        _copy_private_object(file, source, max_bytes=settings.AI_QA_MAX_VIDEO_BYTES)
    except ValueError as exc:
        raise PipelineFailure('ai_qa_too_large', 'This video is too large to check.') from exc

    def on_progress(stage=None, **changes):
        if stage:
            review.stage = stage
        _progress(review, **changes)

    rows, observed, usage = analyse_video(
        source, workdir, engine=engine, glossary=glossary, file_metadata=file.metadata or {}, on_progress=on_progress,
    )
    review.stage = 'checking'
    AIFrameObservation.objects.bulk_create([
        AIFrameObservation(ai_review=review, time_ms=t, frame_index=i, text=line.text[:5000],
                           confidence=line.confidence, polygon=line.polygon, engine=engine.name)
        for i, t in enumerate(sorted(observed)) for line in observed[t]
    ], batch_size=500)
    return rows, usage


def run_review(review_id):
    review = _claim(review_id)
    if review is None:
        return None
    started = time.monotonic()
    try:
        file = review.media_version.original_file
        mime = file.mime_type or ''
        if not mime.startswith(('image/', 'video/')):
            raise PipelineFailure('ai_qa_unsupported_media', 'Only images, posters and videos can be checked.')
        scan = FileSecurityScan.objects.filter(file_id=file.id).first()
        if scan and scan.status == FileSecurityScanStatus.INFECTED:
            raise PipelineFailure('ai_qa_unsafe_file', 'This file failed its security scan.')
        if scan and scan.status == FileSecurityScanStatus.PENDING and settings.AI_QA_REQUIRE_CLEAN_SCAN:
            _set(review, status=AIReviewStatus.QUEUED, stage='waiting_for_scan', attempts=review.attempts - 1)
            raise NotReadyYet('security scan pending')
        engine = get_engine(review.engine or None)
        _set(review, engine=engine.name, engine_version=str(engine.version or ''))
        glossary = effective_glossary(workspace=review.workspace, project=review.media_version.project)
        AIFrameObservation.objects.filter(ai_review=review).delete()
        with tempfile.TemporaryDirectory(prefix='aiqa-') as workdir:
            runner = _run_video if mime.startswith('video/') else _run_image
            rows, usage = runner(review, engine, file, workdir, glossary)
        _check_cancelled(review)
        findings = _finish_findings(review, rows)
        elapsed = int((time.monotonic() - started) * 1000)
        updated = AIReview.objects.filter(id=review.id, status=AIReviewStatus.PROCESSING).update(
            status=AIReviewStatus.SUCCEEDED, stage='done', completed_at=timezone.now(), updated_at=timezone.now(),
            usage={**review.usage, **usage, 'duration_ms': elapsed, 'findings': len(findings), 'cost_usd': 0},
        )
        review.refresh_from_db()
        if updated:
            notify_review_finished(review)
        return review
    except NotReadyYet:
        raise
    except Cancelled:
        AIFinding.objects.filter(ai_review=review).delete()
        return review
    except PipelineFailure as exc:
        _set(review, status=AIReviewStatus.FAILED, stage='failed', error_code=exc.code,
             error_message=exc.message[:500], completed_at=timezone.now())
        notify_review_finished(review)
        return review
    except Exception:
        log.exception('AI QA run %s failed', review.id)
        if review.attempts < settings.AI_QA_MAX_ATTEMPTS:
            _set(review, status=AIReviewStatus.QUEUED, stage='retrying')
            raise  # the outbox retries with backoff
        _set(review, status=AIReviewStatus.FAILED, stage='failed', error_code='ai_qa_internal',
             error_message='The check could not finish. Try again.', completed_at=timezone.now())
        notify_review_finished(review)
        return review


def handle_run_event(event):
    return run_review(event.payload['ai_review_id'])
