"""Direct browser-to-object-storage uploads (Cloudflare R2 / any S3-compatible bucket).

Lifecycle::

    initialize  -> quota reserved, generated workspace-scoped key, presigned PUT (small)
                   or CreateMultipartUpload (large)
    part_urls   -> short-lived presigned UploadPart URLs, issued lazily in batches
    complete    -> CompleteMultipartUpload (server-listed ETags, not the client's),
                   HEAD size check, one streaming read for SHA-256 + byte-signature type
                   check, then the same File/ProjectFile/scan records as a form upload
    cancel      -> AbortMultipartUpload / delete object, reservation released
    expire      -> management command ``expire_direct_uploads``

Only enabled when ``STORAGE_DRIVER=s3`` and ``DIRECT_UPLOADS_ENABLED`` is true. The browser
never sees credentials; every URL is scoped to one method, bucket and key and is short-lived.
"""
import hashlib
import io
import uuid
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from app.models import DirectUpload, DirectUploadMode, DirectUploadState, Workspace

from .media import detect_media_type
from .project_files import ProjectFileError, create_project_file_records
from .review_assets import ZIP_ALIASES, ZIP_MIME_TYPE, detect_attachment_type, detect_zip_type
from .subscriptions import enforce_workspace_storage_limit

MIN_PART_SIZE = 5 * 1024 * 1024
MAX_PARTS = 10_000
MAX_PART_URLS_PER_REQUEST = 100
ALIASES = {'image/jpg': 'image/jpeg', 'audio/x-wav': 'audio/wav', 'text/rtf': 'application/rtf', **ZIP_ALIASES}
ZIP_RANGE_BUFFER = 1024 * 1024


class DirectUploadError(Exception):
    """``retryable`` is False when sending the same bytes again would fail the same way."""

    def __init__(self, message, retryable=True):
        super().__init__(message)
        self.retryable = retryable


class _RangeReader(io.RawIOBase):
    """A seekable, read-only view of one bucket object using ranged GETs.

    Lets ``zipfile`` read just the central directory of an archive of any size, instead of
    spooling the whole object to memory or disk.
    """

    def __init__(self, client, bucket, key, size):
        self.client, self.bucket, self.key, self.size, self.pos = client, bucket, key, size, 0

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=io.SEEK_SET):
        base = {io.SEEK_SET: 0, io.SEEK_CUR: self.pos, io.SEEK_END: self.size}[whence]
        self.pos = max(0, base + offset)
        return self.pos

    def readinto(self, buffer):
        if self.pos >= self.size or not len(buffer):
            return 0
        end = min(self.size, self.pos + len(buffer)) - 1
        body = self.client.get_object(Bucket=self.bucket, Key=self.key, Range=f'bytes={self.pos}-{end}')['Body']
        try:
            data = body.read()
        finally:
            body.close()
        data = data[:len(buffer)]
        buffer[:len(data)] = data
        self.pos += len(data)
        return len(data)


def _zip_type(client, bucket, key, size):
    reader = io.BufferedReader(_RangeReader(client, bucket, key, size), buffer_size=ZIP_RANGE_BUFFER)
    return detect_zip_type(reader)


def direct_uploads_enabled():
    return settings.STORAGE_DRIVER == 's3' and getattr(settings, 'DIRECT_UPLOADS_ENABLED', False)


_CLIENT = None


def _client():
    """A SigV4 S3 client for the configured bucket (R2 accepts only SigV4 presigned URLs).

    Built from the same settings django-storages uses; credentials stay server-side.
    """
    global _CLIENT
    if settings.STORAGE_DRIVER != 's3':
        raise DirectUploadError('Direct uploads need S3-compatible storage.')
    if _CLIENT is None:
        import boto3
        from botocore.config import Config
        _CLIENT = boto3.client(
            's3', endpoint_url=settings.AWS_S3_ENDPOINT_URL, region_name=settings.AWS_S3_REGION_NAME,
            aws_access_key_id=settings.AWS_ACCESS_KEY_ID, aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
            config=Config(signature_version='s3v4', s3={'addressing_style': settings.AWS_S3_ADDRESSING_STYLE}),
        )
    return _CLIENT, settings.AWS_STORAGE_BUCKET_NAME


def _expires():
    return settings.DIRECT_UPLOAD_URL_EXPIRE_SECONDS


