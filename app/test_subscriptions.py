import uuid
from concurrent.futures import ThreadPoolExecutor
from io import StringIO
from threading import Barrier

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.db import close_old_connections, transaction
from django.test import TestCase, TransactionTestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from .models import File, FileStatus, Project, StorageBackend, SubscriptionPlan, SubscriptionStatus, UserSubscription, Workspace
from .services import (
    SubscriptionError,
    enforce_workspace_storage_limit,
    process_expired_subscriptions,
    workspace_storage_bytes_used,
)
from .test_access_projects import WorkspaceAccessSetupMixin


class RegistrationSubscriptionTests(TestCase):
    def test_registration_provisions_a_free_active_subscription(self):
        client = APIClient()

        response = client.post(
            reverse('api-register'),
            {
                'email': 'new-subscriber@example.com',
                'password': 'a-secure-test-password',
                'first_name': 'New',
                'last_name': 'Subscriber',
            },
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        user = get_user_model().objects.get(email='new-subscriber@example.com')
        subscription = UserSubscription.objects.get(user=user)
        self.assertEqual(subscription.plan, SubscriptionPlan.FREE)
        self.assertEqual(subscription.status, SubscriptionStatus.ACTIVE)


class SubscriptionApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = get_user_model().objects.create_user(
            email='subscriber@example.com',
            password='a-secure-test-password',
            first_name='Sub',
            last_name='Scriber',
        )
        self.client.force_authenticate(self.user)

    def test_pre_existing_user_without_a_row_gets_a_free_default_without_persisting(self):
        response = self.client.get(reverse('api-subscription-detail'))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['plan'], SubscriptionPlan.FREE)
        self.assertEqual(response.json()['limits']['max_workspaces_owned'], 1)
        self.assertFalse(UserSubscription.objects.filter(user=self.user).exists())

    def test_upgrade_to_pro_sets_plan_and_period(self):
        response = self.client.post(reverse('api-subscription-upgrade'))

        self.assertEqual(response.status_code, 201)
        subscription = UserSubscription.objects.get(user=self.user)
        self.assertEqual(subscription.plan, SubscriptionPlan.PRO)
        self.assertEqual(subscription.status, SubscriptionStatus.ACTIVE)
        self.assertIsNotNone(subscription.current_period_start)
        self.assertIsNotNone(subscription.current_period_end)
        self.assertEqual(response.json()['limits']['max_workspaces_owned'], 20)

    def test_upgrading_twice_is_rejected(self):
        self.client.post(reverse('api-subscription-upgrade'))

        response = self.client.post(reverse('api-subscription-upgrade'))

        self.assertEqual(response.status_code, 400)

    def test_cancel_without_active_pro_is_rejected(self):
        response = self.client.post(reverse('api-subscription-cancel'))

        self.assertEqual(response.status_code, 400)

    def test_cancel_then_resume(self):
        self.client.post(reverse('api-subscription-upgrade'))

        cancelled = self.client.post(reverse('api-subscription-cancel'))
        self.assertEqual(cancelled.status_code, 200)
        self.assertTrue(cancelled.json()['cancel_at_period_end'])
        subscription = UserSubscription.objects.get(user=self.user)
        self.assertEqual(subscription.plan, SubscriptionPlan.PRO)

        double_cancel = self.client.post(reverse('api-subscription-cancel'))
        self.assertEqual(double_cancel.status_code, 400)

        resumed = self.client.post(reverse('api-subscription-resume'))
        self.assertEqual(resumed.status_code, 200)
        self.assertFalse(resumed.json()['cancel_at_period_end'])

    def test_resume_without_pending_cancellation_is_rejected(self):
        self.client.post(reverse('api-subscription-upgrade'))

        response = self.client.post(reverse('api-subscription-resume'))

        self.assertEqual(response.status_code, 400)

    def test_anonymous_user_cannot_read_subscription(self):
        anonymous_client = APIClient()

        response = anonymous_client.get(reverse('api-subscription-detail'))

        self.assertIn(response.status_code, (401, 403))


class ProcessExpiredSubscriptionsTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            email='expiring@example.com',
            password='a-secure-test-password',
            first_name='Expiring',
            last_name='User',
        )

    def _pro_subscription(self, *, cancel_at_period_end, period_end):
        now = timezone.now()
        return UserSubscription.objects.create(
            id=uuid.uuid4(),
            user=self.user,
            plan=SubscriptionPlan.PRO,
            status=SubscriptionStatus.ACTIVE,
            started_at=now,
            current_period_start=now,
            current_period_end=period_end,
            cancel_at_period_end=cancel_at_period_end,
            cancelled_at=now if cancel_at_period_end else None,
            created_at=now,
            updated_at=now,
        )

    def test_dry_run_does_not_modify_anything(self):
        subscription = self._pro_subscription(
            cancel_at_period_end=True, period_end=timezone.now() - timezone.timedelta(days=1)
        )

        affected = process_expired_subscriptions(dry_run=True)

        self.assertEqual(len(affected), 1)
        subscription.refresh_from_db()
        self.assertEqual(subscription.plan, SubscriptionPlan.PRO)

    def test_expired_scheduled_cancellation_downgrades_to_free(self):
        subscription = self._pro_subscription(
            cancel_at_period_end=True, period_end=timezone.now() - timezone.timedelta(days=1)
        )

        affected = process_expired_subscriptions(dry_run=False)

        self.assertEqual(len(affected), 1)
        subscription.refresh_from_db()
        self.assertEqual(subscription.plan, SubscriptionPlan.FREE)
        self.assertFalse(subscription.cancel_at_period_end)
        self.assertIsNone(subscription.cancelled_at)

    def test_subscription_not_yet_due_is_untouched(self):
        subscription = self._pro_subscription(
            cancel_at_period_end=True, period_end=timezone.now() + timezone.timedelta(days=10)
        )

        affected = process_expired_subscriptions(dry_run=False)

        self.assertEqual(len(affected), 0)
        subscription.refresh_from_db()
        self.assertEqual(subscription.plan, SubscriptionPlan.PRO)

    def test_subscription_without_scheduled_cancellation_is_untouched(self):
        subscription = self._pro_subscription(
            cancel_at_period_end=False, period_end=timezone.now() - timezone.timedelta(days=1)
        )

        affected = process_expired_subscriptions(dry_run=False)

        self.assertEqual(len(affected), 0)
        subscription.refresh_from_db()
        self.assertEqual(subscription.plan, SubscriptionPlan.PRO)

    def test_management_command_dry_run_leaves_plan_unchanged(self):
        subscription = self._pro_subscription(
            cancel_at_period_end=True, period_end=timezone.now() - timezone.timedelta(days=1)
        )
        output = StringIO()

        call_command('process_expired_subscriptions', '--dry-run', stdout=output)

        subscription.refresh_from_db()
        self.assertEqual(subscription.plan, SubscriptionPlan.PRO)
        self.assertIn('Would downgrade 1', output.getvalue())

    def test_management_command_downgrades(self):
        subscription = self._pro_subscription(
            cancel_at_period_end=True, period_end=timezone.now() - timezone.timedelta(days=1)
        )
        output = StringIO()

        call_command('process_expired_subscriptions', stdout=output)

        subscription.refresh_from_db()
        self.assertEqual(subscription.plan, SubscriptionPlan.FREE)
        self.assertIn('Downgraded 1', output.getvalue())


class WorkspacePlanLimitApiTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.owner.email_verified_at = timezone.now()
        self.owner.save(update_fields=['email_verified_at'])

    def test_free_owner_cannot_create_a_second_workspace(self):
        self.client.force_authenticate(self.owner)

        response = self.client.post(
            reverse('api-workspaces'),
            {'name': 'Second Workspace', 'timezone': 'UTC'},
            format='json',
        )

        self.assertEqual(response.status_code, 400)

    def test_owner_can_create_a_second_workspace_after_upgrading(self):
        self.client.force_authenticate(self.owner)
        self.client.post(reverse('api-subscription-upgrade'))

        response = self.client.post(
            reverse('api-workspaces'),
            {'name': 'Second Workspace', 'timezone': 'UTC'},
            format='json',
        )

        self.assertEqual(response.status_code, 201)


class ProjectPlanLimitApiTests(WorkspaceAccessSetupMixin, TestCase):
    def _create_project(self, name):
        return self.client.post(
            reverse('api-projects', args=[self.workspace.id]),
            {'name': name},
            format='json',
        )

    def test_free_owner_is_capped_at_three_projects_per_workspace(self):
        self.client.force_authenticate(self.owner)

        first = self._create_project('Project 1')
        second = self._create_project('Project 2')
        third = self._create_project('Project 3')
        fourth = self._create_project('Project 4')

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertEqual(third.status_code, 201)
        self.assertEqual(fourth.status_code, 400)

    def test_fourth_project_succeeds_after_owner_upgrades(self):
        self.client.force_authenticate(self.owner)
        self._create_project('Project 1')
        self._create_project('Project 2')
        self._create_project('Project 3')
        self.client.post(reverse('api-subscription-upgrade'))

        fourth = self._create_project('Project 4')

        self.assertEqual(fourth.status_code, 201)


