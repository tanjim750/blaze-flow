from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [('app', '0024_customizable_task_stages')]

    operations = [
        migrations.AddField(
            model_name='projectfile',
            name='status',
            field=models.CharField(
                choices=[
                    ('DRAFT', 'Draft'),
                    ('IN_REVIEW', 'In Review'),
                    ('APPROVED', 'Approved'),
                    ('FINAL', 'Final'),
                    ('ARCHIVED', 'Archived'),
                ],
                default='DRAFT',
                max_length=20,
            ),
        ),
        migrations.AddIndex(
            model_name='projectfile',
            index=models.Index(fields=['status'], name='project_fil_status_f407f9_idx'),
        ),
    ]
