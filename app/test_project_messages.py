"""Project messages: two channels, posting rules, attachments, unread counts, notifications."""
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.urls import reverse

from .models import (
    File, FileStatus, Notification, NotificationKind, NotificationSetting, ProjectMessageAttachment,
)
from .permissions import MEDIA_READ, PROJECT_READ, WORKSPACE_READ
from .test_client_portal_v2 import PortalBase


def pdf(name='brief.pdf'):
    return SimpleUploadedFile(name, b'%PDF-1.4\n%fake\n', content_type='application/pdf')


class MessagesBase(PortalBase):
    def setUp(self):
        super().setUp()
        self.maya, _ = self.add_member('maya@example.com', first='Maya', last='Chen')
        reader = self.custom_role('Viewer', [WORKSPACE_READ, PROJECT_READ, MEDIA_READ])
        self.jordan, _ = self.add_member('jordan@example.com', role=reader, first='Jordan', last='Reed')

    def url(self, name='api-project-messages', *extra, project=None):
        return reverse(name, args=[self.workspace.id, project or self.project_id, *extra])

    def post(self, user, body, channel='client', expect=201, **extra):
        self.as_user(user)
        response = self.client.post(self.url(), {'channel': channel, 'body': body, **extra}, format='json')
        self.assertEqual(response.status_code, expect, response.content)
        return response.json()

    def thread(self, user, channel='client', expect=200, **params):
        self.as_user(user)
        response = self.client.get(self.url(), {'channel': channel, **params})
        self.assertEqual(response.status_code, expect, response.content)
        return response.json() if expect == 200 else None

    def bell(self, user, kind=None):
        rows = Notification.objects.filter(recipient_user=user)
        return rows.filter(kind=kind) if kind else rows


class ChannelTests(MessagesBase):
    def test_team_and_client_share_the_client_channel(self):
        self.post(self.owner, 'Rough cut is up.')
        self.post(self.client_user, 'Looks great, one note on the logo.')
        data = self.thread(self.owner)
        self.assertEqual([m['body'] for m in data['messages']], ['Rough cut is up.', 'Looks great, one note on the logo.'])
        self.assertTrue(data['messages'][1]['author']['is_client'])
        self.assertEqual(data['viewer']['channels'], ['client', 'team'])
        client_view = self.thread(self.client_user)
        self.assertEqual(client_view['viewer']['channels'], ['client'])
        self.assertEqual(len(client_view['messages']), 2)

    def test_team_channel_never_reaches_the_client(self):
        secret = self.post(self.owner, 'Budget is tight, keep it to two rounds.', channel='team')
        self.thread(self.client_user, channel='team', expect=404)
        self.as_user(self.client_user)
        self.assertEqual(self.client.post(self.url(), {'channel': 'team', 'body': 'hi'}, format='json').status_code, 404)
        self.assertEqual(self.client.patch(self.url('api-project-message-detail', secret['id']), {'body': 'x'}, format='json').status_code, 404)
        self.assertEqual(self.client.post(self.url('api-project-messages-read'), {'channel': 'team'}, format='json').status_code, 404)
        client_view = self.thread(self.client_user)
        self.assertNotIn('Budget', str(client_view))
        summary = self.client.get(reverse('api-workspace-message-unread', args=[self.workspace.id])).json()
        self.assertNotIn('team', summary['projects'][0]['unread'])
        self.assertNotIn('Budget', str(summary))
        # Client mentions only offer people who can read the client channel; team mentions refuse clients.
        self.post(self.owner, 'ping', channel='team', mention_user_ids=[str(self.client_user.id)], expect=400)

    def test_clients_only_see_their_own_projects(self):
        self.as_user(self.owner)
        other = self.client.post(reverse('api-projects', args=[self.workspace.id]), {'name': 'Other brand'}, format='json').json()['id']
        self.as_user(self.client_user)
        self.assertEqual(self.client.get(self.url(project=other), {'channel': 'client'}).status_code, 404)
        summary = self.client.get(reverse('api-workspace-message-unread', args=[self.workspace.id])).json()
        self.assertEqual([row['project_id'] for row in summary['projects']], [str(self.project_id)])

    def test_read_only_members_can_read_but_not_post_or_upload(self):
        self.post(self.owner, 'Hello team', channel='team')
        data = self.thread(self.jordan, channel='team')
        self.assertFalse(data['viewer']['can_post'])
        self.assertEqual(len(data['messages']), 1)
        self.post(self.jordan, 'Can I?', channel='team', expect=403)
        self.as_user(self.jordan)
        self.assertEqual(self.client.post(self.url('api-project-message-uploads'), {'file': pdf()}, format='multipart').status_code, 403)

    def test_outsiders_get_404(self):
        stranger, _ = self.add_member('stranger@example.com', mode='SELECTED')
        self.thread(stranger, expect=404)


