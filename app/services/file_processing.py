import hashlib
import html
import io
import logging
import shutil
import socket
import struct
import subprocess
import tempfile
import uuid
import wave
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from django.conf import settings
from django.core.files import File as DjangoFile
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.db import transaction
from django.utils import timezone
from django.utils.module_loading import import_string

from app.models import (
    File,
    FileSecurityScan,
    FileSecurityScanStatus,
    FileStatus,
    FileVariant,
    OutboxEvent,
    OutboxEventStatus,
)


SCAN_TOPIC = 'file.security-scan.requested'
logger = logging.getLogger(__name__)

PREVIEW_TOPIC = 'file.preview.requested'
# The optional 1080p proxy is its own low-priority job (see `run_outbox_worker`), so a slow
# or failed HQ encode never holds up or fails the 720p review proxy.
HQ_PREVIEW_TOPIC = 'file.preview-hq.requested'
# The playable/openable preview: exactly one of these per file, and the thing the review
# player and `preview_status` mean when they say "the preview".
PREVIEW_VARIANT_TYPES = (
    'REVIEW_CARD', 'IMAGE_THUMBNAIL', 'AUDIO_WAVEFORM',
    'PDF_FIRST_PAGE', 'MP3_WAVEFORM', 'VIDEO_PROXY',
)

# A still for cards, kept deliberately outside `PREVIEW_VARIANT_TYPES`. A video needs both
# — a proxy to play and a frame to show in a list — and every lookup that means "the
# preview" filters on the tuple above, so a poster can sit alongside without being mistaken
# for one.
POSTER_VARIANT_TYPE = 'VIDEO_POSTER'


class EicarAwareScanner:
    """Development-safe scanner contract; replace this backend in production."""

    name = 'builtin-eicar-aware'

    def scan(self, stream):
        marker = b'EICAR-STANDARD-ANTIVIRUS-TEST-FILE'
        tail = b''
        while True:
            chunk = stream.read(64 * 1024)
            if not chunk:
                break
            sample = tail + chunk
            if marker in sample:
                return {'clean': False, 'threat': 'EICAR-Test-File'}
            tail = sample[-len(marker):]
        return {'clean': True}


