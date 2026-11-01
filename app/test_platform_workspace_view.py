"""Platform staff "view workspace" (read-only) and staff plan changes."""
from django.contrib.auth.models import Permission
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from .models import (
    AuditActorType, AuditLog, PlatformWorkspaceView, Project, SubscriptionPlan, SubscriptionStatus, User,
    UserSubscription,
)
from .services.workspaces import create_workspace

PW = 'pw-123456789'


def grant(user):
    user.user_permissions.add(Permission.objects.get(codename='access_platform_admin'))
    return User.objects.get(id=user.id)


class WorkspaceViewTests(TestCase):
    def setUp(self):
        self.staff = grant(User.objects.create_user(email='staff@example.com', password=PW, first_name='Sam', last_name='Staff'))
        self.customer = User.objects.create_user(email='cust@example.com', password=PW, first_name='Cara', last_name='Customer')
        self.workspace, _ = create_workspace(owner=self.customer, name='Cara Studio', slug='cara-studio', workspace_timezone='UTC')
        self.other_owner = User.objects.create_user(email='other@example.com', password=PW, first_name='O', last_name='T')
        self.other, _ = create_workspace(owner=self.other_owner, name='Other', slug='other', workspace_timezone='UTC')
        owner_client = APIClient()
        owner_client.login(email=self.customer.email, password=PW)
        response = owner_client.post(reverse('api-projects', args=[self.workspace.id]), {'name': 'Launch film'}, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        self.project_id = response.json()['id']
        self.client = APIClient()
        # Session login, as the real app does, so the read-only middleware sees the user.
        self.assertTrue(self.client.login(email=self.staff.email, password=PW))

    def start(self, workspace=None):
        return self.client.post(reverse('api-platform-workspace-view-start', args=[(workspace or self.workspace).id]), {}, format='json')

    def test_non_staff_cannot_start_end_or_read_a_view(self):
        for user in (self.customer, User.objects.create_user(email='dj@example.com', password=PW, first_name='D', last_name='J', is_staff=True)):
            client = APIClient()
            client.login(email=user.email, password=PW)
            self.assertEqual(client.post(reverse('api-platform-workspace-view-start', args=[self.other.id]), {}, format='json').status_code, 403)
            self.assertEqual(client.get(reverse('api-platform-view')).status_code, 403)
            self.assertEqual(client.post(reverse('api-platform-view-end'), {}, format='json').status_code, 403)
            self.assertEqual(client.get(reverse('api-projects', args=[self.other.id])).status_code, 403)
        self.assertFalse(PlatformWorkspaceView.objects.exists())

    def test_staff_without_a_view_cannot_read_customer_workspace(self):
        self.assertEqual(self.client.get(reverse('api-projects', args=[self.workspace.id])).status_code, 403)
        self.assertEqual(self.client.get(reverse('api-workspaces')).json(), [])

    def test_staff_view_reads_the_workspace_as_its_owner(self):
        self.assertEqual(self.start().status_code, 201)
        workspaces = self.client.get(reverse('api-workspaces')).json()
        self.assertEqual([w['id'] for w in workspaces], [str(self.workspace.id)])
        self.assertTrue(workspaces[0]['platform_view'])
        projects = self.client.get(reverse('api-projects', args=[self.workspace.id]))
        self.assertEqual(projects.status_code, 200)
        self.assertIn('Launch film', str(projects.content))
        self.assertEqual(self.client.get(reverse('api-client-teams', args=[self.workspace.id])).status_code, 200)
        self.assertEqual(self.client.get(reverse('api-billing-invoices', args=[self.workspace.id])).status_code, 200)
        # Only the viewed workspace, never another one.
        self.assertEqual(self.client.get(reverse('api-projects', args=[self.other.id])).status_code, 403)

    def test_every_write_is_refused_while_viewing(self):
        self.start()
        attempts = [
            ('post', reverse('api-projects', args=[self.workspace.id]), {'name': 'Sneaky'}),
            ('patch', reverse('api-workspace-detail', args=[self.workspace.id]), {'name': 'Renamed'}),
            ('delete', reverse('api-workspace-detail', args=[self.workspace.id]), None),
            ('post', reverse('api-billing-invoices', args=[self.workspace.id]), {}),
            ('post', reverse('api-client-teams', args=[self.workspace.id]), {'name': 'X'}),
            # Not even in the staffer's own workspaces.
            ('post', reverse('api-workspaces'), {'name': 'Mine', 'slug': 'mine', 'timezone': 'UTC'}),
        ]
        for method, url, body in attempts:
            response = getattr(self.client, method)(url, body, format='json')
            self.assertEqual(response.status_code, 403, (method, url, response.content))
            self.assertEqual(response.json()['code'], 'platform_view_read_only')
        self.assertFalse(Project.objects.filter(name='Sneaky').exists())
        self.workspace.refresh_from_db()
        self.assertEqual(self.workspace.name, 'Cara Studio')

    def test_start_and_end_are_audited_and_end_restores_normal_access(self):
        self.start()
        started = AuditLog.objects.get(action='platform.workspace.view_started')
        self.assertEqual((started.actor_type, started.actor_user_id, started.workspace_id), (AuditActorType.PLATFORM_STAFF, self.staff.id, self.workspace.id))
        response = self.client.post(reverse('api-platform-view-end'), {}, format='json')
        self.assertEqual(response.status_code, 200)
        ended = AuditLog.objects.get(action='platform.workspace.view_ended')
        self.assertEqual((ended.actor_user_id, ended.workspace_id), (self.staff.id, self.workspace.id))
        self.assertEqual(self.client.get(reverse('api-projects', args=[self.workspace.id])).status_code, 403)
        self.assertFalse(self.client.get(reverse('api-platform-view')).json()['active'])

    def test_switching_workspace_ends_the_previous_view(self):
        self.start()
        self.start(self.other)
        self.assertEqual(PlatformWorkspaceView.objects.filter(ended_at__isnull=True).count(), 1)
        self.assertEqual(AuditLog.objects.filter(action='platform.workspace.view_ended', workspace=self.workspace).count(), 1)

    def test_expired_view_grants_nothing(self):
        self.start()
        PlatformWorkspaceView.objects.update(expires_at=timezone.now())
        self.assertEqual(self.client.get(reverse('api-projects', args=[self.workspace.id])).status_code, 403)

    def test_revoked_staff_loses_the_view(self):
        self.start()
        self.staff.user_permissions.clear()
        self.assertEqual(self.client.get(reverse('api-projects', args=[self.workspace.id])).status_code, 403)

    def test_customer_is_unaffected_by_a_staff_view(self):
        self.start()
        owner_client = APIClient()
        owner_client.login(email=self.customer.email, password=PW)
        self.assertEqual(owner_client.post(reverse('api-projects', args=[self.workspace.id]), {'name': 'Still fine'}, format='json').status_code, 201)


class ChangePlanTests(TestCase):
    def setUp(self):
        self.staff = grant(User.objects.create_user(email='staff@example.com', password=PW, first_name='Sam', last_name='Staff'))
        self.customer = User.objects.create_user(email='cust@example.com', password=PW, first_name='Cara', last_name='Customer')
        self.workspace, _ = create_workspace(owner=self.customer, name='Cara Studio', slug='cara-studio', workspace_timezone='UTC')
        self.client = APIClient()
        self.client.login(email=self.staff.email, password=PW)
        self.url = reverse('api-platform-workspace-plan', args=[self.workspace.id])

    def plan(self):
        sub = UserSubscription.objects.filter(user=self.customer, status__in=(SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE)).first()
        return sub.plan if sub else 'FREE'

    def test_only_staff_can_change_plan(self):
        for user in (self.customer, User.objects.create_user(email='dj@example.com', password=PW, first_name='D', last_name='J', is_staff=True)):
            client = APIClient()
            client.login(email=user.email, password=PW)
            self.assertEqual(client.post(self.url, {'plan': 'PRO'}, format='json').status_code, 403)
        self.assertEqual(self.plan(), 'FREE')
        self.assertFalse(AuditLog.objects.filter(action='platform.workspace.plan_changed').exists())

    def test_change_writes_audit_with_old_new_actor_reason_and_keeps_billing(self):
        import uuid
        now = timezone.now()
        UserSubscription.objects.filter(user=self.customer).delete()
        UserSubscription.objects.create(
            id=uuid.uuid4(), user=self.customer, plan=SubscriptionPlan.FREE, status=SubscriptionStatus.ACTIVE,
            provider='stripe', provider_subscription_id='sub_123', started_at=now, created_at=now, updated_at=now,
        )
        response = self.client.post(self.url, {'plan': 'PRO', 'reason': 'Comp for outage'}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual((response.json()['old_plan'], response.json()['new_plan'], response.json()['billing_changed']), ('FREE', 'PRO', False))
        self.assertEqual(self.plan(), 'PRO')
        sub = UserSubscription.objects.get(user=self.customer, status=SubscriptionStatus.ACTIVE)
        self.assertEqual((sub.provider, sub.provider_subscription_id), ('stripe', 'sub_123'))
        row = AuditLog.objects.get(action='platform.workspace.plan_changed')
        self.assertEqual(row.actor_user_id, self.staff.id)
        self.assertEqual(row.actor_type, AuditActorType.PLATFORM_STAFF)
        self.assertEqual(row.workspace_id, self.workspace.id)
        self.assertEqual((row.metadata['old_plan'], row.metadata['new_plan'], row.metadata['reason']), ('FREE', 'PRO', 'Comp for outage'))

    def test_reason_is_optional_and_unknown_plan_rejected(self):
        self.assertEqual(self.client.post(self.url, {'plan': 'SOLO'}, format='json').status_code, 200)
        self.assertEqual(self.client.post(self.url, {'plan': 'STUDIO'}, format='json').status_code, 400)
        self.assertEqual(self.client.post(self.url, {'plan': 'SOLO'}, format='json').status_code, 409)

    @override_settings(PLAN_LIMITS={
        'FREE': {'max_workspaces_owned': 1, 'max_projects_per_workspace': 1, 'max_storage_bytes': 10, 'whatsapp_messages_per_month': 1},
        'PRO': {'max_workspaces_owned': 5, 'max_projects_per_workspace': 10, 'max_storage_bytes': 10 ** 9, 'whatsapp_messages_per_month': 1},
        'SOLO': {'max_workspaces_owned': 1, 'max_projects_per_workspace': 10, 'max_storage_bytes': 10 ** 9, 'whatsapp_messages_per_month': 1, 'max_members': 1, 'features': []},
    })
    def test_downgrade_over_limits_warns_keeps_data_and_enforces_immediately(self):
        self.client.post(self.url, {'plan': 'PRO'}, format='json')
        owner = APIClient()
        owner.login(email=self.customer.email, password=PW)
        for name in ('A', 'B'):
            self.assertEqual(owner.post(reverse('api-projects', args=[self.workspace.id]), {'name': name}, format='json').status_code, 201)
        response = self.client.post(self.url, {'plan': 'FREE', 'reason': 'Trial over'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertIn('projects', [w['code'] for w in response.json()['warnings']])
        self.assertEqual(Project.objects.filter(workspace=self.workspace).count(), 2)
        self.assertNotEqual(owner.post(reverse('api-projects', args=[self.workspace.id]), {'name': 'C'}, format='json').status_code, 201)
