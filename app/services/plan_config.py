from django.conf import settings


class PlanConfigError(Exception):
    pass


def get_plan_limit(plan, key):
    """Centralized accessor for environment-configured plan resource limits.

    Business code must call this instead of reading settings.PLAN_LIMITS directly,
    so a future move to database-managed plans only requires changing this function.
    """
    try:
        return settings.PLAN_LIMITS[plan][key]
    except KeyError as exc:
        raise PlanConfigError(f"No '{key}' limit configured for plan '{plan}'.") from exc