class EditingTests(MessagesBase):
    def test_authors_edit_and_delete_their_own_messages_only(self):
        mine = self.post(self.maya, 'First draft')
        self.as_user(self.owner)
        self.assertEqual(self.client.patch(self.url('api-project-message-detail', mine['id']), {'body': 'hijack'}, format='json').status_code, 403)
        self.assertEqual(self.client.delete(self.url('api-project-message-detail', mine['id'])).status_code, 403)
        self.as_user(self.maya)
        edited = self.client.patch(self.url('api-project-message-detail', mine['id']), {'body': 'Second draft'}, format='json')
        self.assertEqual(edited.status_code, 200)
        self.assertEqual(edited.json()['body'], 'Second draft')
        self.assertIsNotNone(edited.json()['edited_at'])
        self.assertEqual(self.client.delete(self.url('api-project-message-detail', mine['id'])).status_code, 204)
        shown = self.thread(self.owner)['messages'][0]
        self.assertTrue(shown['deleted'])
        self.assertEqual(shown['body'], '')

    def test_replies_quote_the_parent_and_survive_its_deletion(self):
        parent = self.post(self.client_user, 'Can the logo be bigger?')
        reply = self.post(self.owner, 'Yes, in V3.', reply_to_id=parent['id'])
        self.assertEqual(reply['reply_to']['snippet'], 'Can the logo be bigger?')
        self.as_user(self.client_user)
        self.client.delete(self.url('api-project-message-detail', parent['id']))
        shown = self.thread(self.owner)['messages'][1]
        self.assertTrue(shown['reply_to']['deleted'])
        self.assertEqual(shown['reply_to']['snippet'], '')
        team = self.post(self.owner, 'internal', channel='team')
        self.post(self.owner, 'cross', reply_to_id=team['id'], expect=400)

    def test_polling_returns_new_and_changed_messages(self):
        first = self.post(self.owner, 'one')
        since = self.thread(self.owner)['server_time']
        self.post(self.client_user, 'two')
        self.as_user(self.owner)
        self.client.patch(self.url('api-project-message-detail', first['id']), {'body': 'one (edited)'}, format='json')
        data = self.thread(self.owner, after=since)
        self.assertEqual([m['body'] for m in data['messages']], ['two'])
        self.assertEqual([m['body'] for m in data['changed']], ['one (edited)'])

    def test_empty_messages_are_refused(self):
        self.post(self.owner, '   ', expect=400)


class AttachmentTests(MessagesBase):
    def test_upload_then_attach_then_download_once_scanned(self):
        self.as_user(self.client_user)
        up = self.client.post(self.url('api-project-message-uploads'), {'file': pdf()}, format='multipart')
        self.assertEqual(up.status_code, 201, up.content)
        message = self.post(self.client_user, '', attachment_ids=[up.json()['id']])
        attachment = message['attachments'][0]
        self.assertEqual(attachment['name'], 'brief.pdf')
        self.as_user(self.owner)
        self.assertEqual(self.client.get(self.url('api-project-message-attachment', message['id'], attachment['id'])).status_code, 409)
        File.objects.filter(id=ProjectMessageAttachment.objects.get(id=attachment['id']).file_id).update(status=FileStatus.READY)
        download = self.client.get(self.url('api-project-message-attachment', message['id'], attachment['id']))
        self.assertEqual(download.status_code, 200)
        # Message uploads stay out of the project file tree.
        files = self.client.get(reverse('api-project-files', args=[self.workspace.id, self.project_id]))
        self.assertNotIn('brief.pdf', str(files.content))

    def test_uploads_can_only_be_used_once_by_their_uploader(self):
        self.as_user(self.owner)
        up = self.client.post(self.url('api-project-message-uploads'), {'file': pdf()}, format='multipart').json()
        self.post(self.maya, 'stealing', attachment_ids=[up['id']], expect=400)
        self.post(self.owner, 'mine', attachment_ids=[up['id']])
        self.post(self.owner, 'again', attachment_ids=[up['id']], expect=400)

    def test_bad_types_are_refused(self):
        self.as_user(self.owner)
        fake = SimpleUploadedFile('x.pdf', b'MZ not a pdf', content_type='application/pdf')
        self.assertEqual(self.client.post(self.url('api-project-message-uploads'), {'file': fake}, format='multipart').status_code, 400)

    def test_link_a_cut(self):
        media = self.upload(self.owner, 'Hero 30s')
        message = self.post(self.owner, 'Latest cut', media_version_ids=[media['id']])
        self.assertEqual(message['attachments'][0]['kind'], 'cut')
        self.assertIn('Hero 30s', message['attachments'][0]['name'])


