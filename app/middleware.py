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
