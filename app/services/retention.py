import uuid
from datetime import timedelta

from django.conf import settings
from django.core.files.storage import default_storage
from django.db import transaction
from django.utils import timezone

from app.models import (
    File, FileVariant, ReviewCommentContent, WorkspaceRetentionPolicy,
)

from .audit import record_user_audit


def workspace_retention_policy_data(*, workspace):
    policy = WorkspaceRetentionPolicy.objects.filter(workspace=workspace).first()
    return {
        'workspace_id': str(workspace.id),
        'review_file_cleanup_enabled': (
            policy.review_file_cleanup_enabled if policy else True
        ),
        'review_file_retention_days': (
            policy.review_file_retention_days
            if policy else settings.REVIEW_FILE_RETENTION_DAYS
        ),
        'source': 'workspace' if policy else 'environment_default',
        'updated_by_user_id': str(policy.updated_by_user_id) if policy else None,
        'created_at': policy.created_at if policy else None,
        'updated_at': policy.updated_at if policy else None,
    }


@transaction.atomic
def update_workspace_retention_policy(
    *, workspace, user, review_file_cleanup_enabled=None,
    review_file_retention_days=None,
):
    if review_file_retention_days is not None and not 1 <= review_file_retention_days <= 3650:
        raise ValueError('review_file_retention_days must be between 1 and 3650.')
    now = timezone.now()
    policy = WorkspaceRetentionPolicy.objects.select_for_update().filter(
        workspace=workspace
    ).first()
    if policy is None:
        policy = WorkspaceRetentionPolicy(
            id=uuid.uuid4(),
            workspace=workspace,
            review_file_cleanup_enabled=True,
            review_file_retention_days=settings.REVIEW_FILE_RETENTION_DAYS,
            updated_by_user=user,
            created_at=now,
            updated_at=now,
        )
    if review_file_cleanup_enabled is not None:
        policy.review_file_cleanup_enabled = review_file_cleanup_enabled
    if review_file_retention_days is not None:
        policy.review_file_retention_days = review_file_retention_days
    policy.updated_by_user = user
    policy.updated_at = now
    policy.save()
    record_user_audit(
        user=user,
        workspace=workspace,
        action='workspace.retention_policy.updated',
        entity_type='workspace_retention_policy',
        entity_id=policy.id,
        metadata={
            'review_file_cleanup_enabled': policy.review_file_cleanup_enabled,
            'review_file_retention_days': policy.review_file_retention_days,
        },
    )
    return policy


def _workspace_policy_map(workspace_ids):
    policies = {
        policy.workspace_id: policy
        for policy in WorkspaceRetentionPolicy.objects.filter(workspace_id__in=workspace_ids)
    }
    return {
        workspace_id: {
            'enabled': policies[workspace_id].review_file_cleanup_enabled,
            'days': policies[workspace_id].review_file_retention_days,
        } if workspace_id in policies else {
            'enabled': True,
            'days': settings.REVIEW_FILE_RETENTION_DAYS,
        }
        for workspace_id in workspace_ids
    }


def purge_deleted_review_files(
    *, older_than_days=None, workspace_id=None, limit=100, dry_run=False
):
    if older_than_days is not None and older_than_days < 1:
        raise ValueError('older_than_days must be at least 1.')
    if limit < 1:
        raise ValueError('limit must be at least 1.')
    now = timezone.now()
    deleted_contents = ReviewCommentContent.objects.filter(
        file__isnull=False, deleted_at__isnull=False,
        file__deleted_at__isnull=False,
    ).exclude(file__metadata__has_key='physical_deleted_at')
    active_file_ids = ReviewCommentContent.objects.filter(
        file__isnull=False, deleted_at__isnull=True,
    ).values_list('file_id', flat=True)
    deleted_contents = deleted_contents.exclude(file_id__in=active_file_ids)
    if workspace_id is not None:
        workspace_ids = [workspace_id]
    else:
        workspace_ids = list(
            deleted_contents.order_by().values_list(
                'review_comment__media_version__project__workspace_id', flat=True
            ).distinct()
        )
    policy_map = _workspace_policy_map(workspace_ids)
    candidate_ids = set()
    skipped_workspaces = []
    for candidate_workspace_id in workspace_ids:
        policy = policy_map[candidate_workspace_id]
        if older_than_days is None and not policy['enabled']:
            skipped_workspaces.append(str(candidate_workspace_id))
            continue
        days = older_than_days if older_than_days is not None else policy['days']
        cutoff = now - timedelta(days=days)
        candidate_ids.update(
            deleted_contents.filter(
                review_comment__media_version__project__workspace_id=candidate_workspace_id,
                file__deleted_at__lte=cutoff,
            ).order_by('file__deleted_at').values_list('file_id', flat=True)[:limit]
        )

    candidates = File.objects.filter(id__in=candidate_ids).order_by('deleted_at')
    result = {
        'examined': 0, 'purged': 0, 'failed': 0, 'dry_run': dry_run,
        'file_ids': [], 'workspaces_considered': len(workspace_ids),
        'skipped_workspace_ids': skipped_workspaces,
    }
    for file in candidates:
        reference_workspace_ids = set(
            deleted_contents.filter(file_id=file.id).values_list(
                'review_comment__media_version__project__workspace_id', flat=True
            )
        )
        reference_policies = _workspace_policy_map(reference_workspace_ids)
        if older_than_days is None and any(
            not policy['enabled']
            or file.deleted_at > now - timedelta(days=policy['days'])
            for policy in reference_policies.values()
        ):
            continue
        if result['examined'] >= limit:
            break
        result['examined'] += 1
        result['file_ids'].append(str(file.id))
        if dry_run:
            continue
        variants = list(FileVariant.objects.filter(file=file))
        try:
            for variant in variants:
                default_storage.delete(variant.object_key)
            default_storage.delete(file.object_key)
        except Exception:
            result['failed'] += 1
            continue
        purged_at = timezone.now()
        with transaction.atomic():
            locked = File.objects.select_for_update().get(id=file.id)
            metadata = dict(locked.metadata or {})
            metadata['physical_deleted_at'] = purged_at.isoformat()
            locked.metadata = metadata
            locked.updated_at = purged_at
            locked.save(update_fields=['metadata', 'updated_at'])
            for variant in variants:
                variant_metadata = dict(variant.metadata or {})
                variant_metadata['physical_deleted_at'] = purged_at.isoformat()
                FileVariant.objects.filter(id=variant.id).update(
                    metadata=variant_metadata, updated_at=purged_at,
                )
        result['purged'] += 1
    return result