class UnreadAndNotificationTests(MessagesBase):
    def test_unread_counts_and_mark_read(self):
        self.post(self.client_user, 'one')
        self.post(self.client_user, 'two')
        self.post(self.maya, 'internal', channel='team')
        self.assertEqual(self.thread(self.owner)['unread'], {'client': 2, 'team': 1})
        self.as_user(self.owner)
        summary = self.client.get(reverse('api-workspace-message-unread', args=[self.workspace.id])).json()
        self.assertEqual(summary['total_unread'], 3)
        self.assertEqual(self.client.post(self.url('api-project-messages-read'), {'channel': 'client'}, format='json').status_code, 200)
        self.assertEqual(self.thread(self.owner)['unread'], {'client': 0, 'team': 1})
        # Your own messages never count as unread.
        self.assertEqual(self.thread(self.client_user)['unread'], {'client': 0})

    def test_bursts_batch_into_one_entry_and_the_sender_is_not_notified(self):
        for text in ('a', 'b', 'c'):
            self.post(self.client_user, text)
        rows = self.bell(self.owner, NotificationKind.PROJECT_MESSAGE_NEW)
        self.assertEqual(rows.count(), 1)
        self.assertEqual(rows.get().payload['message_count'], 3)
        self.assertIn(f'campaign={self.project_id}', rows.get().payload['link'])
        self.assertFalse(self.bell(self.client_user).exists())
        # Reading the thread clears it; the next message starts a fresh count.
        self.as_user(self.owner)
        self.client.post(self.url('api-project-messages-read'), {'channel': 'client'}, format='json')
        self.assertIsNotNone(rows.get().read_at)
        self.post(self.client_user, 'd')
        row = rows.get()
        self.assertIsNone(row.read_at)
        self.assertEqual(row.payload['message_count'], 1)

    def test_studio_messages_reach_the_client_with_a_portal_link(self):
        self.post(self.owner, 'V2 is ready')
        row = self.bell(self.client_user, NotificationKind.PROJECT_MESSAGE_NEW).get()
        self.assertEqual(row.payload['link'], f'/portal/projects/{self.project_id}#messages')

    def test_team_channel_never_notifies_the_client(self):
        self.post(self.maya, 'internal only', channel='team')
        self.assertFalse(self.bell(self.client_user).exists())
        self.assertTrue(self.bell(self.owner, NotificationKind.PROJECT_MESSAGE_NEW).exists())

    def test_mentions_and_preferences(self):
        NotificationSetting.objects.create(user=self.owner, workspace=self.workspace, kind=NotificationKind.PROJECT_MESSAGE_NEW, in_app_enabled=False)
        self.post(self.client_user, 'hello')
        self.assertFalse(self.bell(self.owner).exists())
        message = self.post(self.client_user, '@Maya can you check?', mention_user_ids=[str(self.maya.id)])
        self.assertEqual(message['mentions'], [str(self.maya.id)])
        self.assertTrue(message['mine'])
        mention = self.bell(self.maya, NotificationKind.PROJECT_MESSAGE_MENTION).get()
        self.assertEqual(mention.entity_id, message['id'])
        self.assertFalse(self.bell(self.maya, NotificationKind.PROJECT_MESSAGE_NEW).exists())
        self.as_user(self.client_user)
        self.client.delete(self.url('api-project-message-detail', message['id']))
        self.assertFalse(self.bell(self.maya, NotificationKind.PROJECT_MESSAGE_MENTION).exists())

    def test_notification_kinds_are_configurable(self):
        self.as_user(self.owner)
        response = self.client.get(reverse('api-notification-preferences'), {'workspace': str(self.workspace.id)})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIn('PROJECT_MESSAGE_NEW', str(response.content))