class ClamAVTcpScanner:
    """Streams private objects to a ClamAV daemon using its INSTREAM protocol."""

    name = 'clamav-tcp'

    def scan(self, stream):
        total = 0
        with socket.create_connection(
            (settings.CLAMAV_HOST, settings.CLAMAV_PORT),
            timeout=settings.CLAMAV_TIMEOUT_SECONDS,
        ) as connection:
            connection.settimeout(settings.CLAMAV_TIMEOUT_SECONDS)
            connection.sendall(b'zINSTREAM\0')
            while True:
                chunk = stream.read(64 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > settings.CLAMAV_MAX_STREAM_BYTES:
                    raise RuntimeError('The file exceeds CLAMAV_MAX_STREAM_BYTES.')
                connection.sendall(struct.pack('!I', len(chunk)) + chunk)
            connection.sendall(struct.pack('!I', 0))
            response = b''
            while not response.endswith(b'\0'):
                chunk = connection.recv(4096)
                if not chunk:
                    break
                response += chunk
                if len(response) > 64 * 1024:
                    raise RuntimeError('ClamAV returned an oversized response.')
        message = response.rstrip(b'\0').decode('utf-8', errors='replace')
        if message.endswith('OK'):
            return {'clean': True, 'response': message}
        if message.endswith('FOUND'):
            threat = message.rsplit(': ', 1)[-1].removesuffix(' FOUND')
            return {'clean': False, 'threat': threat, 'response': message}
        raise RuntimeError(f'ClamAV scan failed: {message or "empty response"}')


def video_proxy_thread_args():
    """`-threads N` for libx264, or nothing to let ffmpeg decide.

    Inside a container ffmpeg sees every host core, not the `cpus:` quota, so on a 4-core box
    with `OUTBOX_CPU_LIMIT=2` it would start ~6 encoder threads and spend the quota on
    context switches. Matching the quota keeps the encode smooth and leaves the other cores to
    web and Postgres.
    """
    threads = settings.VIDEO_PROXY_THREADS
    return ['-threads', str(threads)] if threads > 0 else []


def scanner_backend():
    scanner_class = import_string(settings.FILE_SECURITY_SCANNER)
    return scanner_class()


class FileNotCommittedYet(Exception):
    """The job's File row is not visible (yet). Retried on a short backoff by the outbox."""

    retry_after_seconds = 5


def _write_file_event(*, file_id, topic):
    now = timezone.now()
    return OutboxEvent.objects.get_or_create(
        deduplication_key=f'{topic}:{file_id}',
        defaults={
            'id': uuid.uuid4(), 'topic': topic, 'aggregate_type': 'file',
            'aggregate_id': str(file_id), 'payload': {'file_id': str(file_id)},
            'status': OutboxEventStatus.PENDING, 'available_at': now,
            'created_at': now, 'updated_at': now,
        },
    )[0]


def enqueue_file_event(*, file, topic):
    """Queue a post-upload job for `file`.

    This is a transactional outbox: the event row is written on the same connection and in
    the same transaction as the File, so it commits (or rolls back) together with it. A
    worker can therefore never claim the job before the File row is committed, which is
    the guarantee `transaction.on_commit` would give, without the window where a crash
    after commit loses the job. `test_file_job_race` pins this down.
    """
    return _write_file_event(file_id=file.id, topic=topic)


def _load_job_file(file_id, **filters):
    """The File a job is about, or None when it was deleted and the job has nothing to do.

    A row that does not exist at all raises `FileNotCommittedYet` so the outbox retries
    it quickly instead of burning exponential attempts on an upload still committing.
    """
    file = File.objects.filter(id=file_id).first()
    if file is None:
        raise FileNotCommittedYet(f'File {file_id} is not visible yet.')
    if file.deleted_at is not None:
        logger.info('Skipping job for deleted file %s', file_id)
        return None
    for field, value in filters.items():
        if getattr(file, field) != value:
            raise File.DoesNotExist(f'File {file_id} is not {field}={value}.')
    return file


SKIPPED_LARGE_MEDIA = 'skipped_large_media'
BLOCKED_TOO_LARGE = 'too_large_to_scan'
# ffprobe `format_name` values we accept as real video containers. Image, audio-only and
# "raw" demuxers are deliberately absent, so a renamed PNG/PDF/ZIP never qualifies.
_VIDEO_FORMAT_NAMES = {
    'mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2', 'matroska', 'webm', 'avi', 'mpegts', 'mpeg',
    'flv', 'asf', 'mxf', 'ogg',
}


def _sniff_video_container(header):
    """Name of the video container the leading bytes belong to, or None.

    Magic bytes only; the client's filename and MIME type are never consulted.
    """
    if len(header) >= 12 and header[4:8] == b'ftyp':
        return 'isobmff'
    if len(header) >= 8 and header[4:8] in {b'moov', b'mdat', b'wide', b'free', b'skip'}:
        return 'quicktime'
    if header.startswith(b'\x1a\x45\xdf\xa3'):
        return 'matroska'
    if len(header) >= 12 and header[:4] == b'RIFF' and header[8:12] == b'AVI ':
        return 'avi'
    if header.startswith(b'\x00\x00\x01\xba') or header.startswith(b'\x00\x00\x01\xb3'):
        return 'mpeg-ps'
    if len(header) >= 189 and header[0] == 0x47 and header[188] == 0x47:
        return 'mpeg-ts'
    if header.startswith(b'FLV'):
        return 'flv'
    if header.startswith(b'\x30\x26\xb2\x75\x8e\x66\xcf\x11'):
        return 'asf'
    if header.startswith(b'\x06\x0e\x2b\x34\x02\x05\x01\x01'):
        return 'mxf'
    return None


def _probe_input(file):
    """Something ffprobe can open without copying the whole object: a path or a signed URL."""
    try:
        return default_storage.path(file.object_key)
    except NotImplementedError:
        return default_storage.url(file.object_key)


def _ffprobe_video_streams(file):
    """(format_name, video_stream_count) as ffprobe reports them, or None when it cannot tell."""
    import json
    executable = shutil.which(settings.FFPROBE_COMMAND)
    if not executable:
        return None
    try:
        result = subprocess.run(
            [executable, '-v', 'error', '-show_entries', 'format=format_name:stream=codec_type,codec_name',
             '-of', 'json', _probe_input(file)],
            capture_output=True, text=True, timeout=120,
        )
        data = json.loads(result.stdout or '{}') if result.returncode == 0 else None
    except (subprocess.SubprocessError, OSError, ValueError):
        return None
    if not data:
        return None
    formats = set((data.get('format') or {}).get('format_name', '').split(','))
    videos = [
        st for st in data.get('streams', [])
        if st.get('codec_type') == 'video' and st.get('codec_name') not in {'png', 'mjpeg', 'bmp', 'gif'}
    ]
    return formats, len(videos)


def verified_large_video(file):
    """Evidence that an over-limit file really is a video, or None.

    Both checks must pass: the leading bytes match a video container, and ffprobe finds a
    video stream in a video container format.
    """
    with default_storage.open(file.object_key, 'rb') as stream:
        header = stream.read(512)
    container = _sniff_video_container(header)
    if not container:
        return None
    probe = _ffprobe_video_streams(file)
    if not probe:
        return None
    formats, video_streams = probe
    if not video_streams or not (formats & _VIDEO_FORMAT_NAMES):
        return None
    return {'container': container, 'format_name': ','.join(sorted(formats)), 'video_streams': video_streams}


def _over_scan_limit(file):
    limit = getattr(settings, 'CLAMAV_MAX_STREAM_BYTES', None)
    size = file.size_bytes or 0
    return bool(limit) and size > limit


def process_security_scan(*, file_id):
    file = _load_job_file(file_id)
    if file is None:
        return None
    scan = FileSecurityScan.objects.get(file=file)
    if scan.status in {FileSecurityScanStatus.CLEAN, FileSecurityScanStatus.INFECTED}:
        return scan
    scanner = scanner_backend()
    if _over_scan_limit(file):
        return _handle_over_limit(file_id=file_id, file=file, scanner=scanner)
    try:
        with default_storage.open(file.object_key, 'rb') as stream:
            result = scanner.scan(stream)
    except Exception as exc:
        failed_at = timezone.now()
        FileSecurityScan.objects.filter(file=file).update(
            engine=scanner.name, status=FileSecurityScanStatus.FAILED,
            result={'error': str(exc)[:1000]}, scanned_at=failed_at,
            updated_at=failed_at,
        )
        raise
    with transaction.atomic():
        file = File.objects.select_for_update().get(id=file_id, deleted_at__isnull=True)
        scan = FileSecurityScan.objects.select_for_update().get(file=file)
        if scan.status in {FileSecurityScanStatus.CLEAN, FileSecurityScanStatus.INFECTED}:
            return scan
        scan.result = result
        if result.get('clean'):
            scan.status = FileSecurityScanStatus.CLEAN
            file.status = FileStatus.READY
            enqueue_file_event(file=file, topic=PREVIEW_TOPIC)
        else:
            scan.status = FileSecurityScanStatus.INFECTED
            file.status = FileStatus.FAILED
        scan.engine = scanner.name
        scan.scanned_at = timezone.now()
        scan.save(update_fields=['engine', 'status', 'result', 'scanned_at', 'updated_at'])
        file.updated_at = timezone.now()
        file.save(update_fields=['status', 'updated_at'])
    return scan


def _handle_over_limit(*, file_id, file, scanner):
    """Too big for the scanner: verified video skips the scan, anything else is blocked."""
    limit = settings.CLAMAV_MAX_STREAM_BYTES
    evidence = verified_large_video(file)
    now = timezone.now()
    with transaction.atomic():
        file = File.objects.select_for_update().get(id=file_id, deleted_at__isnull=True)
        scan = FileSecurityScan.objects.select_for_update().get(file=file)
        if scan.status in {FileSecurityScanStatus.CLEAN, FileSecurityScanStatus.INFECTED}:
            return scan
        scan.engine = scanner.name
        scan.scanned_at = now
        if evidence:
            scan.status = FileSecurityScanStatus.CLEAN
            scan.result = {
                'clean': True, 'skipped': True, 'scan_status': SKIPPED_LARGE_MEDIA,
                'reason': f'Verified video larger than the {limit}-byte scan limit; malware scan skipped.',
                'size_bytes': file.size_bytes, **evidence,
            }
            file.status = FileStatus.READY
            enqueue_file_event(file=file, topic=PREVIEW_TOPIC)
            logger.warning(
                'Security scan skipped for large verified video file=%s size=%s limit=%s container=%s',
                file.id, file.size_bytes, limit, evidence['container'],
            )
        else:
            scan.status = FileSecurityScanStatus.FAILED
            scan.result = {
                'clean': False, 'scan_status': BLOCKED_TOO_LARGE,
                'error': (
                    f'This file is {file.size_bytes} bytes, over the {limit}-byte malware-scan limit, '
                    'and is not a verified video, so it was blocked.'
                ),
                'size_bytes': file.size_bytes,
            }
            file.status = FileStatus.FAILED
            logger.warning(
                'Security scan blocked oversized non-video file=%s size=%s limit=%s',
                file.id, file.size_bytes, limit,
            )
        scan.save(update_fields=['engine', 'status', 'result', 'scanned_at', 'updated_at'])
        file.updated_at = now
        file.save(update_fields=['status', 'updated_at'])
    return scan


def _review_card(file):
    safe_name = html.escape(file.original_name)
    safe_type = html.escape(file.mime_type)
    data = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">'
        '<rect width="100%" height="100%" fill="#111827"/>'
        '<text x="40" y="155" fill="#f9fafb" font-size="28" font-family="sans-serif">'
        f'{safe_name}</text><text x="40" y="205" fill="#9ca3af" font-size="18" '
        f'font-family="sans-serif">{safe_type} · {file.size_bytes} bytes</text></svg>'
    ).encode()
    return data, 'image/svg+xml', 'svg', 'REVIEW_CARD', {'fallback': True}


