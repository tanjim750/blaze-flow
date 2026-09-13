from django.db import migrations


def add_task_permissions(apps, schema_editor):
    role = apps.get_model('app', 'Role')
    role_permission = apps.get_model('app', 'RolePermission')

    for system_role in role.objects.filter(is_system=True, name='Owner'):
        for permission_key in ('task.read', 'task.create', 'task.update', 'task.delete'):
            role_permission.objects.get_or_create(role=system_role, permission_key=permission_key)

    for system_role in role.objects.filter(is_system=True, name='Member'):
        for permission_key in ('task.read', 'task.create', 'task.update'):
            role_permission.objects.get_or_create(role=system_role, permission_key=permission_key)


class Migration(migrations.Migration):
    dependencies = [
        ('app', '0016_add_client_team_permissions'),
    ]

    operations = [
        migrations.RunPython(add_task_permissions, migrations.RunPython.noop),
    ]
