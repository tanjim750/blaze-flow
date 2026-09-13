import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('app', '0008_review_mentions_notifications_outbox'),
    ]

    operations = [
        migrations.AlterField(
            model_name='outboxevent',
            name='status',
            field=models.CharField(choices=[('PENDING', 'Pending'), ('PROCESSING', 'Processing'), ('PUBLISHED', 'Published'), ('FAILED', 'Failed'), ('DEAD_LETTER', 'Dead Letter')], default='PENDING', max_length=20),
        ),
        migrations.CreateModel(
            name='NotificationPreference',
            fields=[
                ('id', models.UUIDField(primary_key=True, serialize=False)),
                ('email_mentions_enabled', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField()),
                ('updated_at', models.DateTimeField()),
                ('user', models.OneToOneField(db_column='user_id', on_delete=django.db.models.deletion.DO_NOTHING, related_name='+', to='app.user')),
            ],
            options={'db_table': 'notification_preferences'},
        ),
        migrations.CreateModel(
            name='NotificationDelivery',
            fields=[
                ('id', models.UUIDField(primary_key=True, serialize=False)),
                ('channel', models.CharField(choices=[('EMAIL', 'Email')], max_length=30)),
                ('status', models.CharField(choices=[('PENDING', 'Pending'), ('SENT', 'Sent'), ('SKIPPED', 'Skipped'), ('FAILED', 'Failed')], default='PENDING', max_length=20)),
                ('attempts', models.PositiveIntegerField(default=0)),
                ('last_error', models.TextField(blank=True, null=True)),
                ('sent_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField()),
                ('updated_at', models.DateTimeField()),
                ('notification', models.ForeignKey(db_column='notification_id', on_delete=django.db.models.deletion.DO_NOTHING, related_name='+', to='app.notification')),
            ],
            options={'db_table': 'notification_deliveries'},
        ),
        migrations.AddConstraint(
            model_name='notificationdelivery',
            constraint=models.UniqueConstraint(fields=('notification', 'channel'), name='notification_deliveries_notification_channel_uniq'),
        ),
        migrations.AddIndex(
            model_name='notificationdelivery',
            index=models.Index(fields=['notification'], name='notificatio_notific_9901ae_idx'),
        ),
        migrations.AddIndex(
            model_name='notificationdelivery',
            index=models.Index(fields=['status', 'updated_at'], name='notificatio_status_0a6eb6_idx'),
        ),
    ]