def _image_thumbnail(file):
    with default_storage.open(file.object_key, 'rb') as stream:
        with Image.open(stream) as source:
            width, height = source.size
            if width * height > settings.PREVIEW_MAX_PIXELS:
                raise ValueError('Image dimensions exceed PREVIEW_MAX_PIXELS.')
            source.seek(0)
            image = ImageOps.exif_transpose(source).convert('RGB')
            image.thumbnail((settings.PREVIEW_MAX_WIDTH, settings.PREVIEW_MAX_HEIGHT))
            output = io.BytesIO()
            image.save(output, format='JPEG', quality=82, optimize=True)
            return (
                output.getvalue(), 'image/jpeg', 'jpg', 'IMAGE_THUMBNAIL',
                {'source_width': width, 'source_height': height,
                 'width': image.width, 'height': image.height},
            )


def _audio_waveform(file):
    width, height = 640, 240
    with default_storage.open(file.object_key, 'rb') as stream:
        with wave.open(stream, 'rb') as audio:
            channels = audio.getnchannels()
            sample_width = audio.getsampwidth()
            frame_count = audio.getnframes()
            frame_rate = audio.getframerate()
            if channels < 1 or sample_width not in {1, 2, 3, 4} or frame_count < 1 or frame_rate < 1:
                raise ValueError('Unsupported WAV encoding.')
            amplitudes = []
            for index in range(width):
                audio.setpos(min((index * frame_count) // width, frame_count - 1))
                frame = audio.readframes(1)[:sample_width]
                if sample_width == 1:
                    value = frame[0] - 128
                    maximum = 128
                else:
                    value = int.from_bytes(frame, 'little', signed=True)
                    maximum = 1 << (sample_width * 8 - 1)
                amplitudes.append(abs(value) / maximum)
    points = ' '.join(
        f'{index},{height / 2 - amplitude * (height / 2 - 12):.1f}'
        for index, amplitude in enumerate(amplitudes)
    )
    mirror = ' '.join(
        f'{index},{height / 2 + amplitude * (height / 2 - 12):.1f}'
        for index, amplitude in reversed(list(enumerate(amplitudes)))
    )
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}">'
        '<rect width="100%" height="100%" fill="#111827"/>'
        f'<polygon points="{points} {mirror}" fill="#38bdf8"/></svg>'
    ).encode()
    return (
        svg, 'image/svg+xml', 'svg', 'AUDIO_WAVEFORM',
        {'duration_ms': round(frame_count * 1000 / frame_rate), 'channels': channels,
         'sample_rate': frame_rate},
    )


