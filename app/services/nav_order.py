"""Workspace sidebar order.

The primary owner picks the order once for the whole workspace; every member sees it.
Which items a member sees is still decided by their role (frontend lib/role-nav.ts and the
route guards): the order only sorts what is already visible.
"""

# Default order. Keys are stable identifiers, never labels ("analytics" is the dashboard at /).
NAV_KEYS = ('files', 'projects', 'tasks', 'chat', 'clients', 'team', 'money', 'analytics')


def effective_nav_order(stored):
    """The stored order with unknown keys dropped and missing ones appended in default order."""
    seen = []
    for key in stored or []:
        if key in NAV_KEYS and key not in seen:
            seen.append(key)
    return seen + [key for key in NAV_KEYS if key not in seen]
