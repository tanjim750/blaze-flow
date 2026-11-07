"""Slack-style chat: channel list, General, search, mention badges, team isolation."""
from django.urls import reverse

from .models import ChatChannel, Notification, NotificationKind, Project, ProjectStatus
from .services.messages import ensure_general_channel, ensure_project_channel
from .test_project_messages import MessagesBase


class ChatChannelTests(MessagesBase):
    def setUp(self):
        super().setUp()
        self.team = self.project.client_team
        self.general = ensure_general_channel(workspace=self.workspace, client_team=self.team)
        self.project_channel = ensure_project_channel(self.project)

    def list_url(self):
        return reverse('api-chat-channels', args=[self.workspace.id])

    def chat_url(self, channel_id, name='api-chat-channel-messages', *extra):
        return reverse(name, args=[self.workspace.id, channel_id, *extra])

    def test_sidebar_groups_by_client_with_general_and_project(self):
        self.post(self.owner, 'hello')
        self.as_user(self.owner)
        data = self.client.get(self.list_url()).json()
        section = next(s for s in data['sections'] if s['id'] == str(self.team.id))
        kinds = [c['kind'] for c in section['channels']]
        self.assertIn('general', kinds)
        self.assertIn('project', kinds)
        self.assertEqual(section['channels'][0]['kind'], 'general')
        # Client never sees team sides in their list.
        self.as_user(self.client_user)
        client = self.client.get(self.list_url()).json()
        section = client['sections'][0]
        for row in section['channels']:
            self.assertEqual(row['sides'], ['client'])
            self.assertNotIn('team', row['unread'])

    def test_general_channel_posts_and_clients_cannot_see_team_side(self):
        self.as_user(self.owner)
        response = self.client.post(self.chat_url(self.general.id), {'side': 'client', 'body': 'Welcome aboard'}, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        team = self.client.post(self.chat_url(self.general.id), {'side': 'team', 'body': 'Internal welcome note'}, format='json')
        self.assertEqual(team.status_code, 201, team.content)
        self.as_user(self.client_user)
        shared = self.client.get(self.chat_url(self.general.id), {'side': 'client'})
        self.assertEqual(shared.status_code, 200)
        self.assertEqual(len(shared.json()['messages']), 1)
        self.assertEqual(self.client.get(self.chat_url(self.general.id), {'side': 'team'}).status_code, 404)

    def test_search_finds_messages_and_hides_team_from_clients(self):
        self.post(self.owner, 'UniqueNeedle shared')
        self.post(self.maya, 'UniqueNeedle secret', channel='team')
        self.as_user(self.owner)
        found = self.client.get(reverse('api-chat-search', args=[self.workspace.id]), {'q': 'UniqueNeedle'}).json()
        self.assertEqual(len(found['results']), 2)
        self.as_user(self.client_user)
        client = self.client.get(reverse('api-chat-search', args=[self.workspace.id]), {'q': 'UniqueNeedle'}).json()
        self.assertEqual(len(client['results']), 1)
        self.assertFalse(client['results'][0]['team_only'])

    def test_mention_badge_counts_separately_from_unread(self):
        self.post(self.client_user, f'@Maya please look', mention_user_ids=[str(self.maya.id)])
        self.post(self.client_user, 'and another')
        self.as_user(self.maya)
        data = self.client.get(self.list_url()).json()
        row = next(c for s in data['sections'] for c in s['channels'] if c['project_id'] == str(self.project_id))
        self.assertEqual(row['unread']['client'], 2)
        self.assertEqual(row['mentions']['client'], 1)
        self.assertEqual(data['total_mentions'], 1)

    def test_past_projects_are_separated(self):
        Project.objects.filter(id=self.project_id).update(status=ProjectStatus.COMPLETED)
        self.as_user(self.owner)
        data = self.client.get(self.list_url()).json()
        section = next(s for s in data['sections'] if s['id'] == str(self.team.id))
        self.assertTrue(any(c['project_id'] == str(self.project_id) for c in section['past']))
        self.assertFalse(any(c['project_id'] == str(self.project_id) for c in section['channels'] if c['kind'] == 'project'))

    def test_notification_links_point_at_chat(self):
        self.post(self.client_user, 'ping')
        row = Notification.objects.get(recipient_user=self.owner, kind=NotificationKind.PROJECT_MESSAGE_NEW)
        self.assertIn(f'/chat/{self.project_channel.id}', row.payload['link'])
        self.assertEqual(row.entity_type, 'chat_thread')
