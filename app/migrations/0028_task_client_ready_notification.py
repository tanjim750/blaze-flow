from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('app', '0027_media_asset_versions')]

    operations = [
        migrations.AlterField(
            model_name='notification',
            name='kind',
            field=models.CharField(
                choices=[
                    ('REVIEW_COMMENT_MENTION', 'Review Comment Mention'),
                    ('TASK_CLIENT_READY', 'Task Client Ready'),
                ],
                max_length=100,
            ),
        ),
    ]
