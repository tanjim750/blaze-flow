"""Give task stages a ``kind`` and move existing workspaces onto the six built-in stages.

Backwards compatible and non-destructive:
- Stage IDs never change, so every task and staged file keeps its stage.
- No stage is deleted. "In Progress" is added only where no such stage exists.
- "Internal QA" becomes "Review" and "Client" becomes "Client Review" only when the new
  name is free in that workspace (names are unique per workspace). A stage the user
  renamed is left alone; it still gets a kind if its name is a known built-in name.
- Colours move to the design-system stage colours only where the stage still has its old
  default colour.
- The full new order (To Do, In Progress, Review, Client Review, Revisions, Approved) is
  applied only to workspaces still on the untouched five defaults. Anywhere else "In
  Progress" is slotted in straight after "To Do" and the rest keep their order.
"""
from django.db import migrations, models


OLD_DEFAULT_ORDER = ('to do', 'revisions', 'internal qa', 'client', 'approved')
NEW_ORDER = ('todo', 'in_progress', 'review', 'client_review', 'revisions', 'approved')

# lower-cased name -> kind
KIND_BY_NAME = {
    'to do': 'todo',
    'in progress': 'in_progress',
    'internal qa': 'review',
    'review': 'review',
    'client': 'client_review',
    'client review': 'client_review',
    'revisions': 'revisions',
    'approved': 'approved',
}
RENAMES = {'internal qa': 'Review', 'client': 'Client Review'}
# old default colour -> design-system colour, per kind
RECOLOUR = {
    'todo': ('#89909d', '#a3a3b0'),
    'review': ('#4ba3ff', '#47d6cf'),
    'client_review': ('#f4a742', '#67b0f9'),
    'revisions': ('#ff5865', '#fd7277'),
    'approved': ('#36d399', '#5bd295'),
}
IN_PROGRESS = ('In Progress', '#b0a2fe')


def forwards(apps, schema_editor):
    Workspace = apps.get_model('app', 'Workspace')
    TaskStage = apps.get_model('app', 'TaskStage')
    for workspace in Workspace.objects.all().iterator():
        stages = list(TaskStage.objects.filter(workspace=workspace).order_by('sort_order', 'created_at'))
        if not stages:
            continue
        untouched = tuple(stage.name.strip().lower() for stage in stages) == OLD_DEFAULT_ORDER
        names = {stage.name.strip().lower() for stage in stages}
        claimed = set()
        for stage in stages:
            key = stage.name.strip().lower()
            kind = KIND_BY_NAME.get(key)
            changed = []
            if kind and kind not in claimed:
                claimed.add(kind)
                stage.kind = kind
                changed.append('kind')
                old_colour, new_colour = RECOLOUR.get(kind, (None, None))
                if old_colour and stage.color.lower() == old_colour:
                    stage.color = new_colour
                    changed.append('color')
                new_name = RENAMES.get(key)
                if new_name and new_name.lower() not in names:
                    names.discard(key)
                    names.add(new_name.lower())
                    stage.name = new_name
                    changed.append('name')
            if changed:
                stage.save(update_fields=changed)

        if 'in_progress' not in claimed:
            todo = next((stage for stage in stages if stage.kind == 'todo'), None)
            anchor = todo.sort_order if todo else min(stage.sort_order for stage in stages) - 1
            for stage in stages:
                if stage.sort_order > anchor:
                    stage.sort_order += 1
                    stage.save(update_fields=['sort_order'])
            stages.append(TaskStage.objects.create(
                workspace=workspace, name=IN_PROGRESS[0], color=IN_PROGRESS[1], kind='in_progress',
                sort_order=anchor + 1, is_done=False, automation_enabled=True,
            ))

        if untouched:
            by_kind = {stage.kind: stage for stage in stages}
            for order, kind in enumerate(NEW_ORDER):
                stage = by_kind.get(kind)
                if stage and stage.sort_order != order:
                    stage.sort_order = order
                    stage.save(update_fields=['sort_order'])


def backwards(apps, schema_editor):
    """Undo the renames and the new order. "In Progress" is removed only if it is empty."""
    Workspace = apps.get_model('app', 'Workspace')
    TaskStage = apps.get_model('app', 'TaskStage')
    Task = apps.get_model('app', 'Task')
    ProjectFile = apps.get_model('app', 'ProjectFile')
    reverse_names = {'review': ('Review', 'Internal QA'), 'client_review': ('Client Review', 'Client')}
    for workspace in Workspace.objects.all().iterator():
        stages = list(TaskStage.objects.filter(workspace=workspace).order_by('sort_order', 'created_at'))
        names = {stage.name.lower() for stage in stages}
        for stage in stages:
            if stage.kind in reverse_names:
                new_name, old_name = reverse_names[stage.kind]
                if stage.name == new_name and old_name.lower() not in names:
                    stage.name = old_name
                    stage.save(update_fields=['name'])
            if stage.kind in RECOLOUR and stage.color.lower() == RECOLOUR[stage.kind][1]:
                stage.color = RECOLOUR[stage.kind][0]
                stage.save(update_fields=['color'])
        in_progress = next((stage for stage in stages if stage.kind == 'in_progress'), None)
        if (
            in_progress
            and in_progress.name == IN_PROGRESS[0]
            and not Task.objects.filter(task_stage=in_progress).exists()
            and not ProjectFile.objects.filter(task_stage=in_progress).exists()
        ):
            in_progress.delete()
            stages.remove(in_progress)
        kinds = tuple(stage.kind for stage in stages)
        if kinds == NEW_ORDER or kinds == tuple(k for k in NEW_ORDER if k != 'in_progress'):
            old = ('todo', 'revisions', 'review', 'client_review', 'approved', 'in_progress')
            by_kind = {stage.kind: stage for stage in stages}
            for order, kind in enumerate(old):
                if kind in by_kind:
                    by_kind[kind].sort_order = order
                    by_kind[kind].save(update_fields=['sort_order'])


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0029_task_stage_required'),
    ]

    operations = [
        migrations.AddField(
            model_name='taskstage',
            name='kind',
            field=models.CharField(
                choices=[
                    ('todo', 'Todo'), ('in_progress', 'In Progress'), ('review', 'Review'),
                    ('client_review', 'Client Review'), ('revisions', 'Revisions'),
                    ('approved', 'Approved'), ('custom', 'Custom'),
                ],
                default='custom', max_length=20,
            ),
        ),
        migrations.RunPython(forwards, backwards),
    ]
