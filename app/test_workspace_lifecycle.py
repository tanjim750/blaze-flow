from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .models import ProjectAccessMode, Workspace, WorkspaceProfile, WorkspaceStatus
from .test_access_projects import WorkspaceAccessSetupMixin


class WorkspaceDetailApiTests(WorkspaceAccessSetupMixin, TestCase):
    def test_owner_can_read_and_update_workspace(self):
        self.client.force_authenticate(self.owner)

        read = self.client.get(reverse('api-workspace-detail', args=[self.workspace.id]))
        self.assertEqual(read.status_code, 200)
        self.assertEqual(read.json()['name'], self.workspace.name)

        updated = self.client.patch(
            reverse('api-workspace-detail', args=[self.workspace.id]),
            {'name': 'Renamed Workspace', 'timezone': 'America/New_York'},
            format='json',
        )
        self.assertEqual(updated.status_code, 200)
        self.workspace.refresh_from_db()
        self.assertEqual(self.workspace.name, 'Renamed Workspace')
        self.assertEqual(self.workspace.timezone, 'America/New_York')

    def test_invalid_timezone_update_is_rejected(self):
        self.client.force_authenticate(self.owner)

        response = self.client.patch(
            reverse('api-workspace-detail', args=[self.workspace.id]),
            {'timezone': 'Not/AZone'},
            format='json',
        )

        self.assertEqual(response.status_code, 400)

    def test_empty_update_is_rejected(self):
        self.client.force_authenticate(self.owner)

        response = self.client.patch(
            reverse('api-workspace-detail', args=[self.workspace.id]),
            {},
            format='json',
        )

        self.assertEqual(response.status_code, 400)

    def test_member_can_read_but_not_update_workspace(self):
        self.invite_and_accept()
        self.client.force_authenticate(self.member_user)

        read = self.client.get(reverse('api-workspace-detail', args=[self.workspace.id]))
        updated = self.client.patch(
            reverse('api-workspace-detail', args=[self.workspace.id]),
            {'name': 'Should fail'},
            format='json',
        )

        self.assertEqual(read.status_code, 200)
        self.assertEqual(updated.status_code, 403)

    def test_outsider_cannot_read_workspace(self):
        outsider = self._make_user('workspace-outsider@example.com')
        self.client.force_authenticate(outsider)

        response = self.client.get(reverse('api-workspace-detail', args=[self.workspace.id]))

        self.assertEqual(response.status_code, 403)

    def _make_user(self, email):
        from django.contrib.auth import get_user_model

        return get_user_model().objects.create_user(
            email=email, password='a-secure-test-password', first_name='Out', last_name='Sider',
        )


class WorkspaceDeletionLifecycleApiTests(WorkspaceAccessSetupMixin, TestCase):
    def test_owner_can_schedule_and_restore_deletion(self):
        self.client.force_authenticate(self.owner)

        scheduled = self.client.delete(reverse('api-workspace-detail', args=[self.workspace.id]))
        self.assertEqual(scheduled.status_code, 200)
        self.workspace.refresh_from_db()
        self.assertEqual(self.workspace.status, WorkspaceStatus.PENDING_DELETION)
        self.assertIsNotNone(self.workspace.deletion_scheduled_at)
        self.assertGreater(self.workspace.deletion_scheduled_at, timezone.now())

        restored = self.client.post(reverse('api-workspace-restore', args=[self.workspace.id]))
        self.assertEqual(restored.status_code, 200)
        self.workspace.refresh_from_db()
        self.assertEqual(self.workspace.status, WorkspaceStatus.ACTIVE)
        self.assertIsNone(self.workspace.deletion_scheduled_at)

    def test_scheduling_deletion_twice_is_rejected(self):
        self.client.force_authenticate(self.owner)
        self.client.delete(reverse('api-workspace-detail', args=[self.workspace.id]))

        response = self.client.delete(reverse('api-workspace-detail', args=[self.workspace.id]))

        self.assertEqual(response.status_code, 400)

    def test_restoring_an_active_workspace_is_rejected(self):
        self.client.force_authenticate(self.owner)

        response = self.client.post(reverse('api-workspace-restore', args=[self.workspace.id]))

        self.assertEqual(response.status_code, 400)

    def test_member_cannot_schedule_deletion(self):
        self.invite_and_accept()
        self.client.force_authenticate(self.member_user)

        response = self.client.delete(reverse('api-workspace-detail', args=[self.workspace.id]))

        self.assertEqual(response.status_code, 403)
        self.workspace.refresh_from_db()
        self.assertEqual(self.workspace.status, WorkspaceStatus.ACTIVE)


class WorkspaceProfileApiTests(WorkspaceAccessSetupMixin, TestCase):
    def test_owner_can_read_default_and_update_profile(self):
        self.client.force_authenticate(self.owner)

        read = self.client.get(reverse('api-workspace-profile', args=[self.workspace.id]))
        self.assertEqual(read.status_code, 200)
        self.assertIsNone(read.json()['business_name'])
        self.assertFalse(WorkspaceProfile.objects.filter(workspace=self.workspace).exists())

        updated = self.client.patch(
            reverse('api-workspace-profile', args=[self.workspace.id]),
            {'business_name': 'Acme Creative Agency', 'city': 'Austin', 'country_code': 'US'},
            format='json',
        )
        self.assertEqual(updated.status_code, 200)
        profile = WorkspaceProfile.objects.get(workspace=self.workspace)
        self.assertEqual(profile.business_name, 'Acme Creative Agency')
        self.assertEqual(profile.city, 'Austin')

    def test_profile_updates_are_idempotent_on_the_same_row(self):
        self.client.force_authenticate(self.owner)
        self.client.patch(
            reverse('api-workspace-profile', args=[self.workspace.id]),
            {'business_name': 'First'},
            format='json',
        )

        self.client.patch(
            reverse('api-workspace-profile', args=[self.workspace.id]),
            {'business_name': 'Second'},
            format='json',
        )

        self.assertEqual(WorkspaceProfile.objects.filter(workspace=self.workspace).count(), 1)
        self.assertEqual(WorkspaceProfile.objects.get(workspace=self.workspace).business_name, 'Second')

    def test_member_can_read_but_not_update_profile(self):
        self.invite_and_accept()
        self.client.force_authenticate(self.member_user)

        read = self.client.get(reverse('api-workspace-profile', args=[self.workspace.id]))
        updated = self.client.patch(
            reverse('api-workspace-profile', args=[self.workspace.id]),
            {'business_name': 'Should fail'},
            format='json',
        )

        self.assertEqual(read.status_code, 200)
        self.assertEqual(updated.status_code, 403)
