"""Publishing a library file into a project as a review version (``asset-files/<id>/publish/``).

A library file has nowhere to keep review data until it has a media version. Publishing
creates one on the *same* File (no copy), moves the library row into the project, and turns
the notes someone wrote during the session into real comments, all or nothing.
"""
import io
import shutil
import tempfile
import uuid

from PIL import Image
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .models import (
    Annotation, AuditLog, File, FileStatus, MediaVersion, MediaVersionStageEntry, Project, ProjectFile,
    ProjectAccessMode, ReviewComment, WorkspaceMembership,
)
from .permissions import MEDIA_CREATE, MEDIA_READ, PROJECT_FILE_READ, PROJECT_FILE_UPDATE, PROJECT_READ, WORKSPACE_READ
from .services.outbox import process_outbox_events
from .services.roles import create_role
from .test_access_projects import WorkspaceAccessSetupMixin

POINT = {'element_type': 'POINT', 'geometry': {'x': 0.5, 'y': 0.25}}


def _png(colour='#583be8'):
    buffer = io.BytesIO()
    Image.new('RGB', (24, 16), colour).save(buffer, format='PNG')
    return buffer.getvalue()


class PublishToProjectTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='blazeflow-publish-tests-')
        self.settings_override = override_settings(MEDIA_ROOT=self.media_root, MAX_PROJECT_FILE_BYTES=1024 * 1024)
        self.settings_override.enable()
        super().setUp()
        self.client.force_authenticate(self.owner)
        self.project = self.make_project('Spring Launch')
        self.other_project = self.make_project('Holiday Teaser')
        self.folder = self.client.post(
            reverse('api-project-folders', args=[self.workspace.id, self.project.id]), {'name': 'Cuts'}, format='json',
        ).json()
        self.asset = self.upload('hero_still.png')

    def tearDown(self):
        self.settings_override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)

    def make_project(self, name):
        response = self.client.post(reverse('api-projects', args=[self.workspace.id]), {'name': name}, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        return Project.objects.get(id=response.json()['id'])

    def upload(self, name, colour='#583be8'):
        response = self.client.post(
            reverse('api-asset-files', args=[self.workspace.id]),
            {'file': SimpleUploadedFile(name, _png(colour), content_type='image/png')}, format='multipart',
        )
        self.assertEqual(response.status_code, 201, response.content)
        process_outbox_events()
        process_outbox_events()
        File.objects.filter(id=response.json()['file']['id']).update(status=FileStatus.READY)
        return response.json()

    def publish(self, asset=None, **payload):
        payload.setdefault('project_id', str(self.project.id))
        return self.client.post(
            reverse('api-asset-file-publish', args=[self.workspace.id, (asset or self.asset)['id']]), payload, format='json',
        )

    def member(self, keys, *, mode=ProjectAccessMode.ALL, email='publisher@example.com'):
        role = create_role(workspace=self.workspace, created_by_user=self.owner, name=f'Role {uuid.uuid4().hex[:6]}', permission_keys=keys)
        model = WorkspaceMembership._meta.get_field('user').remote_field.model
        user = model.objects.create_user(email=email, password='a-secure-test-password', first_name='Pat', last_name='Lisher')
        now = timezone.now()
        WorkspaceMembership.objects.create(
            id=uuid.uuid4(), workspace=self.workspace, principal_type='USER', user=user, role=role,
            project_access_mode=mode, status='ACTIVE', joined_at=now, created_at=now, updated_at=now,
        )
        return user

    # -------------------------------------------------------------------------- happy path
    def test_publish_creates_a_media_version_on_the_same_file_and_moves_the_asset(self):
        before = Project.objects.get(id=self.project.id).next_media_version_number
        response = self.publish(folder_id=self.folder['id'])
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        media = MediaVersion.objects.get(id=body['media_version']['id'])
        # Same bytes, no copy: the review page recognises the library file by its File id.
        self.assertEqual(str(media.original_file_id), self.asset['file']['id'])
        self.assertEqual(media.project_id, self.project.id)
        self.assertEqual(media.version_number, before)
        self.assertEqual(media.title, 'hero_still.png')
        self.assertEqual(File.objects.filter(workspace=self.workspace).count(), 1)
        self.assertTrue(MediaVersionStageEntry.objects.filter(media_version=media).exists())
        row = ProjectFile.objects.get(id=self.asset['id'])
        self.assertEqual(row.project_id, self.project.id)
        self.assertEqual(str(row.folder_id), self.folder['id'])
        self.assertEqual(body['asset_file']['project_id'], str(self.project.id))
        self.assertEqual(Project.objects.get(id=self.project.id).next_media_version_number, before + 1)
        self.assertTrue(AuditLog.objects.filter(action='media.published', entity_id=media.id).exists())
        listed = self.client.get(reverse('api-media-versions', args=[self.workspace.id, self.project.id])).json()
        self.assertEqual([item['id'] for item in listed], [str(media.id)])

    def test_session_notes_become_real_comments_with_replies_drawings_and_resolution(self):
        response = self.publish(
            notes=[
                {'key': 'local-1', 'text': 'Logo lands late', 'start_time_ms': 1200, 'elements': [POINT],
                 'replies': [{'key': 'local-1a', 'text': 'Agreed, trim 6 frames'}]},
                {'key': 'local-2', 'text': 'Colour is fine now', 'resolved': True},
            ],
            annotations=[{'start_time_ms': 3000, 'elements': [POINT]}],
        )
        self.assertEqual(response.status_code, 201, response.content)
        media_id = response.json()['media_version']['id']
        ids = response.json()['comment_ids']
        self.assertEqual(set(ids), {'local-1', 'local-1a', 'local-2'})
        first = ReviewComment.objects.get(id=ids['local-1'])
        self.assertEqual(first.start_time_ms, 1200)
        self.assertEqual(first.author_user_id, self.owner.id)
        self.assertEqual(first.visibility, 'client')
        self.assertEqual(ReviewComment.objects.get(id=ids['local-1a']).parent_comment_id, first.id)
        self.assertTrue(ReviewComment.objects.get(id=ids['local-2']).resolved)
        self.assertEqual(Annotation.objects.filter(media_version_id=media_id, review_comment=first).count(), 1)
        self.assertEqual(Annotation.objects.filter(media_version_id=media_id, review_comment__isnull=True).count(), 1)
        # And the normal comments API now serves them.
        listed = self.client.get(reverse('api-review-comments', args=[self.workspace.id, self.project.id, media_id]))
        self.assertEqual(listed.status_code, 200)
        payload = listed.json()
        rows = payload['results'] if isinstance(payload, dict) else payload
        self.assertGreaterEqual(len(rows), 2)

    def test_publish_as_a_new_version_of_an_existing_asset(self):
        first = self.upload('hero_v1.png', '#111111')
        moved = self.client.patch(
            reverse('api-asset-file-detail', args=[self.workspace.id, first['id']]),
            {'project_id': str(self.project.id), 'folder_id': self.folder['id']}, format='json',
        )
        self.assertEqual(moved.status_code, 200, moved.content)
        response = self.publish(version_of_id=first['id'])
        self.assertEqual(response.status_code, 201, response.content)
        newcomer = ProjectFile.objects.get(id=self.asset['id'])
        target = ProjectFile.objects.get(id=first['id'])
        self.assertEqual(newcomer.media_asset_id, target.media_asset_id)
        self.assertEqual(newcomer.version_number, 2)
        self.assertEqual(newcomer.project_id, self.project.id)
        self.assertEqual(str(newcomer.folder_id), self.folder['id'])

    # -------------------------------------------------------------------------- refusals
    def test_a_file_can_only_be_published_once(self):
        self.assertEqual(self.publish().status_code, 201)
        again = self.publish(project_id=str(self.other_project.id))
        self.assertEqual(again.status_code, 400)
        self.assertIn('already published to Spring Launch', again.json()['detail'])
        self.assertEqual(MediaVersion.objects.count(), 1)

    def test_a_folder_must_belong_to_the_chosen_project(self):
        response = self.publish(project_id=str(self.other_project.id), folder_id=self.folder['id'])
        self.assertEqual(response.status_code, 400)
        self.assertFalse(MediaVersion.objects.exists())

    def test_version_target_must_live_in_the_chosen_project(self):
        other = self.upload('elsewhere.png')
        response = self.publish(version_of_id=other['id'])
        self.assertEqual(response.status_code, 400)
        self.assertFalse(MediaVersion.objects.exists())

    def test_a_file_still_processing_cannot_be_published(self):
        File.objects.filter(id=self.asset['file']['id']).update(status=FileStatus.PENDING)
        response = self.publish()
        self.assertEqual(response.status_code, 400)
        self.assertIn('still being processed', response.json()['detail'])

    def test_a_rejected_note_rolls_the_whole_publish_back(self):
        response = self.publish(notes=[
            {'key': 'ok', 'text': 'Fine'},
            {'key': 'bad', 'text': 'Mentions a stranger', 'mentioned_user_ids': [str(uuid.uuid4())]},
        ])
        self.assertEqual(response.status_code, 400, response.content)
        self.assertFalse(MediaVersion.objects.exists())
        self.assertFalse(ReviewComment.objects.exists())
        self.assertIsNone(ProjectFile.objects.get(id=self.asset['id']).project_id)

    def test_duplicate_note_keys_are_rejected(self):
        response = self.publish(notes=[{'key': 'same', 'text': 'a'}, {'key': 'same', 'text': 'b'}])
        self.assertEqual(response.status_code, 400)

    def test_read_only_members_cannot_publish(self):
        viewer = self.member([WORKSPACE_READ, PROJECT_READ, MEDIA_READ, PROJECT_FILE_READ])
        self.client.force_authenticate(viewer)
        self.assertEqual(self.publish().status_code, 403)
        self.assertFalse(MediaVersion.objects.exists())

    def test_members_without_access_to_the_project_cannot_publish_into_it(self):
        keys = [WORKSPACE_READ, PROJECT_READ, MEDIA_READ, MEDIA_CREATE, PROJECT_FILE_READ, PROJECT_FILE_UPDATE]
        outsider = self.member(keys, mode=ProjectAccessMode.SELECTED)
        self.client.force_authenticate(outsider)
        self.assertEqual(self.publish().status_code, 403)

    def test_notes_need_comment_rights_but_a_bare_publish_does_not(self):
        keys = [WORKSPACE_READ, PROJECT_READ, MEDIA_READ, MEDIA_CREATE, PROJECT_FILE_READ, PROJECT_FILE_UPDATE]
        editor = self.member(keys)
        self.client.force_authenticate(editor)
        refused = self.publish(notes=[{'key': 'n', 'text': 'Hello'}])
        self.assertEqual(refused.status_code, 403)
        self.assertIn('comment', refused.json()['detail'])
        self.assertEqual(self.publish().status_code, 201)

    def test_anonymous_requests_are_refused(self):
        self.client.force_authenticate(None)
        self.assertIn(self.publish().status_code, (401, 403))
