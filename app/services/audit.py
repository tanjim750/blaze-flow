import uuid

from django.apps import apps
from django.utils import timezone

from app.models import AuditActorType, AuditLog


def _uuid(value):
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None


def _comment_scope(get_model, comment_id):
    """(project_id, team_only) for a review comment, its thread's visibility included."""
    ReviewComment = get_model('ReviewComment')
    row = ReviewComment.objects.filter(id=comment_id).values(
        'media_version__project_id', 'visibility', 'parent_comment__visibility',
    ).first()
    if row is None:
        return None, False
    return row['media_version__project_id'], 'team' in (row['visibility'], row['parent_comment__visibility'])


def resolve_audit_scope(entity_type, entity_id, get_model=None):
    """The project an audited entity belongs to, and whether it is a team-only note.

    Called when an event is written so the feed never has to walk entity tables per row.
    ``get_model`` lets a data migration pass its historical app registry.
    """
    get_model = get_model or (lambda name: apps.get_model('app', name))
    key = _uuid(entity_id)
    if key is None:
        return None, False
    if entity_type == 'review_comment':
        return _comment_scope(get_model, key)
    if entity_type == 'review_comment_content':
        comment_id = get_model('ReviewCommentContent').objects.filter(id=key).values_list('review_comment_id', flat=True).first()
        return _comment_scope(get_model, comment_id) if comment_id else (None, False)
    if entity_type == 'review_comment_reaction':
        comment_id = get_model('ReviewCommentReaction').objects.filter(id=key).values_list('review_comment_id', flat=True).first()
        return _comment_scope(get_model, comment_id) if comment_id else (None, False)
    if entity_type == 'annotation':
        row = get_model('Annotation').objects.filter(id=key).values('media_version__project_id', 'review_comment_id').first()
        if row is None:
            return None, False
        if row['review_comment_id']:
            return row['media_version__project_id'], _comment_scope(get_model, row['review_comment_id'])[1]
        return row['media_version__project_id'], False
    simple = {
        'media_version': ('MediaVersion', 'project_id'),
        'task': ('Task', 'project_id'),
        'guest_invite': ('GuestInvite', 'project_id'),
        'guest_review_access': ('GuestReviewAccess', 'guest_invite__project_id'),
    }
    if entity_type in simple:
        model, field = simple[entity_type]
        return get_model(model).objects.filter(id=key).values_list(field, flat=True).first(), False
    return None, False


def _scope(entity_type, entity_id, project, team_only):
    if project is not None:
        project_id = getattr(project, 'id', project)
        resolved_team_only = team_only if team_only is not None else resolve_audit_scope(entity_type, entity_id)[1]
        return project_id, bool(resolved_team_only)
    project_id, resolved_team_only = resolve_audit_scope(entity_type, entity_id)
    return project_id, bool(team_only if team_only is not None else resolved_team_only)


def record_user_audit(*, user, workspace, action, entity_type, entity_id, metadata=None, project=None, team_only=None, at=None):
    project_id, team_only = _scope(entity_type, entity_id, project, team_only)
    return AuditLog.objects.create(
        id=uuid.uuid4(),
        workspace=workspace,
        project_id=project_id,
        team_only=team_only,
        actor_type=AuditActorType.USER if user is not None else AuditActorType.SYSTEM,
        actor_user=user,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id),
        metadata=metadata or {},
        created_at=at or timezone.now(),
    )


def record_guest_audit(*, guest_session, workspace, action, entity_type, entity_id, metadata=None, project=None, team_only=None, at=None):
    project_id, team_only = _scope(entity_type, entity_id, project, team_only)
    return AuditLog.objects.create(
        id=uuid.uuid4(), workspace=workspace, project_id=project_id, team_only=team_only,
        actor_type=AuditActorType.GUEST,
        actor_guest_session=guest_session, action=action, entity_type=entity_type,
        entity_id=str(entity_id), metadata=metadata or {}, created_at=at or timezone.now(),
    )
