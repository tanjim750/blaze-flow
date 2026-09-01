import hashlib
import html
import io
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
PREVIEW_TOPIC = 'file.preview.requested'


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


def scanner_backend():
    scanner_class = import_string(settings.FILE_SECURITY_SCANNER)
    return scanner_class()


def enqueue_file_event(*, file, topic):
    now = timezone.now()
    return OutboxEvent.objects.get_or_create(
        deduplication_key=f'{topic}:{file.id}',
        defaults={
            'id': uuid.uuid4(), 'topic': topic, 'aggregate_type': 'file',
            'aggregate_id': str(file.id), 'payload': {'file_id': str(file.id)},
            'status': OutboxEventStatus.PENDING, 'available_at': now,
            'created_at': now, 'updated_at': now,
        },
    )[0]


def process_security_scan(*, file_id):
    file = File.objects.get(id=file_id, deleted_at__isnull=True)
    scan = FileSecurityScan.objects.get(file=file)
    if scan.status in {FileSecurityScanStatus.CLEAN, FileSecurityScanStatus.INFECTED}:
        return scan
    scanner = scanner_backend()
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


def _copy_private_object(file, destination):
    copied = 0
    with default_storage.open(file.object_key, 'rb') as source, open(destination, 'wb') as target:
        while True:
            chunk = source.read(64 * 1024)
            if not chunk:
                break
            copied += len(chunk)
            if copied > settings.PREVIEW_DECODER_MAX_INPUT_BYTES:
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


def _preview_content(file):
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


def generate_preview(*, file_id):
    file = File.objects.get(id=file_id, status=FileStatus.READY, deleted_at__isnull=True)
    existing = FileVariant.objects.filter(
        file=file, metadata__variant_type__in=[
            'REVIEW_CARD', 'IMAGE_THUMBNAIL', 'AUDIO_WAVEFORM',
            'PDF_FIRST_PAGE', 'MP3_WAVEFORM',
        ], deleted_at__isnull=True,
    ).first()
    if existing:
        return existing
    content, mime_type, extension, variant_type, metadata = _preview_content(file)
    digest = hashlib.sha256(content).hexdigest()
    object_key = f'{Path(file.object_key).parent}/previews/{file.id}.{extension}'
    stored_key = default_storage.save(object_key, ContentFile(content))
    now = timezone.now()
    try:
        with transaction.atomic():
            file = File.objects.select_for_update().get(
                id=file_id, status=FileStatus.READY, deleted_at__isnull=True,
            )
            existing = FileVariant.objects.filter(
                file=file, metadata__variant_type__in=[
                    'REVIEW_CARD', 'IMAGE_THUMBNAIL', 'AUDIO_WAVEFORM',
                    'PDF_FIRST_PAGE', 'MP3_WAVEFORM',
                ], deleted_at__isnull=True,
            ).first()
            if existing:
                default_storage.delete(stored_key)
                return existing
            return FileVariant.objects.create(
                id=uuid.uuid4(), file=file, storage_backend=file.storage_backend,
                object_key=stored_key,
                original_name=f'{file.original_name}.preview.{extension}',
                mime_type=mime_type, size_bytes=len(content), checksum=digest,
                checksum_algorithm='sha256',
                metadata={'variant_type': variant_type, **metadata},
                status=FileStatus.READY, created_at=now, updated_at=now,
            )
    except Exception:
        default_storage.delete(stored_key)
        raise


def handle_security_scan_event(event):
    return process_security_scan(file_id=event.payload['file_id'])


def handle_preview_event(event):
    return generate_preview(file_id=event.payload['file_id'])
