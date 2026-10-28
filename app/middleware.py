import re
import uuid

_SAFE = re.compile(r'^[A-Za-z0-9._-]{8,128}$')


class RequestIdMiddleware:
    """Gives every request an id (an incoming X-Request-ID if sane, else a new UUID).

    It is echoed back in the X-Request-ID response header so a support ticket, an audit row
    and a log line can be matched up.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        incoming = request.headers.get('X-Request-ID', '')
        request.request_id = incoming if _SAFE.match(incoming) else uuid.uuid4().hex
        response = self.get_response(request)
        response['X-Request-ID'] = request.request_id
        return response


class DatabaseUnavailableMiddleware:
    """Turns a lost database connection into a short JSON 503 instead of an HTML 500.

    When Postgres restarts or a pooled connection goes stale, every request on that worker
    fails with OperationalError/InterfaceError until Django reconnects. As an HTML 500 the
    frontend could not tell that apart from a real bug, so the app shell rendered as if
    the visitor had no identity or workspace. A 503 with Retry-After says "transient, try
    again", and closing the connection lets the next request reconnect straight away.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        return self.get_response(request)

    def process_exception(self, request, exception):
        from django.db import InterfaceError, OperationalError, connections
        from django.http import JsonResponse

        if not isinstance(exception, (OperationalError, InterfaceError)):
            return None
        import logging

        logging.getLogger('blazeflow.db').warning(
            'Database unavailable on %s %s: %s', request.method, request.path, exception,
        )
        for conn in connections.all(initialized_only=True):
            try:
                conn.close()
            except Exception:  # noqa: BLE001 - already broken; drop it either way
                pass
        response = JsonResponse(
            {'detail': 'Krewsys is briefly unavailable. Please try again.', 'code': 'service_unavailable'},
            status=503,
        )
        response['Retry-After'] = '2'
        return response
