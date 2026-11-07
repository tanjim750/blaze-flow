from django.db import migrations, models
import django.db.models.deletion


# The fixed asset statuses map onto the stage names seeded in 0024. Anything a workspace has
# since renamed simply will not match, and that file starts with no stage rather than a wrong
# one. ARCHIVED has no stage equivalent and is deliberately dropped.
STATUS_TO_STAGE_NAME = {
    'DRAFT': 'To Do',
    'IN_REVIEW': 'Client',
    'APPROVED': 'Approved',
    'FINAL': 'Approved',
}


def stage_from_status(apps, schema_editor):
    ProjectFile = apps.get_model('app', 'ProjectFile')
    TaskStage = apps.get_model('app', 'TaskStage')
    stages = {}
    for stage in TaskStage.objects.all():
        stages[(stage.workspace_id, stage.name)] = stage.id
    for item in ProjectFile.objects.exclude(status='ARCHIVED').iterator():
        name = STATUS_TO_STAGE_NAME.get(item.status)
        stage_id = stages.get((item.workspace_id, name)) if name else None
        if stage_id:
            item.task_stage_id = stage_id
            item.save(update_fields=['task_stage'])


def status_from_stage(apps, schema_editor):
    ProjectFile = apps.get_model('app', 'ProjectFile')
    reverse = {'To Do': 'DRAFT', 'Client': 'IN_REVIEW', 'Approved': 'APPROVED'}
    for item in ProjectFile.objects.select_related('task_stage').iterator():
        item.status = reverse.get(getattr(item.task_stage, 'name', None), 'DRAFT')
        item.save(update_fields=['status'])


class Migration(migrations.Migration):

    dependencies = [('app', '0025_project_file_status')]

    operations = [
        migrations.AddField(
            model_name='projectfile',
            name='task_stage',
            field=models.ForeignKey(blank=True, db_column='task_stage_id', null=True, on_delete=django.db.models.deletion.PROTECT, related_name='+', to='app.taskstage'),
        ),
        migrations.AddIndex(
            model_name='projectfile',
            index=models.Index(fields=['task_stage'], name='project_fil_task_st_ad6f72_idx'),
        ),
        migrations.RunPython(stage_from_status, status_from_stage),
        migrations.RemoveIndex(model_name='projectfile', name='project_fil_status_f407f9_idx'),
        migrations.RemoveField(model_name='projectfile', name='status'),
    ]