@override_settings(PLAN_LIMITS={
    'FREE': {'max_workspaces_owned': 1, 'max_projects_per_workspace': 3, 'max_storage_bytes': 10},
    'PRO': {'max_workspaces_owned': 20, 'max_projects_per_workspace': 200, 'max_storage_bytes': 1_000_000},
})
class StoragePlanLimitApiTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.owner)
        project_response = self.client.post(
            reverse('api-projects', args=[self.workspace.id]),
            {'name': 'Storage Project'},
            format='json',
        )
        self.project = Project.objects.get(id=project_response.json()['id'])

    def _upload(self, name='frame.png'):
        return self.client.post(
            reverse('api-media-versions', args=[self.workspace.id, self.project.id]),
            {
                'file': SimpleUploadedFile(name, b'\x89PNG\r\n\x1a\npng-data-well-past-ten-bytes', content_type='image/png'),
                'title': name,
            },
            format='multipart',
        )

    def test_upload_beyond_free_storage_cap_is_rejected(self):
        response = self._upload()
        self.assertEqual(response.status_code, 400)

    def test_project_file_upload_obeys_storage_cap(self):
        response = self.client.post(
            reverse('api-project-files', args=[self.workspace.id, self.project.id]),
            {'file': SimpleUploadedFile(
                'reference.png', b'\x89PNG\r\n\x1a\nproject-file-over-cap', content_type='image/png',
            )},
            format='multipart',
        )

        self.assertEqual(response.status_code, 400)

    def test_task_attachment_upload_obeys_storage_cap(self):
        task = self.client.post(
            reverse('api-tasks', args=[self.workspace.id]),
            {'title': 'Quota task'},
            format='json',
        ).json()

        response = self.client.post(
            reverse('api-task-attachments', args=[self.workspace.id, task['id']]),
            {'file': SimpleUploadedFile(
                'reference.png', b'\x89PNG\r\n\x1a\ntask-attachment-over-cap', content_type='image/png',
            )},
            format='multipart',
        )

        self.assertEqual(response.status_code, 400)

    def test_review_attachment_upload_obeys_storage_cap(self):
        self.client.post(reverse('api-subscription-upgrade'))
        media = self._upload().json()
        comment = self.client.post(
            reverse('api-review-comments', args=[self.workspace.id, self.project.id, media['id']]),
            {'text': 'Quota review'},
            format='json',
        ).json()
        UserSubscription.objects.filter(user=self.owner).update(plan=SubscriptionPlan.FREE)

        response = self.client.post(
            reverse('api-review-attachment-upload', args=[
                self.workspace.id, self.project.id, media['id'], comment['id'],
            ]),
            {'file': SimpleUploadedFile(
                'reference.pdf', b'%PDF-1.7\nreview-attachment-over-cap', content_type='application/pdf',
            )},
            format='multipart',
        )

        self.assertEqual(response.status_code, 400)

    def test_upload_succeeds_after_owner_upgrades_to_pro(self):
        self.client.post(reverse('api-subscription-upgrade'))

        response = self._upload()

        self.assertEqual(response.status_code, 201)


@override_settings(PLAN_LIMITS={
    'FREE': {'max_workspaces_owned': 1, 'max_projects_per_workspace': 3, 'max_storage_bytes': 10},
    'PRO': {'max_workspaces_owned': 20, 'max_projects_per_workspace': 200, 'max_storage_bytes': 1_000_000},
})
class StoragePlanLimitConcurrencyTests(WorkspaceAccessSetupMixin, TransactionTestCase):
    reset_sequences = True

    def setUp(self):
        super().setUp()
        self.backend = StorageBackend.objects.create(
            id=uuid.uuid4(), name='Quota test storage', provider='quota-test',
            created_at=timezone.now(), updated_at=timezone.now(),
        )

    def _attempt_upload(self, barrier):
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            with transaction.atomic():
                workspace = Workspace.objects.get(id=self.workspace.id)
                enforce_workspace_storage_limit(
                    workspace=workspace, additional_bytes=8, lock=True,
                )
                File.objects.create(
                    id=uuid.uuid4(), workspace=workspace, storage_backend=self.backend,
                    object_key=f'quota/{uuid.uuid4()}', original_name='concurrent.bin',
                    mime_type='application/octet-stream', size_bytes=8,
                    status=FileStatus.READY, created_at=timezone.now(), updated_at=timezone.now(),
                )
            return True
        except SubscriptionError:
            return False
        finally:
            close_old_connections()

    def test_concurrent_uploads_cannot_exceed_workspace_cap(self):
        barrier = Barrier(2)
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: self._attempt_upload(barrier), range(2)))

        self.assertEqual(sorted(results), [False, True])
        self.assertEqual(workspace_storage_bytes_used(workspace=self.workspace), 8)