def choose_part_size(size):
    part = max(MIN_PART_SIZE, settings.DIRECT_UPLOAD_PART_SIZE)
    while -(-size // part) > MAX_PARTS:
        part *= 2
    return part


def _presign(client, method, **params):
    return client.generate_presigned_url(method, Params=params, ExpiresIn=_expires())


def initialize(*, workspace, user, membership, client_team, project, folder, task_stage, name, size, content_type, sha256=''):
    if not direct_uploads_enabled():
        raise DirectUploadError('Direct uploads are not enabled.')
    if size <= 0:
        raise ProjectFileError('The file is empty.')
    if size > settings.MAX_PROJECT_FILE_BYTES:
        limit_mb = settings.MAX_PROJECT_FILE_BYTES / (1024 * 1024)
        raise ProjectFileError(f'The file is {size / (1024 * 1024):.0f} MB, over the {limit_mb:.0f} MB upload limit.')
    clean_name = Path(name or '').name or 'file'
    declared = ALIASES.get((content_type or '').lower(), (content_type or '').lower()) or 'application/octet-stream'
    object_key = f'workspaces/{workspace.id}/assets/{uuid.uuid4()}/{clean_name}'
    client, bucket = _client()
    multipart = size > settings.DIRECT_UPLOAD_SINGLE_PUT_MAX_BYTES
    with transaction.atomic():
        # Under the workspace row lock, so concurrent initializes cannot oversubscribe.
        enforce_workspace_storage_limit(workspace=workspace, additional_bytes=size, lock=True)
        upload = DirectUpload.objects.create(
            workspace=workspace, created_by_user=user, membership=membership, client_team=client_team,
            project=project, folder=folder, task_stage=task_stage, object_key=object_key,
            original_name=clean_name, declared_mime_type=declared, expected_size=size, reserved_bytes=size,
            mode=DirectUploadMode.MULTIPART if multipart else DirectUploadMode.SINGLE,
            part_size=choose_part_size(size) if multipart else None,
            client_sha256=(sha256 or '')[:64].lower(),
            expires_at=timezone.now() + timedelta(seconds=settings.DIRECT_UPLOAD_TTL_SECONDS),
        )
    if multipart:
        try:
            created = client.create_multipart_upload(Bucket=bucket, Key=object_key, ContentType=declared)
        except Exception as exc:
            _fail(upload, f'Could not start the upload: {exc.__class__.__name__}')
            raise DirectUploadError('Storage refused to start the upload. Try again.') from exc
        upload.multipart_upload_id = created['UploadId']
        upload.save(update_fields=['multipart_upload_id', 'updated_at'])
        return upload, {}
    url = _presign(client, 'put_object', Bucket=bucket, Key=object_key, ContentType=declared)
    return upload, {'url': url, 'method': 'PUT', 'headers': {'Content-Type': declared}}


def part_urls(upload, part_numbers):
    _require_open(upload)
    if upload.mode != DirectUploadMode.MULTIPART:
        raise DirectUploadError('This upload is a single PUT.')
    total = -(-upload.expected_size // upload.part_size)
    numbers = sorted({int(n) for n in part_numbers})[:MAX_PART_URLS_PER_REQUEST]
    if not numbers or numbers[0] < 1 or numbers[-1] > total:
        raise DirectUploadError(f'Part numbers must be between 1 and {total}.')
    client, bucket = _client()
    return [
        {'part_number': n, 'url': _presign(client, 'upload_part', Bucket=bucket, Key=upload.object_key, UploadId=upload.multipart_upload_id, PartNumber=n)}
        for n in numbers
    ]


def _require_open(upload):
    if upload.state != DirectUploadState.INITIALIZED:
        raise DirectUploadError(f'This upload is {upload.get_state_display().lower()}.')
    if upload.expires_at <= timezone.now():
        raise DirectUploadError('This upload has expired. Start it again.')


def _listed_parts(client, bucket, upload):
    parts, marker = [], 0
    while True:
        page = client.list_parts(Bucket=bucket, Key=upload.object_key, UploadId=upload.multipart_upload_id, PartNumberMarker=marker)
        parts += [{'PartNumber': p['PartNumber'], 'ETag': p['ETag'], 'Size': p['Size']} for p in page.get('Parts', [])]
        if not page.get('IsTruncated'):
            return parts
        marker = page['NextPartNumberMarker']


def _delete_object(client, bucket, upload):
    try:
        if upload.mode == DirectUploadMode.MULTIPART and upload.multipart_upload_id:
            client.abort_multipart_upload(Bucket=bucket, Key=upload.object_key, UploadId=upload.multipart_upload_id)
    except Exception:
        pass
    try:
        client.delete_object(Bucket=bucket, Key=upload.object_key)
    except Exception:
        pass


def _fail(upload, message, state=DirectUploadState.FAILED):
    upload.state = state
    upload.error = message[:2000]
    upload.save(update_fields=['state', 'error', 'updated_at'])


def _scan_object(client, bucket, key):
    """One streaming read: SHA-256 of every byte plus the leading bytes for type detection.

    Constant memory and no size cap; ZIP contents are inspected separately with ranged reads.
    """
    body = client.get_object(Bucket=bucket, Key=key)['Body']
    digest, header, size = hashlib.sha256(), b'', 0
    try:
        for chunk in iter(lambda: body.read(1024 * 1024), b''):
            if len(header) < 32:
                header += chunk[:32 - len(header)]
            digest.update(chunk)
            size += len(chunk)
        return digest.hexdigest(), header, size
    finally:
        body.close()


def complete(upload):
    """Idempotent: a retried complete returns the ProjectFile already created."""
    if upload.state == DirectUploadState.COMPLETED and upload.project_file_id:
        return upload.project_file
    with transaction.atomic():
        locked = DirectUpload.objects.select_for_update().get(id=upload.id)
        if locked.state == DirectUploadState.COMPLETED and locked.project_file_id:
            return locked.project_file
        _require_open(locked)
        locked.state = DirectUploadState.FINALIZING
        locked.save(update_fields=['state', 'updated_at'])
    upload = locked
    client, bucket = _client()
    try:
        if upload.mode == DirectUploadMode.MULTIPART:
            parts = _listed_parts(client, bucket, upload)
            if sum(p['Size'] for p in parts) != upload.expected_size:
                raise DirectUploadError('Some parts are missing. Retry the upload.')
            client.complete_multipart_upload(
                Bucket=bucket, Key=upload.object_key, UploadId=upload.multipart_upload_id,
                MultipartUpload={'Parts': [{'PartNumber': p['PartNumber'], 'ETag': p['ETag']} for p in sorted(parts, key=lambda p: p['PartNumber'])]},
            )
        head = client.head_object(Bucket=bucket, Key=upload.object_key)
        if int(head['ContentLength']) != upload.expected_size:
            raise DirectUploadError('The stored file is not the size that was announced.')
        checksum, header, read_size = _scan_object(client, bucket, upload.object_key)
        if read_size != upload.expected_size:
            raise DirectUploadError('The stored file is not the size that was announced.')
        if header.startswith(b'PK\x03\x04'):
            detected = _zip_type(client, bucket, upload.object_key, read_size)
        else:
            detected = detect_attachment_type(header) or detect_media_type(header)
        declared = upload.declared_mime_type
        if detected == ZIP_MIME_TYPE and declared == 'application/octet-stream':
            declared = ZIP_MIME_TYPE  # some browsers send no type for .zip
        if detected is None or declared != detected:
            raise DirectUploadError('The file signature does not match a supported type.', retryable=False)
        if upload.client_sha256 and upload.client_sha256 != checksum:
            raise DirectUploadError('The file changed in transit (checksum mismatch). Retry the upload.')
        project_file = create_project_file_records(
            workspace=upload.workspace, client_team=upload.client_team, project=upload.project, folder=upload.folder,
            membership=upload.membership, task_stage=upload.task_stage, object_key=upload.object_key,
            name=upload.original_name, mime_type=detected, size=upload.expected_size, checksum=checksum,
            exclude_reservation_id=upload.id,
        )
    except Exception as exc:
        _delete_object(client, bucket, upload)
        _fail(upload, str(exc) or exc.__class__.__name__)
        if isinstance(exc, (DirectUploadError, ProjectFileError)):
            raise
        from .subscriptions import SubscriptionError
        if isinstance(exc, SubscriptionError):
            raise
        raise DirectUploadError('The upload could not be finalized.') from exc
    upload.state = DirectUploadState.COMPLETED
    upload.project_file = project_file
    upload.error = ''
    upload.save(update_fields=['state', 'project_file', 'error', 'updated_at'])
    return project_file


def cancel(upload, state=DirectUploadState.CANCELLED):
    if upload.state in (DirectUploadState.COMPLETED, DirectUploadState.CANCELLED, DirectUploadState.EXPIRED):
        return upload
    client, bucket = _client()
    _delete_object(client, bucket, upload)
    _fail(upload, '', state=state)
    return upload


def expire_stale(now=None):
    now = now or timezone.now()
    count = 0
    for upload in DirectUpload.objects.filter(state__in=[DirectUploadState.INITIALIZED, DirectUploadState.FINALIZING], expires_at__lte=now):
        cancel(upload, state=DirectUploadState.EXPIRED)
        count += 1
    return count