def _waveform_svg(amplitudes, *, duration_ms, sample_rate, variant_type):
    width, height = 640, 240
    points = ' '.join(
        f'{index},{height / 2 - amplitude * (height / 2 - 12):.1f}'
        for index, amplitude in enumerate(amplitudes)
    )
    mirror = ' '.join(
        f'{index},{height / 2 + amplitude * (height / 2 - 12):.1f}'
        for index, amplitude in reversed(list(enumerate(amplitudes)))
    )
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}">'
        '<rect width="100%" height="100%" fill="#111827"/>'
        f'<polygon points="{points} {mirror}" fill="#38bdf8"/></svg>'
    ).encode()
    return svg, 'image/svg+xml', 'svg', variant_type, {
        'duration_ms': duration_ms, 'channels': 1, 'sample_rate': sample_rate,
    }


def _copy_private_object(file, destination, max_bytes=None):
    if max_bytes is None:
        max_bytes = settings.PREVIEW_DECODER_MAX_INPUT_BYTES
    copied = 0
    with default_storage.open(file.object_key, 'rb') as source, open(destination, 'wb') as target:
        while True:
            chunk = source.read(64 * 1024)
            if not chunk:
                break
            copied += len(chunk)
            if copied > max_bytes:
                raise ValueError('Preview decoder input exceeds its configured limit.')
            target.write(chunk)


def _pdf_first_page(file):
    executable = shutil.which(settings.PDF_PREVIEW_COMMAND)
    if not executable:
        raise OSError('PDF preview decoder is unavailable.')
    with tempfile.TemporaryDirectory(prefix='blazeflow-pdf-preview-') as directory:
        source = Path(directory) / 'source.pdf'
        output_prefix = Path(directory) / 'first-page'
        _copy_private_object(file, source)
        subprocess.run(
            [executable, '-f', '1', '-l', '1', '-singlefile', '-jpeg',
             '-scale-to-x', str(settings.PREVIEW_MAX_WIDTH), '-scale-to-y', '-1',
             str(source), str(output_prefix)],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            timeout=settings.PREVIEW_DECODER_TIMEOUT_SECONDS,
        )
        rendered = output_prefix.with_suffix('.jpg')
        if not rendered.exists() or rendered.stat().st_size > settings.PREVIEW_DECODER_MAX_OUTPUT_BYTES:
            raise ValueError('PDF decoder returned no usable first page.')
        with Image.open(rendered) as image:
            if image.width * image.height > settings.PREVIEW_MAX_PIXELS:
                raise ValueError('Rendered PDF dimensions exceed PREVIEW_MAX_PIXELS.')
            normalized = image.convert('RGB')
            normalized.thumbnail((settings.PREVIEW_MAX_WIDTH, settings.PREVIEW_MAX_HEIGHT))
            output = io.BytesIO()
            normalized.save(output, format='JPEG', quality=82, optimize=True)
            return output.getvalue(), 'image/jpeg', 'jpg', 'PDF_FIRST_PAGE', {
                'page': 1, 'width': normalized.width, 'height': normalized.height,
            }


