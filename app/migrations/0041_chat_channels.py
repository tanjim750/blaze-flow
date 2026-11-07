# Slack-style chat channels on top of project messages.
import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


def backfill(apps, schema_editor):
    Workspace = apps.get_model('app', 'Workspace')
    ClientTeam = apps.get_model('app', 'ClientTeam')
    Project = apps.get_model('app', 'Project')
    ChatChannel = apps.get_model('app', 'ChatChannel')
    ProjectMessage = apps.get_model('app', 'ProjectMessage')
    ProjectMessageAttachment = apps.get_model('app', 'ProjectMessageAttachment')
    ProjectMessageRead = apps.get_model('app', 'ProjectMessageRead')
    ProjectMessageMention = apps.get_model('app', 'ProjectMessageMention')
    now = django.utils.timezone.now()

    for team in ClientTeam.objects.all().iterator():
        ChatChannel.objects.get_or_create(
            workspace_id=team.workspace_id, client_team_id=team.id, project=None,
            defaults={'id': uuid.uuid4(), 'created_at': now},
        )

    project_channels = {}
    for project in Project.objects.all().iterator():
        channel, _ = ChatChannel.objects.get_or_create(
            workspace_id=project.workspace_id, project_id=project.id,
            defaults={
                'id': uuid.uuid4(), 'client_team_id': project.client_team_id, 'created_at': now,
            },
        )
        # Keep client_team in sync if the channel already existed without one.
        if channel.client_team_id != project.client_team_id:
            channel.client_team_id = project.client_team_id
            channel.save(update_fields=['client_team_id'])
        project_channels[project.id] = channel

    for message in ProjectMessage.objects.all().iterator():
        channel = project_channels.get(message.project_id)
        if channel is None and message.project_id:
            project = Project.objects.filter(id=message.project_id).first()
            if project is None:
                continue
            channel, _ = ChatChannel.objects.get_or_create(
                workspace_id=project.workspace_id, project_id=project.id,
                defaults={'id': uuid.uuid4(), 'client_team_id': project.client_team_id, 'created_at': now},
            )
            project_channels[project.id] = channel
        if channel is None:
            continue
        message.chat_channel_id = channel.id
        message.save(update_fields=['chat_channel_id'])
        if channel.last_message_at is None or message.created_at > channel.last_message_at:
            channel.last_message_at = message.created_at
            channel.save(update_fields=['last_message_at'])
        for user_id in message.mentions or []:
            try:
                uid = uuid.UUID(str(user_id))
            except (TypeError, ValueError):
                continue
            ProjectMessageMention.objects.get_or_create(
                message_id=message.id, user_id=uid,
                defaults={
                    'id': uuid.uuid4(), 'chat_channel_id': channel.id, 'side': message.channel,
                    'created_at': message.created_at,
                },
            )

    for attachment in ProjectMessageAttachment.objects.all().iterator():
        if attachment.message_id:
            message = ProjectMessage.objects.filter(id=attachment.message_id).values('chat_channel_id').first()
            if message and message['chat_channel_id']:
                attachment.chat_channel_id = message['chat_channel_id']
                attachment.save(update_fields=['chat_channel_id'])
                continue
        channel = project_channels.get(attachment.project_id)
        if channel:
            attachment.chat_channel_id = channel.id
            attachment.save(update_fields=['chat_channel_id'])

    for row in ProjectMessageRead.objects.all().iterator():
        channel = project_channels.get(row.project_id)
        if not channel:
            continue
        # Collapse duplicates that would violate the new unique key.
        existing = ProjectMessageRead.objects.filter(
            user_id=row.user_id, chat_channel_id=channel.id, channel=row.channel,
        ).exclude(id=row.id).first()
        if existing:
            if existing.last_read_at < row.last_read_at:
                existing.last_read_at = row.last_read_at
                existing.save(update_fields=['last_read_at'])
            row.delete()
            continue
        row.chat_channel_id = channel.id
        row.save(update_fields=['chat_channel_id'])


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0040_project_chat'),
    ]

    operations = [
        migrations.CreateModel(
            name='ChatChannel',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, primary_key=True, serialize=False)),
                ('last_message_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('client_team', models.ForeignKey(blank=True, db_column='client_team_id', null=True, on_delete=django.db.models.deletion.CASCADE, related_name='chat_channels', to='app.clientteam')),
                ('project', models.ForeignKey(blank=True, db_column='project_id', null=True, on_delete=django.db.models.deletion.CASCADE, related_name='chat_channels', to='app.project')),
                ('workspace', models.ForeignKey(db_column='workspace_id', on_delete=django.db.models.deletion.CASCADE, related_name='+', to='app.workspace')),
            ],
            options={'db_table': 'chat_channels'},
        ),
        migrations.CreateModel(
            name='ProjectMessageMention',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, primary_key=True, serialize=False)),
                ('side', models.CharField(choices=[('client', 'With client'), ('team', 'Team only')], max_length=10)),
                ('created_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('chat_channel', models.ForeignKey(db_column='chat_channel_id', on_delete=django.db.models.deletion.CASCADE, related_name='+', to='app.chatchannel')),
                ('message', models.ForeignKey(db_column='message_id', on_delete=django.db.models.deletion.CASCADE, related_name='mention_rows', to='app.projectmessage')),
                ('user', models.ForeignKey(db_column='user_id', on_delete=django.db.models.deletion.CASCADE, related_name='+', to=settings.AUTH_USER_MODEL)),
            ],
            options={'db_table': 'project_message_mentions'},
        ),
        migrations.RemoveConstraint(
            model_name='projectmessageread',
            name='project_message_reads_uniq',
        ),
        migrations.AlterField(
            model_name='projectmessage',
            name='project',
            field=models.ForeignKey(blank=True, db_column='project_id', null=True, on_delete=django.db.models.deletion.CASCADE, related_name='messages', to='app.project'),
        ),
        migrations.AlterField(
            model_name='projectmessageattachment',
            name='project',
            field=models.ForeignKey(blank=True, db_column='project_id', null=True, on_delete=django.db.models.deletion.CASCADE, related_name='+', to='app.project'),
        ),
        migrations.AlterField(
            model_name='projectmessageread',
            name='project',
            field=models.ForeignKey(blank=True, db_column='project_id', null=True, on_delete=django.db.models.deletion.CASCADE, related_name='+', to='app.project'),
        ),
        migrations.AddField(
            model_name='projectmessage',
            name='chat_channel',
            field=models.ForeignKey(blank=True, db_column='chat_channel_id', null=True, on_delete=django.db.models.deletion.CASCADE, related_name='messages', to='app.chatchannel'),
        ),
        migrations.AddField(
            model_name='projectmessageattachment',
            name='chat_channel',
            field=models.ForeignKey(blank=True, db_column='chat_channel_id', null=True, on_delete=django.db.models.deletion.CASCADE, related_name='+', to='app.chatchannel'),
        ),
        migrations.AddField(
            model_name='projectmessageread',
            name='chat_channel',
            field=models.ForeignKey(blank=True, db_column='chat_channel_id', null=True, on_delete=django.db.models.deletion.CASCADE, related_name='+', to='app.chatchannel'),
        ),
        migrations.RunPython(backfill, noop),
        migrations.AddIndex(
            model_name='projectmessage',
            index=models.Index(fields=['chat_channel', 'channel', 'created_at'], name='project_mes_chat_ch_f12635_idx'),
        ),
        migrations.AddIndex(
            model_name='projectmessageattachment',
            index=models.Index(fields=['chat_channel', 'created_at'], name='project_mes_chat_ch_dbda66_idx'),
        ),
        migrations.AddConstraint(
            model_name='projectmessageread',
            constraint=models.UniqueConstraint(fields=('user', 'chat_channel', 'channel'), name='project_message_reads_channel_uniq'),
        ),
        migrations.AddIndex(
            model_name='projectmessagemention',
            index=models.Index(fields=['user', 'chat_channel', 'side', 'created_at'], name='project_mes_user_id_53b0fa_idx'),
        ),
        migrations.AddConstraint(
            model_name='projectmessagemention',
            constraint=models.UniqueConstraint(fields=('message', 'user'), name='project_message_mentions_uniq'),
        ),
        migrations.AddIndex(
            model_name='chatchannel',
            index=models.Index(fields=['workspace', 'last_message_at'], name='chat_channe_workspa_544f63_idx'),
        ),
        migrations.AddIndex(
            model_name='chatchannel',
            index=models.Index(fields=['client_team', 'last_message_at'], name='chat_channe_client__b2539b_idx'),
        ),
        migrations.AddConstraint(
            model_name='chatchannel',
            constraint=models.UniqueConstraint(condition=models.Q(('client_team__isnull', False), ('project__isnull', True)), fields=('workspace', 'client_team'), name='chat_channel_general_uniq'),
        ),
        migrations.AddConstraint(
            model_name='chatchannel',
            constraint=models.UniqueConstraint(condition=models.Q(('project__isnull', False)), fields=('workspace', 'project'), name='chat_channel_project_uniq'),
        ),
    ]
