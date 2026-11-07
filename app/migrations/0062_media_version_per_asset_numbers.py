"""Version labels count per asset (V1, V2… of each file), not per project.

Adds ``media_versions.sequence_number`` (the old project-wide counter, kept for ordering and
uniqueness) and relabels ``version_number`` from the linked ``ProjectFile.version_number``.

Non-destructive: no row is deleted. The only writes are UPDATEs on ``media_versions``
(sequence_number copied from the old number; version_number set to the per-asset number).
Reverse restores the old project-wide numbers from ``sequence_number``.
"""
from django.db import migrations, models


def forwards(apps, schema_editor):
    MediaVersion = apps.get_model('app', 'MediaVersion')
    ProjectFile = apps.get_model('app', 'ProjectFile')
    MediaVersion.objects.filter(sequence_number__isnull=True).update(sequence_number=models.F('version_number'))
    numbers = {}
    for file_id, number in ProjectFile.objects.filter(deleted_at__isnull=True).values_list('file_id', 'version_number'):
        numbers[file_id] = number
    for file_id, number in ProjectFile.objects.filter(deleted_at__isnull=False).values_list('file_id', 'version_number'):
        numbers.setdefault(file_id, number)
    for media_id, file_id, current in MediaVersion.objects.values_list('id', 'original_file_id', 'version_number').iterator():
        number = numbers.get(file_id)
        if number and number != current:
            MediaVersion.objects.filter(pk=media_id).update(version_number=number)


def backwards(apps, schema_editor):
    MediaVersion = apps.get_model('app', 'MediaVersion')
    MediaVersion.objects.filter(sequence_number__isnull=False).update(version_number=models.F('sequence_number'))


class Migration(migrations.Migration):
    dependencies = [('app', '0061_auto_version_project_files')]

    operations = [
        migrations.AddField(model_name='mediaversion', name='sequence_number', field=models.IntegerField(blank=True, null=True)),
        migrations.RunPython(lambda a, s: a.get_model('app', 'MediaVersion').objects.filter(sequence_number__isnull=True).update(sequence_number=models.F('version_number')), migrations.RunPython.noop),
        migrations.RemoveConstraint(model_name='mediaversion', name='media_versions_project_version_number_uniq'),
        migrations.AddConstraint(model_name='mediaversion', constraint=models.UniqueConstraint(fields=('project', 'sequence_number'), name='media_versions_project_sequence_uniq')),
        migrations.RunPython(forwards, backwards),
    ]
