import uuid
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from app.models import (
    File,
    Project,
    ProjectStatus,
    SubscriptionPlan,
    SubscriptionStatus,
    UserSubscription,
    Workspace,
    WorkspaceMembership,
    WorkspaceMembershipStatus,
    WorkspaceStatus,
)

from .plan_config import get_plan_limit


class SubscriptionError(Exception):
    pass


def provision_free_subscription(*, user):
    now = timezone.now()
    return UserSubscription.objects.create(
        id=uuid.uuid4(),
        user=user,
        plan=SubscriptionPlan.FREE,
        status=SubscriptionStatus.ACTIVE,
        started_at=now,
        created_at=now,
        updated_at=now,
    )


def get_current_subscription(*, user):
    return UserSubscription.objects.filter(
        user=user,
        status__in=(SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE),
    ).first()


def get_effective_subscription(*, user):
    """The user's current subscription row, or an unsaved FREE default for accounts
    created before subscription provisioning existed. Never persists on read."""
    return get_current_subscription(user=user) or UserSubscription(
        user=user, plan=SubscriptionPlan.FREE, status=SubscriptionStatus.ACTIVE,
    )


def get_effective_plan(*, user):
    subscription = get_current_subscription(user=user)
    return subscription.plan if subscription else SubscriptionPlan.FREE


@transaction.atomic
def upgrade_to_pro(*, user):
    subscription = UserSubscription.objects.select_for_update().filter(
        user=user,
        status__in=(SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE),
    ).first()
    now = timezone.now()
    period_end = now + timedelta(days=settings.SUBSCRIPTION_PRO_PERIOD_DAYS)
    if subscription is None:
        return UserSubscription.objects.create(
            id=uuid.uuid4(), user=user, plan=SubscriptionPlan.PRO, status=SubscriptionStatus.ACTIVE,
            started_at=now, current_period_start=now, current_period_end=period_end,
            created_at=now, updated_at=now,
        )
    if subscription.plan == SubscriptionPlan.PRO and not subscription.cancel_at_period_end:
        raise SubscriptionError('This account is already subscribed to the PRO plan.')
    subscription.plan = SubscriptionPlan.PRO
    subscription.status = SubscriptionStatus.ACTIVE
    subscription.current_period_start = now
    subscription.current_period_end = period_end
    subscription.cancel_at_period_end = False
    subscription.cancelled_at = None
    subscription.updated_at = now
    subscription.full_clean()
    subscription.save()
    return subscription


@transaction.atomic
def cancel_subscription(*, user):
    subscription = UserSubscription.objects.select_for_update().filter(
        user=user,
        status__in=(SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE),
    ).first()
    if subscription is None or subscription.plan != SubscriptionPlan.PRO:
        raise SubscriptionError('There is no active PRO subscription to cancel.')
    if subscription.cancel_at_period_end:
        raise SubscriptionError('This subscription is already scheduled to cancel.')
    subscription.cancel_at_period_end = True
    subscription.cancelled_at = timezone.now()
    subscription.updated_at = timezone.now()
    subscription.save(update_fields=['cancel_at_period_end', 'cancelled_at', 'updated_at'])
    return subscription


@transaction.atomic
def resume_subscription(*, user):
    subscription = UserSubscription.objects.select_for_update().filter(
        user=user,
        status__in=(SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE),
    ).first()
    if subscription is None or not subscription.cancel_at_period_end:
        raise SubscriptionError('There is no pending cancellation to resume.')
    subscription.cancel_at_period_end = False
    subscription.cancelled_at = None
    subscription.updated_at = timezone.now()
    subscription.save(update_fields=['cancel_at_period_end', 'cancelled_at', 'updated_at'])
    return subscription


def process_expired_subscriptions(*, dry_run=True):
    """Downgrade PRO subscriptions that were scheduled to cancel and whose period has
    ended. Run explicitly by an operator/scheduler; there is no payment provider webhook
    driving this in the MVP."""
    now = timezone.now()
    candidates = UserSubscription.objects.filter(
        status=SubscriptionStatus.ACTIVE,
        cancel_at_period_end=True,
        current_period_end__lte=now,
    )
    affected = list(candidates)
    if not dry_run:
        for subscription in affected:
            subscription.plan = SubscriptionPlan.FREE
            subscription.cancel_at_period_end = False
            subscription.cancelled_at = None
            subscription.current_period_start = None
            subscription.current_period_end = None
            subscription.updated_at = now
            subscription.save(update_fields=[
                'plan', 'cancel_at_period_end', 'cancelled_at',
                'current_period_start', 'current_period_end', 'updated_at',
            ])
    return affected


def _primary_owner_user(*, workspace):
    membership = WorkspaceMembership.objects.filter(
        workspace=workspace, is_primary_owner=True, status=WorkspaceMembershipStatus.ACTIVE,
    ).select_related('user').first()
    return membership.user if membership else None


def enforce_workspace_creation_limit(*, user):
    plan = get_effective_plan(user=user)
    limit = get_plan_limit(plan, 'max_workspaces_owned')
    owned = WorkspaceMembership.objects.filter(
        user=user,
        is_primary_owner=True,
        status=WorkspaceMembershipStatus.ACTIVE,
        workspace__status=WorkspaceStatus.ACTIVE,
    ).count()
    if owned >= limit:
        raise SubscriptionError(
            f'The {plan} plan allows up to {limit} owned workspace(s). Upgrade to create another.'
        )


def enforce_project_creation_limit(*, workspace):
    owner = _primary_owner_user(workspace=workspace)
    plan = get_effective_plan(user=owner) if owner else SubscriptionPlan.FREE
    limit = get_plan_limit(plan, 'max_projects_per_workspace')
    existing = Project.objects.filter(workspace=workspace).exclude(status=ProjectStatus.ARCHIVED).count()
    if existing >= limit:
        raise SubscriptionError(
            f"The workspace owner's {plan} plan allows up to {limit} project(s) per workspace. "
            'Upgrade to create another.'
        )


def workspace_storage_bytes_used(*, workspace):
    return File.objects.filter(workspace=workspace, deleted_at__isnull=True).aggregate(
        total=Sum('size_bytes'),
    )['total'] or 0


def enforce_workspace_storage_limit(*, workspace, additional_bytes, lock=False):
    if lock:
        workspace = Workspace.objects.select_for_update().get(id=workspace.id)
    owner = _primary_owner_user(workspace=workspace)
    plan = get_effective_plan(user=owner) if owner else SubscriptionPlan.FREE
    limit = get_plan_limit(plan, 'max_storage_bytes')
    used = workspace_storage_bytes_used(workspace=workspace)
    if used + additional_bytes > limit:
        raise SubscriptionError(
            f"The workspace owner's {plan} plan allows up to {limit} bytes of storage. "
            'Upgrade or free up space to upload more.'
        )
