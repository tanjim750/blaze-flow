import uuid

from django.utils import timezone

from app.models import AuditActorType, AuditLog


def record_user_audit(*, user, workspace, action, entity_type, entity_id, metadata=None):
    return AuditLog.objects.create(
        id=uuid.uuid4(),
        workspace=workspace,
        actor_type=AuditActorType.USER,
        actor_user=user,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id),
        metadata=metadata or {},
        created_at=timezone.now(),
    )


def record_guest_audit(*, guest_session, workspace, action, entity_type, entity_id, metadata=None):
    return AuditLog.objects.create(
        id=uuid.uuid4(), workspace=workspace, actor_type=AuditActorType.GUEST,
        actor_guest_session=guest_session, action=action, entity_type=entity_type,
        entity_id=str(entity_id), metadata=metadata or {}, created_at=timezone.now(),
    )
