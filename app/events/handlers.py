from .dispatcher import subscribe


def handle_health_checked(event):
    return None


subscribe('health.checked', handle_health_checked)
