"""Who may use the platform admin, and the audit trail every staff action leaves."""
import uuid

from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import BasePermission

from app.models import AuditActorType, AuditLog, UserStatus

PLATFORM_PERMISSION = 'app.access_platform_admin'
REASON_MIN, REASON_MAX = 3, 500


def is_platform_staff(user):
    """Explicit permission (directly or via a group). Superusers pass because Django's
    has_perm grants them everything; is_staff alone does not."""
    return bool(
        user and user.is_authenticated and user.is_active
        and getattr(user, 'status', None) == UserStatus.ACTIVE
        and user.has_perm(PLATFORM_PERMISSION)
    )


class IsPlatformStaff(BasePermission):
    message = 'Platform admin access is required.'

    def has_permission(self, request, view):
        return is_platform_staff(request.user)


def require_reason(data):
    reason = str((data or {}).get('reason') or '').strip()
    if len(reason) < REASON_MIN:
        raise ValidationError({'reason': 'Say why (at least 3 characters). It is saved in the audit log.'})
    return reason[:REASON_MAX]


def record_platform_audit(*, request, action, entity_type, entity_id, reason, workspace=None, workspace_id=None, metadata=None):
    return AuditLog.objects.create(
        id=uuid.uuid4(),
        workspace=workspace,
        **({'workspace_id': workspace_id} if workspace is None and workspace_id else {}),
        actor_type=AuditActorType.PLATFORM_STAFF,
        actor_user=request.user,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id),
        request_method=request.method,
        request_path=request.path[:1000],
        request_id=getattr(request, 'request_id', None),
        metadata={**(metadata or {}), 'reason': reason},
        created_at=timezone.now(),
    )
