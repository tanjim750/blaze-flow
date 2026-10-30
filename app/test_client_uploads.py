"""Upload links (public, no account) and client-portal uploads into "From client"."""
import uuid
from datetime import timedelta
from unittest import mock

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from .models import (
    AuditLog, ClientTeam, ClientUpload, Notification, NotificationKind, Project, ProjectFile, ProjectFolder,
    UploadLink,
)
from .permissions import PROJECT_READ, WORKSPACE_READ
from .services import client_uploads
from .test_role_dashboards import DashboardBase

PNG = b'\x89PNG\r\n\x1a\n' + b'0' * 64
PDF = b'%PDF-1.4\n' + b'0' * 64


def png(name='frame.png', body=PNG):
    return SimpleUploadedFile(name, body, content_type='image/png')


def pdf(name='brand-guide.pdf'):
    return SimpleUploadedFile(name, PDF, content_type='application/pdf')


class UploadLinkBase(DashboardBase, TestCase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.project = Project.objects.get(id=self.project_id)
        self.anon = APIClient()

    def make_link(self, **payload):
        self.as_user(self.owner)
        response = self.client.post(
            reverse('api-project-upload-links', args=[self.workspace.id, self.project_id]),
            {'label': 'Send us your footage', **payload}, format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def send(self, token, upload=None, **fields):
        data = {'file': upload or png(), 'name': 'Rachel Kim', 'email': 'Rachel@Client.example', **fields}
        return self.anon.post(reverse('api-public-upload-link-file', args=[token]), data, format='multipart')


class UploadLinkManagementTests(UploadLinkBase):
    def test_owner_creates_lists_and_revokes(self):
        link = self.make_link(allowed_kinds=['video', 'document'], max_file_bytes=5_000_000)
        self.assertEqual(link['status'], 'active')
        self.assertEqual(link['path'], f"/upload/{link['token']}")
        self.assertEqual(link['allowed_kinds'], ['video', 'document'])
        listed = self.client.get(reverse('api-project-upload-links', args=[self.workspace.id, self.project_id])).json()
        self.assertEqual([row['id'] for row in listed], [link['id']])
        revoked = self.client.delete(reverse('api-project-upload-link-detail', args=[self.workspace.id, self.project_id, link['id']]))
        self.assertEqual(revoked.json()['status'], 'revoked')
        self.assertTrue(AuditLog.objects.filter(action='upload_link.created', team_only=True).exists())
        self.assertTrue(AuditLog.objects.filter(action='upload_link.revoked').exists())

    def test_all_kinds_is_stored_as_no_restriction(self):
        link = self.make_link(allowed_kinds=['video', 'image', 'audio', 'document'])
        self.assertEqual(link['allowed_kinds'], [])

    def test_patch_updates_label_and_expiry(self):
        link = self.make_link()
        later = (timezone.now() + timedelta(days=3)).isoformat()
        response = self.client.patch(
            reverse('api-project-upload-link-detail', args=[self.workspace.id, self.project_id, link['id']]),
            {'label': 'Brand files', 'expires_at': later}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['label'], 'Brand files')

    def test_expiry_must_be_in_future_and_size_within_workspace_cap(self):
        self.as_user(self.owner)
        url = reverse('api-project-upload-links', args=[self.workspace.id, self.project_id])
        past = (timezone.now() - timedelta(hours=1)).isoformat()
        self.assertEqual(self.client.post(url, {'label': 'x', 'expires_at': past}, format='json').status_code, 400)
        with override_settings(MAX_PROJECT_FILE_BYTES=1000):
            self.assertEqual(self.client.post(url, {'label': 'x', 'max_file_bytes': 5000}, format='json').status_code, 400)

    def test_people_without_project_update_cannot_manage(self):
        reader_role = self.custom_role('Viewer', [WORKSPACE_READ, PROJECT_READ])
        reader, _ = self.add_member('viewer@example.com', role=reader_role)
        self.as_user(reader)
        url = reverse('api-project-upload-links', args=[self.workspace.id, self.project_id])
        self.assertEqual(self.client.get(url).status_code, 403)
        self.assertEqual(self.client.post(url, {'label': 'x'}, format='json').status_code, 403)


class PublicUploadTests(UploadLinkBase):
    def test_public_page_shows_studio_and_project(self):
        link = self.make_link(instructions='Raw camera files please.')
        response = self.anon.get(reverse('api-public-upload-link', args=[link['token']]))
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['project_name'], 'Spring Launch')
        self.assertEqual(body['studio_name'], self.workspace.name)
        self.assertEqual(body['label'], 'Send us your footage')
        self.assertNotIn('token', body)
        self.assertIn('video/*', body['accept'])

    def test_upload_lands_in_from_client_folder_with_sender(self):
        link = self.make_link()
        response = self.send(link['token'])
        self.assertEqual(response.status_code, 201, response.content)
        folder = ProjectFolder.objects.get(project=self.project, name='From client', parent_folder__isnull=True)
        row = ClientUpload.objects.get()
        self.assertEqual(row.project_file.folder_id, folder.id)
        self.assertEqual(row.uploader_email, 'rachel@client.example')
        self.assertEqual(row.upload_link_id, uuid.UUID(link['id']))
        # The Files board names the client, not the owner whose link it was.
        files = self.client.get(reverse('api-project-files', args=[self.workspace.id, self.project_id])).json()
        sent = next(item for item in files if item['id'] == str(row.project_file_id))
        self.assertEqual(sent['added_by'], {'id': None, 'name': 'Rachel Kim', 'email': 'rachel@client.example', 'client': True})
        self.assertEqual(sent['folder_id'], str(folder.id))

    def test_second_upload_reuses_folder_and_restores_a_deleted_one(self):
        link = self.make_link()
        self.send(link['token'])
        ProjectFolder.objects.filter(name='From client').update(deleted_at=timezone.now())
        self.assertEqual(self.send(link['token'], png('second.png')).status_code, 201)
        self.assertEqual(ProjectFolder.objects.filter(project=self.project, name='From client').count(), 1)
        self.assertIsNone(ProjectFolder.objects.get(name='From client').deleted_at)

    def test_one_notification_per_batch_counts_files_and_reopens(self):
        link = self.make_link()
        batch = str(uuid.uuid4())
        self.send(link['token'], png('a.png'), batch_id=batch)
        note = Notification.objects.get(recipient_user=self.owner, kind=NotificationKind.CLIENT_UPLOAD_RECEIVED)
        note.read_at = timezone.now()
        note.save()
        self.send(link['token'], pdf(), batch_id=batch)
        note.refresh_from_db()
        self.assertIsNone(note.read_at)
        self.assertEqual(note.payload['file_count'], 2)
        self.assertEqual(note.payload['file_names'], ['a.png', 'brand-guide.pdf'])
        self.assertEqual(note.payload['actor_name'], 'Rachel Kim')
        self.assertTrue(note.payload['link'].startswith('/files?folder='))
        self.assertEqual(Notification.objects.filter(kind=NotificationKind.CLIENT_UPLOAD_RECEIVED).count(), 1)

    def test_activity_names_the_client(self):
        link = self.make_link()
        self.send(link['token'])
        self.as_user(self.owner)
        feed = self.client.get(reverse('api-workspace-activity', args=[self.workspace.id]), {'type': 'uploads'}).json()['results']
        received = next(row for row in feed if row['action'] == 'client_upload.received')
        self.assertEqual(received['actor']['type'], 'client')
        self.assertEqual(received['actor']['name'], 'Rachel Kim')
        self.assertEqual(received['object']['label'], 'frame.png')
        self.assertTrue(received['object']['href'].startswith('/files?folder='))
        self.assertIn("through upload link 'Send us your footage'", received['summary'])

    def test_revoked_expired_and_unknown_links_refuse(self):
        link = self.make_link()
        UploadLink.objects.filter(id=link['id']).update(expires_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(self.send(link['token']).status_code, 410)
        self.assertEqual(self.anon.get(reverse('api-public-upload-link', args=[link['token']])).status_code, 410)
        UploadLink.objects.filter(id=link['id']).update(expires_at=None, revoked_at=timezone.now())
        self.assertEqual(self.send(link['token']).status_code, 410)
        self.assertEqual(self.send('not-a-real-token').status_code, 404)
        self.assertFalse(ClientUpload.objects.exists())

    def test_size_limit_and_allowed_types(self):
        link = self.make_link(max_file_bytes=40, allowed_kinds=['document'])
        too_big = self.send(link['token'])
        self.assertEqual(too_big.status_code, 413)
        self.assertIn('accepts files up to', too_big.json()['detail'])
        link = self.make_link(allowed_kinds=['document'])
        wrong = self.send(link['token'])
        self.assertEqual(wrong.status_code, 415)
        self.assertEqual(self.send(link['token'], pdf()).status_code, 201)

    def test_signature_must_match(self):
        link = self.make_link()
        response = self.send(link['token'], SimpleUploadedFile('fake.mp4', b'not a video at all', content_type='video/mp4'))
        self.assertEqual(response.status_code, 400)
        self.assertFalse(ProjectFile.objects.filter(project=self.project).exists())

    def test_name_and_email_required(self):
        link = self.make_link()
        self.assertEqual(self.send(link['token'], email='not-an-email').status_code, 400)
        self.assertEqual(self.send(link['token'], name='').status_code, 400)

    def test_rate_limited_per_ip(self):
        link = self.make_link()
        url = reverse('api-public-upload-link', args=[link['token']])
        with mock.patch.dict('rest_framework.throttling.SimpleRateThrottle.THROTTLE_RATES', {'upload_link': '2/hour'}):
            codes = [self.anon.get(url).status_code for _ in range(3)]
        self.assertEqual(codes, [200, 200, 429])

    def test_daily_cap_per_link(self):
        link = self.make_link()
        with mock.patch.object(client_uploads, 'MAX_FILES_PER_LINK_PER_DAY', 1):
            self.assertEqual(self.send(link['token']).status_code, 201)
            self.assertEqual(self.send(link['token'], png('b.png')).status_code, 429)


class PortalUploadTests(UploadLinkBase):
    def setUp(self):
        super().setUp()
        role = self.custom_role('Client reviewer', [WORKSPACE_READ, PROJECT_READ])
        self.client_user = self.add_client_member('sam@client.example', role=role, team_name='Northlight Coffee')
        team = ClientTeam.objects.get(workspace=self.workspace, name='Northlight Coffee')
        Project.objects.filter(id=self.project_id).update(client_team=team)
        self.project.refresh_from_db()

    def test_client_of_the_project_can_send_and_see_own_uploads(self):
        self.as_user(self.client_user)
        url = reverse('api-project-client-uploads', args=[self.workspace.id, self.project_id])
        response = self.client.post(url, {'file': pdf()}, format='multipart')
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()['via'], 'portal')
        row = ClientUpload.objects.get()
        self.assertEqual(row.uploaded_by_user, self.client_user)
        self.assertEqual(row.project_file.folder.name, 'From client')
        self.assertEqual([item['id'] for item in self.client.get(url).json()], [str(row.id)])
        portal = self.client.get(reverse('api-client-portal', args=[self.workspace.id])).json()
        self.assertEqual([project['id'] for project in portal['projects']], [self.project_id])
        self.assertEqual(len(portal['recent_uploads']), 1)
        self.assertTrue(Notification.objects.filter(recipient_user=self.owner, kind=NotificationKind.CLIENT_UPLOAD_RECEIVED).exists())
        audit = AuditLog.objects.get(action='client_upload.received')
        self.assertEqual(audit.actor_user, self.client_user)

    def test_client_sees_own_upload_in_activity_without_files_link(self):
        self.as_user(self.client_user)
        self.client.post(reverse('api-project-client-uploads', args=[self.workspace.id, self.project_id]), {'file': pdf()}, format='multipart')
        feed = self.client.get(reverse('api-workspace-activity', args=[self.workspace.id])).json()['results']
        row = next(item for item in feed if item['action'] == 'client_upload.received')
        self.assertIsNone(row['object']['href'])
        self.assertIn('from the client portal', row['summary'])

    def test_client_never_sees_link_management_rows(self):
        self.make_link()
        self.as_user(self.client_user)
        feed = self.client.get(reverse('api-workspace-activity', args=[self.workspace.id])).json()['results']
        self.assertFalse([item for item in feed if item['action'].startswith('upload_link.')])

    def test_client_of_another_project_cannot_send(self):
        Project.objects.filter(id=self.project_id).update(client_team=None)
        self.as_user(self.client_user)
        response = self.client.post(
            reverse('api-project-client-uploads', args=[self.workspace.id, self.project_id]), {'file': pdf()}, format='multipart',
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.client.get(reverse('api-client-portal', args=[self.workspace.id])).json()['projects'], [])

    def test_team_member_with_file_create_can_send_too(self):
        self.as_user(self.owner)
        response = self.client.post(
            reverse('api-project-client-uploads', args=[self.workspace.id, self.project_id]), {'file': png()}, format='multipart',
        )
        self.assertEqual(response.status_code, 201)

    def test_the_owner_sees_every_sender(self):
        link = self.make_link()
        self.send(link['token'])
        self.as_user(self.client_user)
        self.client.post(reverse('api-project-client-uploads', args=[self.workspace.id, self.project_id]), {'file': pdf()}, format='multipart')
        mine = self.client.get(reverse('api-project-client-uploads', args=[self.workspace.id, self.project_id])).json()
        self.assertEqual([row['uploader_name'] for row in mine], ['Cleo Client'])
        self.as_user(self.owner)
        every = self.client.get(reverse('api-project-client-uploads', args=[self.workspace.id, self.project_id])).json()
        self.assertEqual(sorted(row['uploader_name'] for row in every), ['Cleo Client', 'Rachel Kim'])
