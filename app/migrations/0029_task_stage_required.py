from django.db import migrations, models
import django.db.models.deletion


def fill_missing_task_stages(apps, schema_editor):
    Task = apps.get_model('app', 'Task')
    TaskStage = apps.get_model('app', 'TaskStage')
    for task in Task.objects.filter(task_stage__isnull=True).iterator():
        stage = TaskStage.objects.filter(workspace_id=task.workspace_id).order_by('sort_order', 'created_at').first()
        if stage is None:
            raise RuntimeError(f'Workspace {task.workspace_id} has tasks but no task stages.')
        task.task_stage_id = stage.id
        task.save(update_fields=['task_stage'])


class Migration(migrations.Migration):
    dependencies = [('app', '0028_task_client_ready_notification')]

    operations = [
        migrations.RunPython(fill_missing_task_stages, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='task', name='task_stage',
            field=models.ForeignKey(
                db_column='task_stage_id', on_delete=django.db.models.deletion.PROTECT,
                related_name='tasks', to='app.taskstage',
            ),
        ),
    ]
