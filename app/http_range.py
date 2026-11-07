"""HTTP byte-range support for the file-serving views.

Django's ``FileResponse`` ignores ``Range``: asked for 1 KB it sends the whole file with a
200. A browser's ``<video>`` element treats that as "this resource cannot be seeked" and
either refuses to jump or re-downloads from the start, which is why the review player's
timecode chips and markers appeared to do nothing on anything but a fully cached proxy.

``ranged_file_response`` is the single place every file view now goes through. It
answers a single ``bytes=`` range with ``206 Partial Content``, an unsatisfiable one with
``416``, and otherwise the full body with ``Accept-Ranges: bytes`` so the browser knows
it may ask for ranges next time. ``HEAD`` gets the same headers and no body.

It deliberately does nothing about permissions. Callers run every permission and
existence check first and call this last, so no file I/O happens for a request that is
going to be refused.

For S3-compatible storage (including Cloudflare R2), it bypasses ``storage.open()`` and
streams ``GetObject`` directly. ``django-storages`` implements seekability by downloading
the complete object to a temporary file, which makes otherwise-correct byte ranges slow.
"""
import re

from django.conf import settings
from django.core.files.storage import default_storage
from django.http import FileResponse, HttpResponse, HttpResponseRedirect, StreamingHttpResponse
from django.utils.http import content_disposition_header

CHUNK_SIZE = 64 * 1024
_RANGE_RE = re.compile(r'^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$', re.IGNORECASE)


class RangeNotSatisfiable(Exception):
    pass


def parse_range(header, size):
    """Turns a ``Range`` header into an inclusive ``(start, end)`` pair, or ``None``.

    ``None`` means "serve the whole file": no header, a syntax we do not understand, a
    multi-range request (RFC 9110 lets a server ignore those) or a non-byte unit.
    Raises ``RangeNotSatisfiable`` when the range is well formed but lies outside the file.
    """
    if not header:
        return None
    if ',' in header:
        return None
    match = _RANGE_RE.match(header)
    if not match:
        return None
    first, last = match.groups()
    if first == '' and last == '':
        return None
    if first == '':
        # Suffix range: the final N bytes.
        suffix = int(last)
        if suffix == 0 or size == 0:
            raise RangeNotSatisfiable
        return max(0, size - suffix), size - 1
    start = int(first)
    if last != '' and int(last) < start:
        return None
    if start >= size:
        raise RangeNotSatisfiable
    end = int(last) if last != '' else size - 1
    return start, min(end, size - 1)


def requested_range_start(request):
    """The first byte a request asks for, or 0. Lets callers audit a download once.

    A browser playing or resuming a file sends many ranged requests; only the one that
    starts at the beginning represents someone opening the file.
    """
    match = _RANGE_RE.match(request.META.get('HTTP_RANGE', '') or '')
    if match and match.group(1):
        return int(match.group(1))
    return 0


def is_initial_request(request):
    """True for a GET that starts at byte 0 — the request worth recording in the audit log."""
    return request.method != 'HEAD' and requested_range_start(request) == 0


def _etag_for(checksum):
    return f'"{checksum}"' if checksum else None