def _mp3_waveform(file):
    executable = shutil.which(settings.FFMPEG_COMMAND)
    if not executable:
        raise OSError('Audio preview decoder is unavailable.')
    sample_rate = 8000
    with tempfile.TemporaryDirectory(prefix='blazeflow-audio-preview-') as directory:
        source = Path(directory) / 'source.mp3'
        output = Path(directory) / 'audio.pcm'
        _copy_private_object(file, source)
        subprocess.run(
            [executable, '-v', 'error', '-i', str(source), '-map', 'a:0',
             '-ac', '1', '-ar', str(sample_rate), '-t',
             str(settings.PREVIEW_AUDIO_MAX_SECONDS), '-f', 's16le', str(output)],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            timeout=settings.PREVIEW_DECODER_TIMEOUT_SECONDS,
        )
        if not output.exists() or output.stat().st_size < 2 or output.stat().st_size > settings.PREVIEW_DECODER_MAX_OUTPUT_BYTES:
            raise ValueError('Audio decoder returned no usable samples.')
        pcm = output.read_bytes()
        sample_count = len(pcm) // 2
        amplitudes = []
        for index in range(640):
            offset = min((index * sample_count) // 640, sample_count - 1) * 2
            amplitudes.append(abs(struct.unpack_from('<h', pcm, offset)[0]) / 32768)
        return _waveform_svg(
            amplitudes, duration_ms=round(sample_count * 1000 / sample_rate),
            sample_rate=sample_rate, variant_type='MP3_WAVEFORM',
        )


HQ_PROXY_VARIANT_TYPE = 'VIDEO_PROXY_HQ'
VIDEO_PROXY_VARIANT_TYPE = 'VIDEO_PROXY'
FALLBACK_CARD_VARIANT_TYPE = 'REVIEW_CARD'


class VideoProxyFailed(RuntimeError):
    """The proxy encode for a video failed (ffmpeg error, timeout or output over its cap).

    Raised out of the preview job instead of storing the review-card fallback: a card is not
    something a `<video>` can play, and storing one marked the job done, so the cut sat on
    "may still be generating" forever. Raising lets the outbox retry and then dead-letter
    it, which the review page shows as "Proxy failed — re-render".
    """

    # A proxy encode is expensive and usually fails the same way twice (a timeout, a broken
    # source), so it gets fewer attempts than the outbox default.
    @property
    def max_attempts(self):
        return settings.VIDEO_PROXY_MAX_ATTEMPTS


class ProducedFile:
    """A preview written to a temporary file rather than held in memory.

    A 12-minute proxy is hundreds of MB, too much to read into a worker capped at 2 GB.
    `_store_variant` streams it to storage and then calls `cleanup()`.
    """

    def __init__(self, path, directory):
        self.path = Path(path)
        self.directory = directory

    def cleanup(self):
        shutil.rmtree(self.directory, ignore_errors=True)


def _rate_bits_per_second(rate):
    """'5M' -> 5_000_000, '128k' -> 128_000, '800000' -> 800_000."""
    rate = str(rate).strip()
    units = {'k': 1_000, 'm': 1_000_000, 'g': 1_000_000_000}
    if rate and rate[-1].lower() in units:
        return int(float(rate[:-1]) * units[rate[-1].lower()])
    return int(float(rate))


def file_duration_seconds(file):
    duration_ms = (file.metadata or {}).get('duration_ms')
    try:
        return max(0.0, float(duration_ms) / 1000) if duration_ms else None
    except (TypeError, ValueError):
        return None


def video_proxy_timeout_seconds(file):
    """How long the encoder may run for this cut: scaled with its runtime, never below the floor.

    A fixed 10 minutes could not fit a 12-minute 1080p cut on two cores, so it always timed
    out. With no known duration the floor applies.
    """
    floor = settings.VIDEO_PROXY_TIMEOUT_SECONDS
    duration = file_duration_seconds(file)
    if not duration:
        return floor
    scaled = duration * settings.VIDEO_PROXY_TIMEOUT_PER_SECOND + settings.VIDEO_PROXY_TIMEOUT_MARGIN_SECONDS
    return int(min(max(floor, scaled), settings.VIDEO_PROXY_TIMEOUT_MAX_SECONDS))


def video_proxy_max_output_bytes(file, maxrate):
    """The largest proxy we accept: what the bitrate cap allows for this runtime, plus headroom.

    Never below the configured floor. Without a duration (or a cap) the floor applies.
    """
    floor = settings.VIDEO_PROXY_MAX_OUTPUT_BYTES
    duration = file_duration_seconds(file)
    if not duration or not maxrate:
        return floor
    bits = (_rate_bits_per_second(maxrate) + _rate_bits_per_second(settings.VIDEO_PROXY_AUDIO_BITRATE)) * duration
    return max(floor, int(bits / 8 * settings.VIDEO_PROXY_OUTPUT_HEADROOM))


def _stderr_tail(stderr, limit=2000):
    if not stderr:
        return ''
    text = stderr.decode('utf-8', errors='replace') if isinstance(stderr, bytes) else str(stderr)
    return text.strip()[-limit:]


def _encode_proxy(file, *, max_width, max_height, crf, variant_type, maxrate=None, preset=None):
    preset = preset or settings.VIDEO_PROXY_PRESET
    executable = shutil.which(settings.FFMPEG_COMMAND)
    if not executable:
        raise VideoProxyFailed('Video proxy encoder is unavailable.')
    timeout = video_proxy_timeout_seconds(file)
    max_output = video_proxy_max_output_bytes(file, maxrate)
    directory = tempfile.mkdtemp(prefix='blazeflow-video-proxy-')
    try:
        source = Path(directory) / 'source'
        output = Path(directory) / 'proxy.mp4'
        try:
            _copy_private_object(file, source, max_bytes=settings.VIDEO_PROXY_MAX_INPUT_BYTES)
        except ValueError as exc:
            raise VideoProxyFailed(f'{variant_type} for file {file.id}: {exc}') from exc
        # The box turns with the picture: a 9:16 cut gets 720x1280, not a 404x720 sliver
        # of the landscape box.
        scale = (
            f"scale='if(gt(ih,iw),min({max_height},iw),min({max_width},iw))'"
            f":'if(gt(ih,iw),min({max_width},ih),min({max_height},ih))'"
            ":force_original_aspect_ratio=decrease:flags=lanczos,scale=trunc(iw/2)*2:trunc(ih/2)*2"
        )
        rate = ['-maxrate', maxrate, '-bufsize', _double(maxrate)] if maxrate else []
        threads = video_proxy_thread_args()
        command = [
            executable, '-v', 'error', '-y', '-i', str(source),
            '-vf', scale, '-c:v', 'libx264', '-preset', preset,
            '-crf', str(crf), *rate, *threads, '-pix_fmt', 'yuv420p', '-profile:v', 'high',
            '-force_key_frames', f'expr:gte(t,n_forced*{settings.VIDEO_PROXY_KEYFRAME_SECONDS})',
            '-movflags', '+faststart', '-c:a', 'aac', '-b:a', settings.VIDEO_PROXY_AUDIO_BITRATE,
            '-ac', '2', str(output),
        ]
        started = timezone.now()
        try:
            subprocess.run(
                command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired as exc:
            logger.error(
                '%s encode timed out for file %s after %ss (duration %ss). ffmpeg stderr: %s',
                variant_type, file.id, timeout, file_duration_seconds(file), _stderr_tail(exc.stderr),
            )
            raise VideoProxyFailed(
                f'{variant_type} encode timed out after {timeout}s for file {file.id}.'
            ) from exc
        except subprocess.CalledProcessError as exc:
            tail = _stderr_tail(exc.stderr)
            logger.error(
                '%s encode failed for file %s (exit %s). ffmpeg stderr: %s',
                variant_type, file.id, exc.returncode, tail,
            )
            raise VideoProxyFailed(
                f'{variant_type} encode failed for file {file.id} (ffmpeg exit {exc.returncode}): {tail[-500:]}'
            ) from exc
        if not output.exists() or output.stat().st_size == 0:
            raise VideoProxyFailed(f'{variant_type} encoder returned no usable output for file {file.id}.')
        size = output.stat().st_size
        if size > max_output:
            logger.error('%s for file %s is %s bytes, over its %s byte limit.', variant_type, file.id, size, max_output)
            raise VideoProxyFailed(
                f'{variant_type} output for file {file.id} is {size} bytes, over its {max_output} byte limit.'
            )
        logger.info(
            '%s made for file %s: %s bytes in %ss (limit %ss).',
            variant_type, file.id, size, round((timezone.now() - started).total_seconds()), timeout,
        )
        source.unlink(missing_ok=True)
        produced = ProducedFile(output, directory)
        directory = None  # owned by `produced` now; `_store_variant` cleans it up
        return produced, 'video/mp4', 'mp4', variant_type, {
            'max_width': max_width, 'max_height': max_height, 'crf': crf,
            'preset': preset, **({'maxrate': maxrate} if maxrate else {}),
        }
    finally:
        if directory is not None:
            shutil.rmtree(directory, ignore_errors=True)


def _double(rate):
    """'12M' -> '24M': a VBV buffer of two seconds at the cap."""
    number, unit = rate[:-1], rate[-1]
    return f'{int(float(number) * 2)}{unit}' if unit.isalpha() else str(int(rate) * 2)


def _video_proxy(file):
    return _encode_proxy(
        file, max_width=settings.VIDEO_PROXY_MAX_WIDTH, max_height=settings.VIDEO_PROXY_MAX_HEIGHT,
        crf=settings.VIDEO_PROXY_CRF, variant_type=VIDEO_PROXY_VARIANT_TYPE, maxrate=settings.VIDEO_PROXY_MAXRATE,
    )


def _video_proxy_hq(file):
    return _encode_proxy(
        file, max_width=settings.VIDEO_PROXY_HQ_MAX_WIDTH, max_height=settings.VIDEO_PROXY_HQ_MAX_HEIGHT,
        crf=settings.VIDEO_PROXY_HQ_CRF, variant_type=HQ_PROXY_VARIANT_TYPE, maxrate=settings.VIDEO_PROXY_HQ_MAXRATE,
        preset=settings.VIDEO_PROXY_HQ_PRESET,
    )


def _video_size(file):
    """(width, height) as displayed, or None when it cannot be read."""
    executable = shutil.which(settings.FFPROBE_COMMAND)
    if not executable:
        return None
    with tempfile.TemporaryDirectory(prefix='blazeflow-probe-') as directory:
        source = Path(directory) / 'source'
        _copy_private_object(file, source, max_bytes=settings.VIDEO_PROXY_MAX_INPUT_BYTES)
        result = subprocess.run(
            [executable, '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
             '-of', 'csv=p=0', str(source)],
            capture_output=True, text=True, timeout=60,
        )
    try:
        width, height = (int(v) for v in result.stdout.strip().split(',')[:2])
    except ValueError:
        return None
    return width, height


def wants_hq_proxy(file):
    if not (settings.VIDEO_PROXY_HQ_ENABLED and (file.mime_type or '').startswith('video/')):
        return False
    # On a small server a 1080p encode of a long cut takes longer than the cut itself and
    # starves the review proxies queued behind it; over the limit the player offers 720p.
    limit = settings.VIDEO_PROXY_HQ_MAX_SECONDS
    if limit > 0 and (file_duration_seconds(file) or 0) > limit:
        return False
    size = _video_size(file)
    if not size:
        return False
    # Worth a second encode only when the source has more detail than the 720p proxy keeps.
    long_side, short_side = max(size), min(size)
    return long_side > settings.VIDEO_PROXY_MAX_WIDTH or short_side > settings.VIDEO_PROXY_MAX_HEIGHT


def _video_poster(file):
    """A single frame, for showing a video in a list without fetching the video.

    Seeks a second in so the still is not the black frame most cuts open on, and falls
    back to the first frame for anything shorter than that.
    """
    executable = shutil.which(settings.FFMPEG_COMMAND)
    if not executable:
        raise OSError('Video poster encoder is unavailable.')
    with tempfile.TemporaryDirectory(prefix='blazeflow-video-poster-') as directory:
        source = Path(directory) / 'source'
        output = Path(directory) / 'poster.jpg'
        _copy_private_object(file, source, max_bytes=settings.VIDEO_PROXY_MAX_INPUT_BYTES)
        scale = (
            f"scale='min({settings.PREVIEW_MAX_WIDTH},iw)':'min({settings.PREVIEW_MAX_HEIGHT},ih)'"
            ':force_original_aspect_ratio=decrease'
        )
        # No `check=True`: seeking a second into a clip shorter than that is a failure
        # ffmpeg reports by exit code, and raising on it would skip the fallback to the
        # first frame — which is the one that works for short cuts.
        for seek in ('00:00:01', '00:00:00'):
            output.unlink(missing_ok=True)
            result = subprocess.run(
                [executable, '-v', 'error', '-y', '-ss', seek, '-i', str(source),
                 '-frames:v', '1', '-vf', scale, '-q:v', '4', str(output)],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                timeout=settings.VIDEO_PROXY_TIMEOUT_SECONDS,
            )
            if result.returncode == 0 and output.exists() and output.stat().st_size:
                content = output.read_bytes()
                # The frame's own dimensions, so a card can size its box to the media
                # instead of cropping it into a fixed rectangle.
                with Image.open(io.BytesIO(content)) as frame:
                    width, height = frame.size
                return content, 'image/jpeg', 'jpg', POSTER_VARIANT_TYPE, {
                    'width': width, 'height': height,
                    'max_width': settings.PREVIEW_MAX_WIDTH,
                    'max_height': settings.PREVIEW_MAX_HEIGHT,
                }
        raise ValueError('Video poster encoder returned no usable output.')


def _probe_duration_ms(file):
    """Milliseconds of runtime, read once while the preview is being made.

    Stored on the `File` rather than on a variant: a duration belongs to the media, and an
    audio file has one without ever producing a poster.
    """
    executable = shutil.which(settings.FFPROBE_COMMAND)
    if not executable:
        return None
    with tempfile.TemporaryDirectory(prefix='blazeflow-probe-') as directory:
        source = Path(directory) / 'source'
        _copy_private_object(file, source, max_bytes=settings.VIDEO_PROXY_MAX_INPUT_BYTES)
        result = subprocess.run(
            [executable, '-v', 'error', '-show_entries', 'format=duration',
             '-of', 'default=noprint_wrappers=1:nokey=1', str(source)],
            capture_output=True, text=True, timeout=settings.VIDEO_PROXY_TIMEOUT_SECONDS,
        )
    if not result or result.returncode != 0:
        return None
    try:
        seconds = float(result.stdout.strip())
    except ValueError:
        return None
    return round(seconds * 1000) if seconds > 0 else None


def _preview_content(file):
    # A video gets its proxy or nothing: the review card is not playable, and storing it
    # would mark the job done and leave the cut on "may still be generating" for good.
    if file.mime_type.startswith('video/'):
        return _video_proxy(file)
    try:
        if file.mime_type.startswith('image/'):
            return _image_thumbnail(file)
        if file.mime_type == 'audio/wav':
            return _audio_waveform(file)
        if file.mime_type == 'application/pdf':
            return _pdf_first_page(file)
        if file.mime_type in {'audio/mpeg', 'audio/mp3'}:
            return _mp3_waveform(file)
    except (
        UnidentifiedImageError, Image.DecompressionBombError, OSError,
        ValueError, EOFError, wave.Error, subprocess.SubprocessError,
    ):
        pass
    return _review_card(file)


def _store_variant(file, produce, *, types):
    """Creates one variant for `file`, or returns the existing one of `types`.

    The store-then-check order matters: the content is written to storage before the
    transaction, so a racing worker cannot see a half-written object, and the loser of the
    race deletes what it wrote.
    """
    existing = FileVariant.objects.filter(
        file=file, metadata__variant_type__in=types, deleted_at__isnull=True,
    ).first()
    if existing:
        return existing
    content, mime_type, extension, variant_type, metadata = produce(file)
    suffix = '' if variant_type in PREVIEW_VARIANT_TYPES else '.hq' if variant_type == HQ_PROXY_VARIANT_TYPE else '.poster'
    object_key = f'{Path(file.object_key).parent}/previews/{file.id}{suffix}.{extension}'
    if isinstance(content, ProducedFile):
        try:
            digest_state = hashlib.sha256()
            with open(content.path, 'rb') as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b''):
                    digest_state.update(chunk)
            digest = digest_state.hexdigest()
            size_bytes = content.path.stat().st_size
            with open(content.path, 'rb') as handle:
                stored_key = default_storage.save(object_key, DjangoFile(handle))
        finally:
            content.cleanup()
    else:
        digest = hashlib.sha256(content).hexdigest()
        size_bytes = len(content)
        stored_key = default_storage.save(object_key, ContentFile(content))
    now = timezone.now()
    try:
        with transaction.atomic():
            locked = File.objects.select_for_update().get(
                id=file.id, status=FileStatus.READY, deleted_at__isnull=True,
            )
            existing = FileVariant.objects.filter(
                file=locked, metadata__variant_type__in=types, deleted_at__isnull=True,
            ).first()
            if existing:
                default_storage.delete(stored_key)
                return existing
            return FileVariant.objects.create(
                id=uuid.uuid4(), file=locked, storage_backend=locked.storage_backend,
                object_key=stored_key,
                original_name=f'{locked.original_name}.preview.{extension}',
                mime_type=mime_type, size_bytes=size_bytes, checksum=digest,
                checksum_algorithm='sha256',
                metadata={'variant_type': variant_type, **metadata},
                status=FileStatus.READY, created_at=now, updated_at=now,
            )
    except Exception:
        default_storage.delete(stored_key)
        raise


def generate_preview(*, file_id):
    """Ensures a file has its preview, and — for video — a poster to show in lists.

    The poster is best-effort: a cut whose frame cannot be extracted still gets its proxy,
    because failing the whole event would leave the file unplayable over a missing
    thumbnail.
    """
    file = _load_job_file(file_id, status=FileStatus.READY)
    if file is None:
        return None

    # The poster goes first, before the proxy. Extracting one frame takes a moment;
    # transcoding the whole cut can take minutes, and the thumbnail every list is waiting
    # on has no reason to queue behind it.
    # Both of these enrich the file; neither is allowed to cost it its preview. The catch
    # is deliberately broad: a poster or a duration is worth having, but not at the price of
    # a file that cannot be opened because extracting one threw something unforeseen. Both
    # log, because a silent pass leaves a card waiting with nothing to explain it.
    if file.mime_type.startswith('video/'):
        try:
            _store_variant(file, _video_poster, types=(POSTER_VARIANT_TYPE,))
        except Exception:
            logger.warning('Poster generation failed for file %s', file.id, exc_info=True)

    if file.mime_type.startswith(('video/', 'audio/')) and not (file.metadata or {}).get('duration_ms'):
        try:
            duration_ms = _probe_duration_ms(file)
        except Exception:
            logger.warning('Duration probe failed for file %s', file.id, exc_info=True)
            duration_ms = None
        if duration_ms:
            file.metadata = {**(file.metadata or {}), 'duration_ms': duration_ms}
            File.objects.filter(id=file.id).update(metadata=file.metadata, updated_at=timezone.now())

    if file.mime_type.startswith('video/'):
        # Only a real proxy counts for a video: a review card left by an older failed run
        # must not satisfy the "already has a preview" check, or a re-render is a no-op.
        preview = _store_variant(file, _preview_content, types=(VIDEO_PROXY_VARIANT_TYPE,))
        retire_fallback_cards(file)
    else:
        preview = _store_variant(file, _preview_content, types=PREVIEW_VARIANT_TYPES)
    # The 1080p proxy is a separate, low-priority job queued only once the 720p one exists,
    # so the cut is playable first and an HQ timeout cannot fail or block this job.
    if file.mime_type.startswith('video/'):
        try:
            if wants_hq_proxy(file):
                _write_file_event(file_id=file.id, topic=HQ_PREVIEW_TOPIC)
        except Exception:
            logger.warning('Could not queue the HQ proxy for file %s', file.id, exc_info=True)
    return preview


def video_fallback_cards(file_ids=None):
    """Live review-card variants on video files: what a failed proxy used to leave behind."""
    cards = FileVariant.objects.filter(
        metadata__variant_type=FALLBACK_CARD_VARIANT_TYPE, deleted_at__isnull=True,
        file__mime_type__startswith='video/',
    )
    if file_ids is not None:
        cards = cards.filter(file_id__in=file_ids)
    return cards


def retire_fallback_cards(file):
    """Soft-deletes a video's review-card variants. The rows (and objects) stay for the record."""
    now = timezone.now()
    return video_fallback_cards([file.id]).update(deleted_at=now, updated_at=now)


def handle_security_scan_event(event):
    return process_security_scan(file_id=event.payload['file_id'])


class HQProxyFailed(VideoProxyFailed):
    """An optional HQ encode failed: one attempt, then dead-letter. The 720p proxy is unaffected."""

    max_attempts = 1


def generate_hq_preview(*, file_id):
    file = _load_job_file(file_id, status=FileStatus.READY)
    if file is None or not wants_hq_proxy(file):
        return None
    try:
        return _store_variant(file, _video_proxy_hq, types=(HQ_PROXY_VARIANT_TYPE,))
    except VideoProxyFailed as exc:
        raise HQProxyFailed(str(exc)) from exc


def handle_hq_preview_event(event):
    return generate_hq_preview(file_id=event.payload['file_id'])


def handle_preview_event(event):
    return generate_preview(file_id=event.payload['file_id'])
