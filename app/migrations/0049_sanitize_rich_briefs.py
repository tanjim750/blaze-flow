from django.db import migrations


def sanitize_existing(apps, schema_editor):
    # Briefs that already start with block markup would now render as rich text, so they
    # go through the same sanitiser first. Plain-text briefs are left exactly as they are.
    from app.rich_text import is_rich, sanitize_brief
    Project = apps.get_model('app', 'Project')
    for project in Project.objects.exclude(description__isnull=True).exclude(description='').only('id', 'description').iterator():
        if is_rich(project.description):
            cleaned = sanitize_brief(project.description)
            if cleaned != project.description:
                Project.objects.filter(pk=project.pk).update(description=cleaned)


class Migration(migrations.Migration):
    dependencies = [('app', '0048_direct_uploads')]
    operations = [migrations.RunPython(sanitize_existing, migrations.RunPython.noop)]
