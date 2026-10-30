from django.db import migrations, models
import django.db.models.deletion


def add_annotation_permissions(apps, schema_editor):
    Role = apps.get_model('app', 'Role')
    RolePermission = apps.get_model('app', 'RolePermission')
    for role in Role.objects.filter(is_system=True, name__in=['Owner', 'Member']):
        for key in ('annotation.read', 'annotation.create', 'annotation.manage'):
            RolePermission.objects.get_or_create(role=role, permission_key=key)


class Migration(migrations.Migration):
    dependencies = [('app', '0009_notification_email_delivery')]
    operations = [
        migrations.AddField(
            model_name='reviewcommentcontent',
            name='deleted_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='reviewcommentcontent',
            name='deleted_by_user',
            field=models.ForeignKey(blank=True, db_column='deleted_by_user_id', null=True, on_delete=django.db.models.deletion.DO_NOTHING, related_name='+', to='app.user'),
        ),
        migrations.AddIndex(
            model_name='reviewcommentcontent',
            index=models.Index(fields=['deleted_at'], name='review_comm_deleted_305fbd_idx'),
        ),
        migrations.RunPython(add_annotation_permissions, migrations.RunPython.noop),
    ]
