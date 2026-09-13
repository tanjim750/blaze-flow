from django.db import migrations


def add_media_security_permissions(apps, schema_editor):
    role = apps.get_model('app', 'Role')
    role_permission = apps.get_model('app', 'RolePermission')

    for system_role in role.objects.filter(is_system=True, name__in=['Owner', 'Member']):
        for permission_key in ('media.download', 'media.transition'):
            role_permission.objects.get_or_create(
                role=system_role,
                permission_key=permission_key,
            )


class Migration(migrations.Migration):
    dependencies = [
        ('app', '0005_add_system_media_permissions'),
    ]

    operations = [
        migrations.RunPython(add_media_security_permissions, migrations.RunPython.noop),
    ]
