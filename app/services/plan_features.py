"""Plan feature gates (what a plan includes, beyond numeric limits).

A plan's ``features`` entry in settings.PLAN_LIMITS lists what it excludes nothing from
when absent: FREE and PRO keep every feature, so existing workspaces are unchanged. The
SOLO plan lists only what it includes; anything gated and not listed raises
PlanUpgradeRequired, which DRF turns into a 403 with ``code: plan_upgrade_required`` that
the frontend renders as an "Upgrade to Starter" prompt.
"""
from django.conf import settings
from rest_framework import status
from rest_framework.exceptions import APIException

AI_QA = 'ai_qa'
TEAM_MEMBERS = 'team_members'
EDITOR_PAYOUTS = 'editor_payouts'
GATED_FEATURES = (AI_QA, TEAM_MEMBERS, EDITOR_PAYOUTS)

FEATURE_LABELS = {
    AI_QA: 'AI QA',
    TEAM_MEMBERS: 'Team members and editor roles',
    EDITOR_PAYOUTS: 'Editor payouts',
}
UPGRADE_PLAN = 'starter'


class PlanUpgradeRequired(APIException):
    status_code = status.HTTP_403_FORBIDDEN
    default_code = 'plan_upgrade_required'

    def __init__(self, *, plan, feature, detail=None):
        self.plan = plan
        self.feature = feature
        message = detail or (
            f"{FEATURE_LABELS.get(feature, feature)} isn't included in the {plan.title()} plan. "
            'Upgrade to Starter to use it.'
        )
        super().__init__(detail={
            'detail': message, 'code': 'plan_upgrade_required', 'feature': feature,
            'plan': plan, 'upgrade_to': UPGRADE_PLAN,
        })


def plan_features(plan):
    features = settings.PLAN_LIMITS.get(plan, {}).get('features')
    return set(GATED_FEATURES) if features is None else set(features)


def plan_has_feature(plan, feature):
    return feature in plan_features(plan)


def workspace_plan(workspace):
    from app.models import SubscriptionPlan
    from .subscriptions import _primary_owner_user, get_effective_plan

    owner = _primary_owner_user(workspace=workspace)
    return get_effective_plan(user=owner) if owner else SubscriptionPlan.FREE


def require_workspace_feature(workspace, feature):
    plan = workspace_plan(workspace)
    if not plan_has_feature(plan, feature):
        raise PlanUpgradeRequired(plan=plan, feature=feature)
    return plan


def workspace_entitlements(workspace):
    plan = workspace_plan(workspace)
    features = plan_features(plan)
    from .plan_config import get_plan_limit
    return {
        'plan': plan,
        'features': {f: f in features for f in GATED_FEATURES},
        'max_members': settings.PLAN_LIMITS.get(plan, {}).get('max_members'),
        'max_storage_bytes': get_plan_limit(plan, 'max_storage_bytes'),
        'upgrade_to': UPGRADE_PLAN,
    }
