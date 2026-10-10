from django.db import migrations


def add_client_team_permissions(apps, schema_editor):
    role = apps.get_model('app', 'Role')
    role_permission = apps.get_model('app', 'RolePermission')

    for system_role in role.objects.filter(is_system=True, name='Owner'):
        for permission_key in ('client_team.read', 'client_team.manage'):
            role_permission.objects.get_or_create(role=system_role, permission_key=permission_key)

    for system_role in role.objects.filter(is_system=True, name='Member'):
        role_permission.objects.get_or_create(role=system_role, permission_key='client_team.read')


class Migration(migrations.Migration):
    dependencies = [
        ('app', '0015_workspace_retention_policy'),
    ]

    operations = [
        migrations.RunPython(add_client_team_permissions, migrations.RunPython.noop),
    ]
