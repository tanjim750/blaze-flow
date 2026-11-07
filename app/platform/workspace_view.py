"""Read-only "view workspace" for platform staff.

A staffer starts a view on one workspace from the platform admin. Until they exit (or it
expires) the API answers their reads in that workspace as the workspace owner would see
them, and refuses every write they send, anywhere in the API. Start and end are audited.
"""
import uuid
from datetime import timedelta

from django.http import JsonResponse
from django.utils import timezone

from app.models import PlatformWorkspaceView

VIEW_TTL = timedelta(hours=2)
_MEMO = '_platform_workspace_view'
# Writes still allowed while viewing: leaving the view (and the rest of /api/platform/,
# which is staff-only and audited on its own), and signing out.
WRITE_ALLOWED_PREFIXES = ('/api/platform/', '/api/auth/logout/')


def active_view(user):
    """The staffer's open view, or None. Memoised on the user object for the request."""
    if not user or not getattr(user, 'is_authenticated', False):
        return None
    if hasattr(user, _MEMO):
        return getattr(user, _MEMO)
    from .access import is_platform_staff
    view = None
    if is_platform_staff(user):
        view = PlatformWorkspaceView.objects.filter(
            staff_user=user, ended_at__isnull=True, expires_at__gt=timezone.now(),
        ).select_related('workspace').order_by('-started_at').first()
    setattr(user, _MEMO, view)
    return view


def forget(user):
    if user is not None and hasattr(user, _MEMO):
        delattr(user, _MEMO)


def start_view(*, user, workspace, reason=''):
    now = timezone.now()
    ended = list(PlatformWorkspaceView.objects.filter(staff_user=user, ended_at__isnull=True))
    PlatformWorkspaceView.objects.filter(id__in=[v.id for v in ended]).update(ended_at=now)
    view = PlatformWorkspaceView.objects.create(
        id=uuid.uuid4(), staff_user=user, workspace=workspace, reason=reason[:500],
        started_at=now, expires_at=now + VIEW_TTL,
    )
    forget(user)
    return view, ended


def end_view(*, user):
    now = timezone.now()
    open_views = list(PlatformWorkspaceView.objects.filter(staff_user=user, ended_at__isnull=True).select_related('workspace'))
    PlatformWorkspaceView.objects.filter(id__in=[v.id for v in open_views]).update(ended_at=now)
    forget(user)
    return open_views


class PlatformViewReadOnlyMiddleware:
    """Refuses every unsafe request from a staffer who is viewing a workspace.

    This is the enforcement; the frontend hiding buttons is only cosmetic. It covers the
    whole API rather than just the viewed workspace's routes, so there is no write path a
    staffer can reach while the view is open.
    """

    SAFE_METHODS = frozenset({'GET', 'HEAD', 'OPTIONS'})

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.method not in self.SAFE_METHODS and not request.path.startswith(WRITE_ALLOWED_PREFIXES):
            view = active_view(getattr(request, 'user', None))
            if view is not None:
                return JsonResponse({
                    'detail': f'Read-only: you are viewing {view.workspace.name} as platform staff. Exit the view to make changes.',
                    'code': 'platform_view_read_only',
                }, status=403)
        return self.get_response(request)
