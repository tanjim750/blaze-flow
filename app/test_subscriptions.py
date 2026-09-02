import uuid
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from .models import SubscriptionPlan, SubscriptionStatus, UserSubscription
from .services import process_expired_subscriptions
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
