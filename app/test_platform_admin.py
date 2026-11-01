import uuid
from datetime import timedelta
from io import StringIO

from django.contrib.auth.models import Permission
from django.core import mail
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from .models import (
    AuditActorType, AuditLog, OutboxEvent, OutboxEventStatus, SubscriptionPlan, SubscriptionStatus,
    SupportMessageKind, SupportTicket, SupportTicketStatus, User, UserSubscription,
)
from .services import process_outbox_events
from .services.workspaces import create_workspace

PLATFORM_URLS = [
    ('api-platform-overview', []), ('api-platform-workspaces', []), ('api-platform-users', []),
    ('api-platform-jobs', []), ('api-platform-tickets', []), ('api-platform-audit', []),
]


def grant(user):
    user.user_permissions.add(Permission.objects.get(codename='access_platform_admin'))
    return User.objects.get(id=user.id)  # drop the permission cache


class PlatformAdminTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.staff = grant(User.objects.create_user(email='staff@example.com', password='pw-123456789', first_name='Sam', last_name='Staff'))
        self.customer = User.objects.create_user(email='cust@example.com', password='pw-123456789', first_name='Cara', last_name='Customer')
        self.workspace, _ = create_workspace(owner=self.customer, name='Cara Studio', slug='cara-studio', workspace_timezone='UTC')

    def test_every_platform_endpoint_rejects_non_staff_including_is_staff(self):
        django_staff = User.objects.create_user(email='djstaff@example.com', password='pw-123456789', first_name='D', last_name='J', is_staff=True)
        for user in (self.customer, django_staff):
            self.client.force_authenticate(user)
            for name, args in PLATFORM_URLS:
                self.assertEqual(self.client.get(reverse(name, args=args)).status_code, 403, name)
            self.assertEqual(self.client.get(reverse('api-platform-workspace-detail', args=[self.workspace.id])).status_code, 403)
            self.assertEqual(self.client.post(reverse('api-platform-jobs-retry'), {'items': [], 'reason': 'x'}, format='json').status_code, 403)
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(reverse('api-platform-overview')).status_code, (401, 403))

    def test_current_user_reports_platform_access(self):
        self.client.force_authenticate(self.staff)
        self.assertTrue(self.client.get(reverse('api-current-user')).data['is_platform_staff'])
        self.client.force_authenticate(self.customer)
        self.assertFalse(self.client.get(reverse('api-current-user')).data['is_platform_staff'])

    @override_settings(PLATFORM_PRO_PRICE_MINOR=2900)
    def test_overview_counts_plans_trials_mrr_and_churn(self):
        now = timezone.now()
        def user(n):
            return User.objects.create_user(email=f'u{n}@example.com', password='pw-123456789', first_name='U', last_name=str(n))
        def sub(u, **kw):
            base = dict(id=uuid.uuid4(), user=u, started_at=now - timedelta(days=3), created_at=now, updated_at=now)
            return UserSubscription.objects.create(**{**base, **kw})
        sub(user(1), plan=SubscriptionPlan.PRO, status=SubscriptionStatus.ACTIVE)
        sub(user(2), plan=SubscriptionPlan.PRO, status=SubscriptionStatus.ACTIVE)
        sub(user(3), plan=SubscriptionPlan.PRO, status=SubscriptionStatus.ACTIVE, trial_ends_at=now + timedelta(days=5))
        sub(user(4), plan=SubscriptionPlan.PRO, status=SubscriptionStatus.CANCELLED, cancelled_at=now - timedelta(days=2))
        sub(user(5), plan=SubscriptionPlan.PRO, status=SubscriptionStatus.ACTIVE, trial_ends_at=now - timedelta(days=1))
        self.client.force_authenticate(self.staff)
        data = self.client.get(reverse('api-platform-overview'), {'days': 30}).data
        self.assertEqual(data['plans']['pro'], 4)
        self.assertEqual(data['plans']['trialing'], 1)
        self.assertEqual(data['plans']['pro_paying'], 3)
        self.assertEqual(data['revenue']['mrr_minor'], 3 * 2900)
        self.assertEqual(data['revenue']['churned'], 1)
        self.assertEqual(data['revenue']['trials_ended'], 1)
        self.assertEqual(data['revenue']['trials_converted'], 1)
        self.assertEqual(data['users']['total'], 7)
        self.assertEqual(len(data['users']['signups_by_day']), 30)
        self.assertTrue(data['mrr_is_estimate'])

    def test_workspace_and_user_detail(self):
        self.client.force_authenticate(self.staff)
        listing = self.client.get(reverse('api-platform-workspaces'), {'q': 'cust@'}).data
        self.assertEqual(listing['total'], 1)
        self.assertEqual(listing['results'][0]['owner']['email'], 'cust@example.com')
        detail = self.client.get(reverse('api-platform-workspace-detail', args=[self.workspace.id])).data
        self.assertEqual(detail['members_list'][0]['is_primary_owner'], True)
        self.assertIn('status', detail['health'])
        users = self.client.get(reverse('api-platform-users'), {'q': 'cara'}).data
        self.assertEqual(users['results'][0]['email'], 'cust@example.com')
        detail = self.client.get(reverse('api-platform-user-detail', args=[self.customer.id])).data
        self.assertEqual(detail['workspaces'][0]['name'], 'Cara Studio')

    def test_user_actions_require_reason_and_are_audited(self):
        self.client.force_authenticate(self.staff)
        url = reverse('api-platform-user-action', args=[self.customer.id, 'password-reset'])
        self.assertEqual(self.client.post(url, {}, format='json').status_code, 400)
        self.assertEqual(len(mail.outbox), 0)
        response = self.client.post(url, {'reason': 'Ticket #1: locked out'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        row = AuditLog.objects.get(action='platform.user.password_reset_sent')
        self.assertEqual(row.actor_type, AuditActorType.PLATFORM_STAFF)
        self.assertEqual(row.actor_user, self.staff)
        self.assertEqual(row.metadata['reason'], 'Ticket #1: locked out')
        self.assertTrue(row.request_id)
        verify = self.client.post(reverse('api-platform-user-action', args=[self.customer.id, 'resend-verification']), {'reason': 'asked'}, format='json')
        self.assertEqual(verify.status_code, 200)
        User.objects.filter(id=self.customer.id).update(email_verified_at=timezone.now())
        again = self.client.post(reverse('api-platform-user-action', args=[self.customer.id, 'resend-verification']), {'reason': 'asked'}, format='json')
        self.assertEqual(again.status_code, 409)

    def _event(self, status, attempts=5):
        now = timezone.now()
        return OutboxEvent.objects.create(
            id=uuid.uuid4(), topic='health.checked', aggregate_type='t', aggregate_id='a', deduplication_key=str(uuid.uuid4()),
            payload={}, status=status, attempts=attempts, last_error='boom', available_at=now + timedelta(days=1), created_at=now, updated_at=now,
        )

    def test_jobs_list_and_retry_single_and_bulk(self):
        dead, failed, ok = self._event(OutboxEventStatus.DEAD_LETTER), self._event(OutboxEventStatus.FAILED, 2), self._event(OutboxEventStatus.PUBLISHED)
        self.client.force_authenticate(self.staff)
        rows = self.client.get(reverse('api-platform-jobs'), {'kind': 'outbox'}).data
        self.assertEqual(rows['total'], 2)
        url = reverse('api-platform-jobs-retry')
        self.assertEqual(self.client.post(url, {'items': [{'kind': 'outbox', 'id': str(dead.id)}]}, format='json').status_code, 400)
        response = self.client.post(url, {'reason': 'SMTP fixed', 'items': [
            {'kind': 'outbox', 'id': str(dead.id)}, {'kind': 'outbox', 'id': str(failed.id)}, {'kind': 'outbox', 'id': str(ok.id)},
        ]}, format='json')
        self.assertEqual(response.data['retried'], 2)
        self.assertFalse(response.data['results'][2]['ok'])
        dead.refresh_from_db(); failed.refresh_from_db()
        self.assertEqual((dead.status, dead.attempts), (OutboxEventStatus.PENDING, 0))
        self.assertEqual((failed.status, failed.attempts), (OutboxEventStatus.PENDING, 2))
        self.assertEqual(AuditLog.objects.filter(action='platform.job.retried', actor_type=AuditActorType.PLATFORM_STAFF).count(), 2)
        # Retrying again is a no-op, not a double requeue.
        again = self.client.post(url, {'reason': 'again', 'items': [{'kind': 'outbox', 'id': str(dead.id)}]}, format='json')
        self.assertEqual(again.data['retried'], 0)


class SupportTicketTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.staff = grant(User.objects.create_user(email='staff@example.com', password='pw-123456789', first_name='Sam', last_name='Staff'))
        self.customer = User.objects.create_user(email='cust@example.com', password='pw-123456789', first_name='Cara', last_name='C')
        self.other = User.objects.create_user(email='other@example.com', password='pw-123456789', first_name='O', last_name='O')
        self.workspace, _ = create_workspace(owner=self.customer, name='Cara Studio', slug='cara', workspace_timezone='UTC')
        self.foreign, _ = create_workspace(owner=self.other, name='Other', slug='other', workspace_timezone='UTC')

    def _report(self, **extra):
        self.client.force_authenticate(self.customer)
        return self.client.post(reverse('api-support-tickets'), {
            'category': 'BUG', 'subject': 'Upload stuck', 'body': 'It stops at 99%.',
            'workspace_id': str(self.workspace.id), 'context': {'url': 'http://x/projects', 'user_agent': 'UA', 'secret': 'drop me'}, **extra,
        }, format='json')

    def test_report_a_problem_captures_context(self):
        response = self._report()
        self.assertEqual(response.status_code, 201)
        ticket = SupportTicket.objects.get(id=response.data['id'])
        self.assertEqual(ticket.number, 1)
        self.assertEqual(ticket.workspace, self.workspace)
        self.assertEqual(ticket.context['plan'], 'FREE')
        self.assertEqual(ticket.context['url'], 'http://x/projects')
        self.assertTrue(ticket.context['request_id'])
        self.assertNotIn('secret', ticket.context)
        self.assertEqual(self._report().data['number'], 2)

    def test_cannot_attach_someone_elses_workspace(self):
        ticket = SupportTicket.objects.get(id=self._report(workspace_id=str(self.foreign.id)).data['id'])
        self.assertIsNone(ticket.workspace)

    def test_staff_reply_is_emailed_through_outbox_and_audited_notes_are_private(self):
        ticket_id = self._report().data['id']
        self.client.force_authenticate(self.staff)
        url = reverse('api-platform-ticket-messages', args=[ticket_id])
        self.assertEqual(self.client.post(url, {'kind': 'REPLY', 'body': 'hi'}, format='json').status_code, 400)
        self.client.post(url, {'kind': 'NOTE', 'body': 'Looks like the proxy limit', 'reason': 'triage'}, format='json')
        response = self.client.post(url, {'kind': 'REPLY', 'body': 'Fixed — please retry.', 'reason': 'Replying to #1'}, format='json')
        self.assertEqual(response.status_code, 201)
        ticket = SupportTicket.objects.get(id=ticket_id)
        self.assertEqual(ticket.status, SupportTicketStatus.WAITING)
        self.assertEqual(ticket.assignee, self.staff)
        self.assertEqual(len(mail.outbox), 0)  # not sent inline
        process_outbox_events(limit=10)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ['cust@example.com'])
        self.assertIn('#1', mail.outbox[0].subject)
        self.assertTrue(ticket.messages.get(kind=SupportMessageKind.REPLY).email_sent_at)
        self.assertEqual(AuditLog.objects.filter(actor_type=AuditActorType.PLATFORM_STAFF, entity_id=str(ticket_id)).count(), 2)
        self.client.force_authenticate(self.customer)
        mine = self.client.get(reverse('api-support-tickets')).data
        self.assertEqual([m['kind'] for m in mine[0]['messages']], ['CUSTOMER', 'REPLY'])

    def test_status_change_requires_reason_and_is_audited(self):
        ticket_id = self._report().data['id']
        self.client.force_authenticate(self.staff)
        url = reverse('api-platform-ticket-detail', args=[ticket_id])
        self.assertEqual(self.client.patch(url, {'status': 'SOLVED'}, format='json').status_code, 400)
        response = self.client.patch(url, {'status': 'SOLVED', 'assignee': 'me', 'reason': 'resolved'}, format='json')
        self.assertEqual(response.data['status'], 'SOLVED')
        row = AuditLog.objects.get(action='platform.ticket.updated')
        self.assertEqual(row.metadata['changes']['status'], ['NEW', 'SOLVED'])
        audit = self.client.get(reverse('api-platform-audit'), {'actor_type': 'PLATFORM_STAFF'}).data
        self.assertEqual(audit['total'], 1)
        self.assertEqual(audit['results'][0]['reason'], 'resolved')


class PlatformCommandTests(TestCase):
    def test_grant_platform_admin(self):
        user = User.objects.create_user(email='f@example.com', password='pw-123456789', first_name='F', last_name='F')
        call_command('grant_platform_admin', 'f@example.com', stdout=StringIO())
        self.assertTrue(User.objects.get(id=user.id).has_perm('app.access_platform_admin'))
        call_command('grant_platform_admin', 'f@example.com', '--revoke', stdout=StringIO())
        self.assertFalse(User.objects.get(id=user.id).has_perm('app.access_platform_admin'))

    @override_settings(DEBUG=True)
    def test_seed_platform_demo_is_idempotent_and_marked(self):
        call_command('seed_platform_demo', stdout=StringIO())
        call_command('seed_platform_demo', stdout=StringIO())
        self.assertEqual(User.objects.filter(email__endswith='@demo.blazeflow.test').count(), 12)
        self.assertEqual(SupportTicket.objects.filter(is_demo=True).count(), 3)
        self.assertEqual(OutboxEvent.objects.filter(topic__startswith='demo.').count(), 3)