def _iter_range(handle, start, length):
    try:
        handle.seek(start)
        remaining = length
        while remaining > 0:
            chunk = handle.read(min(CHUNK_SIZE, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk
    finally:
        handle.close()


def _iter_stream(handle, length):
    """Streams an already-positioned remote body without trying to seek it.

    ``django-storages`` makes an S3/R2 file seekable by downloading the complete object to
    a temporary file first. That defeats HTTP Range for video: asking for one megabyte of
    an 88 MB proxy waits for all 88 MB. An S3 ``GetObject`` body is already positioned at
    the requested range, so it must be read directly.
    """
    try:
        remaining = length
        while remaining > 0:
            chunk = handle.read(min(CHUNK_SIZE, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk
    finally:
        handle.close()


def _s3_object_body(storage, object_key, byte_range=None):
    """Returns a streaming S3-compatible body, or ``None`` for non-S3 storage.

    Cloudflare R2 exposes the S3 ``GetObject`` API. Duck-typing these two public storage
    attributes keeps local ``FileSystemStorage`` and test storages on the existing path,
    while avoiding a hard dependency from this generic response helper to one backend.
    """
    connection = getattr(storage, 'connection', None)
    client = getattr(getattr(connection, 'meta', None), 'client', None)
    bucket_name = getattr(storage, 'bucket_name', None)
    get_object = getattr(client, 'get_object', None)
    if not bucket_name or not callable(get_object):
        return None
    params = {'Bucket': bucket_name, 'Key': object_key}
    if byte_range is not None:
        start, end = byte_range
        params['Range'] = f'bytes={start}-{end}'
    result = get_object(**params)
    return result['Body']


def _common_headers(response, *, etag, filename, as_attachment, cache_control):
    response['Accept-Ranges'] = 'bytes'
    if etag:
        response['ETag'] = etag
    if filename or as_attachment:
        disposition = content_disposition_header(as_attachment, filename or '')
        if disposition:
            response['Content-Disposition'] = disposition
    if cache_control:
        response['Cache-Control'] = cache_control


def _s3_client_and_bucket(storage):
    connection = getattr(storage, 'connection', None)
    client = getattr(getattr(connection, 'meta', None), 'client', None)
    bucket_name = getattr(storage, 'bucket_name', None)
    if not bucket_name or not callable(getattr(client, 'generate_presigned_url', None)):
        return None, None
    return client, bucket_name


def redirect_expiry_seconds(as_attachment):
    """Downloads only need to start before expiry; inline media keeps seeking on the same URL."""
    if as_attachment:
        return int(getattr(settings, 'FILE_DOWNLOAD_REDIRECT_EXPIRE_SECONDS', 900))
    return int(getattr(settings, 'FILE_STREAM_REDIRECT_EXPIRE_SECONDS', 3600))


def presigned_redirect_response(
    storage, object_key, *, content_type, filename=None, as_attachment=False,
):
    """A 302 to a short-lived presigned GET on the bucket, or ``None`` for non-S3 storage.

    Streaming large files through Django ties up a gunicorn worker/thread for the whole
    transfer: a handful of slow 200 MB+ range downloads exhausted every worker and took the
    site (and /api/health/) down. After the caller's permission checks, we hand the browser
    a signed R2 URL instead. R2 answers ``Range``/``206`` itself, so video seeking works
    unchanged. ``Content-Type`` and ``Content-Disposition`` are pinned through the signed
    ``response-*`` overrides so an attachment stays an attachment and a stored type is never
    re-sniffed into something the browser would run.
    """
    if not getattr(settings, 'FILE_DOWNLOAD_REDIRECT_ENABLED', True):
        return None
    client, bucket_name = _s3_client_and_bucket(storage)
    if client is None:
        return None
    params = {
        'Bucket': bucket_name,
        'Key': object_key,
        'ResponseContentType': content_type or 'application/octet-stream',
        'ResponseCacheControl': 'private, no-store',
    }
    disposition = content_disposition_header(as_attachment, filename or '')
    if disposition:
        params['ResponseContentDisposition'] = disposition
    url = client.generate_presigned_url(
        'get_object', Params=params,
        ExpiresIn=redirect_expiry_seconds(as_attachment),
    )
    response = HttpResponseRedirect(url)
    # The signed URL is per-request and expires; never let a proxy or the browser reuse it.
    response['Cache-Control'] = 'private, no-store'
    response['Referrer-Policy'] = 'no-referrer'
    return response


def ranged_file_response(
    request, object_key, *, content_type, filename=None, as_attachment=False,
    checksum=None, storage=None, object_size=None, cache_control=None,
):
    storage = storage or default_storage
    if request.method in ('GET', 'HEAD'):
        redirect = presigned_redirect_response(
            storage, object_key, content_type=content_type, filename=filename,
            as_attachment=as_attachment,
        )
        if redirect is not None:
            return redirect
    # Every File/FileVariant row already records this. Supplying it avoids an extra R2
    # HEAD request after the caller has checked that the private object still exists.
    size = object_size if object_size is not None else storage.size(object_key)
    etag = _etag_for(checksum)
    content_type = content_type or 'application/octet-stream'

    header = request.META.get('HTTP_RANGE')
    if_range = request.META.get('HTTP_IF_RANGE')
    if header and if_range is not None and (etag is None or if_range.strip() != etag):
        # The client's copy is stale (or we cannot tell): RFC 9110 says send it all.
        header = None

    try:
        byte_range = parse_range(header, size)
    except RangeNotSatisfiable:
        response = HttpResponse(status=416, content_type=content_type)
        response['Content-Range'] = f'bytes */{size}'
        _common_headers(
            response, etag=etag, filename=None, as_attachment=False,
            cache_control=cache_control,
        )
        return response

    if byte_range is None:
        if request.method == 'HEAD':
            response = HttpResponse(content_type=content_type)
            response['Content-Length'] = str(size)
            _common_headers(
                response, etag=etag, filename=filename, as_attachment=as_attachment,
                cache_control=cache_control,
            )
            return response
        remote_body = _s3_object_body(storage, object_key)
        if remote_body is not None:
            response = StreamingHttpResponse(
                _iter_stream(remote_body, size), content_type=content_type,
            )
        else:
            response = FileResponse(
                storage.open(object_key, 'rb'), as_attachment=as_attachment,
                filename=filename or '', content_type=content_type,
            )
        response['Content-Length'] = str(size)
        _common_headers(
            response, etag=etag, filename=filename, as_attachment=as_attachment,
            cache_control=cache_control,
        )
        return response

    start, end = byte_range
    length = end - start + 1
    if request.method == 'HEAD':
        response = HttpResponse(status=206, content_type=content_type)
    else:
        remote_body = _s3_object_body(storage, object_key, byte_range)
        response = StreamingHttpResponse(
            _iter_stream(remote_body, length) if remote_body is not None
            else _iter_range(storage.open(object_key, 'rb'), start, length),
            status=206, content_type=content_type,
        )
    response['Content-Length'] = str(length)
    response['Content-Range'] = f'bytes {start}-{end}/{size}'
    _common_headers(
        response, etag=etag, filename=filename, as_attachment=as_attachment,
        cache_control=cache_control,
    )
    return response
