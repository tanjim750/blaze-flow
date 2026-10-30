"""Built-in task stages and the lookups that depend on what a stage *means*.

Stages are workspace data and users can rename, recolour, reorder or delete them, so code
must not depend on a stage's name. Each built-in stage carries a ``kind``; the name is only
used as a fallback for stages created before ``kind`` existed (or custom stages that a user
named "Client …" and expects the client hand-off to follow).
"""
from app.models import TaskStage, TaskStageKind, TaskStatus


# (name, kind, colour, is_done). Colours are the sRGB approximations of the design-system
# stage tokens (To Do --muted-foreground, In Progress --brand-foreground, Review --teal,
# Client Review --info, Revisions --destructive, Approved --success). The board renders
# built-in kinds with the tokens themselves; the hex is what other screens (and any custom
# stage) fall back to.
DEFAULT_TASK_STAGES = (
    ('To Do', TaskStageKind.TODO, '#a3a3b0', False),
    ('In Progress', TaskStageKind.IN_PROGRESS, '#b0a2fe', False),
    ('Review', TaskStageKind.REVIEW, '#47d6cf', False),
    ('Client Review', TaskStageKind.CLIENT_REVIEW, '#67b0f9', False),
    ('Revisions', TaskStageKind.REVISIONS, '#fd7277', False),
    ('Approved', TaskStageKind.APPROVED, '#5bd295', True),
)

# Names a stage of each kind has had. Used only when no stage carries the kind.
LEGACY_STAGE_NAMES = {
    TaskStageKind.TODO: ('To Do',),
    TaskStageKind.IN_PROGRESS: ('In Progress',),
    TaskStageKind.REVIEW: ('Review', 'Internal QA'),
    TaskStageKind.CLIENT_REVIEW: ('Client Review', 'Client'),
    TaskStageKind.REVISIONS: ('Revisions',),
    TaskStageKind.APPROVED: ('Approved',),
}

# The legacy ``Task.status`` enum still arrives from older clients (and the dashboard's
# "complete" toggle). Each status resolves to the first stage kind that exists.
STATUS_STAGE_KINDS = {
    TaskStatus.TODO: (TaskStageKind.TODO,),
    TaskStatus.IN_PROGRESS: (TaskStageKind.IN_PROGRESS, TaskStageKind.REVISIONS),
    TaskStatus.REVISIONS: (TaskStageKind.REVISIONS,),
    TaskStatus.INTERNAL_QA: (TaskStageKind.REVIEW,),
    TaskStatus.CLIENT: (TaskStageKind.CLIENT_REVIEW,),
    TaskStatus.COMPLETED: (TaskStageKind.APPROVED,),
    TaskStatus.APPROVED: (TaskStageKind.APPROVED,),
}


def create_default_task_stages(workspace):
    return [
        TaskStage.objects.create(
            workspace=workspace, name=name, kind=kind, color=color, sort_order=order, is_done=is_done,
        )
        for order, (name, kind, color, is_done) in enumerate(DEFAULT_TASK_STAGES)
    ]


def stage_of_kind(workspace, kind):
    """The workspace's stage for a built-in kind: by ``kind`` first, then by a known name."""
    stages = TaskStage.objects.filter(workspace=workspace).order_by('sort_order', 'created_at')
    stage = stages.filter(kind=kind).first()
    if stage:
        return stage
    for name in LEGACY_STAGE_NAMES.get(kind, ()):
        stage = stages.filter(name__iexact=name).first()
        if stage:
            return stage
    return None


def stage_for_status(workspace, status):
    for kind in STATUS_STAGE_KINDS.get(status, (TaskStageKind.TODO,)):
        stage = stage_of_kind(workspace, kind)
        if stage:
            return stage
    return None


def is_client_review_stage(stage):
    """True for the stage that hands work to the client.

    ``kind`` is the source of truth, so renaming "Client Review" keeps the hand-off. The
    name check is the fallback, and it is exactly the old rule (the name contains "client"),
    so every stage that notified before still does.
    """
    if stage is None:
        return False
    return stage.kind == TaskStageKind.CLIENT_REVIEW or 'client' in stage.name.casefold()
