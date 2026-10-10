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
"""
import re

from django.core.files.storage import default_storage
from django.http import FileResponse, HttpResponse, StreamingHttpResponse
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


def _common_headers(response, *, etag, filename, as_attachment):
    response['Accept-Ranges'] = 'bytes'
    if etag:
        response['ETag'] = etag
    if filename or as_attachment:
        disposition = content_disposition_header(as_attachment, filename or '')
        if disposition:
            response['Content-Disposition'] = disposition


def ranged_file_response(request, object_key, *, content_type, filename=None, as_attachment=False, checksum=None, storage=None):
    storage = storage or default_storage
    size = storage.size(object_key)
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
        _common_headers(response, etag=etag, filename=None, as_attachment=False)
        return response

    if byte_range is None:
        if request.method == 'HEAD':
            response = HttpResponse(content_type=content_type)
            response['Content-Length'] = str(size)
            _common_headers(response, etag=etag, filename=filename, as_attachment=as_attachment)
            return response
        response = FileResponse(
            storage.open(object_key, 'rb'), as_attachment=as_attachment,
            filename=filename or '', content_type=content_type,
        )
        response['Content-Length'] = str(size)
        _common_headers(response, etag=etag, filename=None, as_attachment=False)
        return response

    start, end = byte_range
    length = end - start + 1
    if request.method == 'HEAD':
        response = HttpResponse(status=206, content_type=content_type)
    else:
        response = StreamingHttpResponse(
            _iter_range(storage.open(object_key, 'rb'), start, length),
            status=206, content_type=content_type,
        )
    response['Content-Length'] = str(length)
    response['Content-Range'] = f'bytes {start}-{end}/{size}'
    _common_headers(response, etag=etag, filename=filename, as_attachment=as_attachment)
    return response
