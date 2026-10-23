from django.db import migrations


def add_project_file_permissions(apps, schema_editor):
    role = apps.get_model('app', 'Role')
    role_permission = apps.get_model('app', 'RolePermission')

    for system_role in role.objects.filter(is_system=True, name='Owner'):
        for permission_key in (
            'project_file.read', 'project_file.create', 'project_file.update', 'project_file.delete',
        ):
            role_permission.objects.get_or_create(role=system_role, permission_key=permission_key)

    for system_role in role.objects.filter(is_system=True, name='Member'):
        for permission_key in ('project_file.read', 'project_file.create', 'project_file.update'):
            role_permission.objects.get_or_create(role=system_role, permission_key=permission_key)


class Migration(migrations.Migration):
    dependencies = [
        ('app', '0018_add_project_folder_root_uniqueness'),
    ]

    operations = [
        migrations.RunPython(add_project_file_permissions, migrations.RunPython.noop),
    ]
