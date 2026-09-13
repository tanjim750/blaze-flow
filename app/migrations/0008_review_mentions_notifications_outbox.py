import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('app', '0007_add_review_comment_permissions'),
    ]

    operations = [
        migrations.CreateModel(
            name='ReviewCommentMention',
            fields=[
                ('id', models.UUIDField(primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField()),
                ('review_comment', models.ForeignKey(db_column='review_comment_id', on_delete=django.db.models.deletion.DO_NOTHING, related_name='+', to='app.reviewcomment')),
                ('user', models.ForeignKey(db_column='user_id', on_delete=django.db.models.deletion.DO_NOTHING, related_name='+', to='app.user')),
            ],
            options={'db_table': 'review_comment_mentions'},
        ),
        migrations.CreateModel(
            name='Notification',
            fields=[
                ('id', models.UUIDField(primary_key=True, serialize=False)),
                ('kind', models.CharField(choices=[('REVIEW_COMMENT_MENTION', 'Review Comment Mention')], max_length=100)),
                ('entity_type', models.CharField(max_length=100)),
                ('entity_id', models.CharField(max_length=255)),
                ('payload', models.JSONField(default=dict)),
                ('read_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField()),
                ('actor_user', models.ForeignKey(blank=True, db_column='actor_user_id', null=True, on_delete=django.db.models.deletion.DO_NOTHING, related_name='+', to='app.user')),
                ('recipient_user', models.ForeignKey(db_column='recipient_user_id', on_delete=django.db.models.deletion.DO_NOTHING, related_name='+', to='app.user')),
                ('workspace', models.ForeignKey(db_column='workspace_id', on_delete=django.db.models.deletion.DO_NOTHING, related_name='+', to='app.workspace')),
            ],
            options={'db_table': 'notifications'},
        ),
        migrations.CreateModel(
            name='OutboxEvent',
            fields=[
                ('id', models.UUIDField(primary_key=True, serialize=False)),
                ('topic', models.CharField(max_length=255)),
                ('aggregate_type', models.CharField(max_length=100)),
                ('aggregate_id', models.CharField(max_length=255)),
                ('deduplication_key', models.CharField(max_length=500, unique=True)),
                ('payload', models.JSONField(default=dict)),
                ('status', models.CharField(choices=[('PENDING', 'Pending'), ('PROCESSING', 'Processing'), ('PUBLISHED', 'Published'), ('FAILED', 'Failed')], default='PENDING', max_length=20)),
                ('attempts', models.PositiveIntegerField(default=0)),
                ('available_at', models.DateTimeField()),
                ('locked_at', models.DateTimeField(blank=True, null=True)),
                ('published_at', models.DateTimeField(blank=True, null=True)),
                ('last_error', models.TextField(blank=True, null=True)),
                ('created_at', models.DateTimeField()),
                ('updated_at', models.DateTimeField()),
            ],
            options={'db_table': 'outbox_events'},
        ),
        migrations.AddConstraint(
            model_name='reviewcommentmention',
            constraint=models.UniqueConstraint(fields=('review_comment', 'user'), name='review_comment_mentions_comment_user_uniq'),
        ),
        migrations.AddIndex(
            model_name='reviewcommentmention',
            index=models.Index(fields=['review_comment'], name='review_comm_review__8b41f2_idx'),
        ),
        migrations.AddIndex(
            model_name='reviewcommentmention',
            index=models.Index(fields=['user', 'created_at'], name='review_comm_user_id_937b0f_idx'),
        ),
        migrations.AddConstraint(
            model_name='notification',
            constraint=models.UniqueConstraint(fields=('recipient_user', 'kind', 'entity_type', 'entity_id'), name='notifications_recipient_kind_entity_uniq'),
        ),
        migrations.AddIndex(
            model_name='notification',
            index=models.Index(fields=['recipient_user', 'created_at'], name='notificatio_recipie_c85215_idx'),
        ),
        migrations.AddIndex(
            model_name='notification',
            index=models.Index(fields=['recipient_user', 'read_at'], name='notificatio_recipie_92825f_idx'),
        ),
        migrations.AddIndex(
            model_name='notification',
            index=models.Index(fields=['workspace', 'created_at'], name='notificatio_workspa_7f3c3c_idx'),
        ),
        migrations.AddIndex(
            model_name='outboxevent',
            index=models.Index(fields=['status', 'available_at'], name='outbox_even_status_62eaed_idx'),
        ),
        migrations.AddIndex(
            model_name='outboxevent',
            index=models.Index(fields=['aggregate_type', 'aggregate_id'], name='outbox_even_aggrega_d56a15_idx'),
        ),
        migrations.AddIndex(
            model_name='outboxevent',
            index=models.Index(fields=['created_at'], name='outbox_even_created_dc5a3b_idx'),
        ),
    ]
