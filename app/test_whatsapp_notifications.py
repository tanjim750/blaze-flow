"""WhatsApp + email approval requests: consent, trigger, link, approve, delivery log, webhook."""
import hashlib
import hmac
import json
import uuid
from unittest import mock

from django.core import mail
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .models import (
    AuditLog, ClientTeam, ClientTeamMember, Notification, NotificationDelivery, OutboxEvent, OutboxEventStatus,
    Project, WhatsAppContact, WorkflowStage, WorkspaceWhatsAppSetting,
)
from .services.approval_requests import is_client_review_stage, opt_out_phone, set_member_contact
from .services.outbox import process_outbox_events
from .services.whatsapp import MetaCloudProvider, WhatsAppError, is_stop_message, normalize_phone
from .test_guest_decisions import DecisionBase, _user


class PhoneTests(TestCase):
    def test_normalises_international_and_uk_numbers(self):
        self.assertEqual(normalize_phone('+44 7700 900-123'), '+447700900123')
        self.assertEqual(normalize_phone('0044 7700 900123'), '+447700900123')
        self.assertEqual(normalize_phone('07700 900123'), '+447700900123')
        self.assertEqual(normalize_phone('+1 (415) 555-0100'), '+14155550100')
        for bad in ('', '12345', '+0123456789', 'not a number', '+44 77'):
            with self.assertRaises(ValueError):
                normalize_phone(bad)

    def test_stop_words(self):
        for text in ('STOP', ' stop ', 'Unsubscribe', 'stop.', 'Opt out'):
            self.assertTrue(is_stop_message(text), text)
        self.assertFalse(is_stop_message('please stop by tomorrow'))

    def test_client_review_stage_detection(self):
        stage = lambda name, slug: WorkflowStage(name=name, slug=slug)  # noqa: E731
        self.assertTrue(is_client_review_stage(stage('Approval', 'approval')))
        self.assertTrue(is_client_review_stage(stage('Client review', 'client-review')))
        self.assertTrue(is_client_review_stage(stage('Waiting for approval', 'waiting')))
        self.assertFalse(is_client_review_stage(stage('Approved', 'approved')))
        self.assertFalse(is_client_review_stage(stage('In Review', 'in-review')))
        self.assertFalse(is_client_review_stage(None))


class ApprovalBase(DecisionBase):
    def setUp(self):
        super().setUp()
        now = timezone.now()
        self.team = ClientTeam.objects.create(id=uuid.uuid4(), workspace=self.workspace, name='Northlight', created_at=now, updated_at=now)
        Project.objects.filter(id=self.project_id).update(client_team=self.team)
        self.cleo = _user('cleo@northlight.test', 'Cleo', 'Client')
        self.member = ClientTeamMember.objects.create(
            id=uuid.uuid4(), client_team=self.team, user=self.cleo, joined_at=now, created_at=now, updated_at=now,
        )

    def stage(self, slug):
        return WorkflowStage.objects.get(workspace=self.workspace, slug=slug)

    def move(self, media, slug, user=None):
        self.as_user(user or self.owner)
        response = self.client.post(
            reverse('api-media-version-workflow', args=[self.workspace.id, self.project_id, media['id']]),
            {'workflow_stage_id': str(self.stage(slug).id)}, format='json',
        )
        self.assertIn(response.status_code, (200, 201), response.content)
        return response

    def enable(self, on=True):
        self.as_user(self.owner)
        response = self.client.patch(reverse('api-workspace-whatsapp-settings', args=[self.workspace.id]), {'enabled': on}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def opt_in(self, phone='+44 7700 900123'):
        self.as_user(self.owner)
        response = self.client.put(
            reverse('api-client-team-member-whatsapp', args=[self.workspace.id, self.team.id, self.member.id]),
            {'phone': phone, 'opted_in': True, 'consent_confirmed': True}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def deliveries(self, channel):
        return NotificationDelivery.objects.filter(channel=channel)


class ConsentTests(ApprovalBase, TestCase):
    def url(self):
        return reverse('api-client-team-member-whatsapp', args=[self.workspace.id, self.team.id, self.member.id])

    def test_agency_must_confirm_consent_and_use_a_valid_number(self):
        self.as_user(self.owner)
        self.assertEqual(self.client.put(self.url(), {'phone': '+447700900123', 'opted_in': True}, format='json').status_code, 400)
        bad = self.client.put(self.url(), {'phone': '12', 'opted_in': True, 'consent_confirmed': True}, format='json')
        self.assertEqual(bad.status_code, 400)
        self.assertIn('international format', bad.json()['phone'][0])
        data = self.opt_in()
        self.assertEqual(data['phone'], '+447700900123')
        self.assertTrue(data['opted_in'])
        self.assertEqual(data['opt_in_method'], 'agency_recorded')
        self.assertEqual(data['opt_in_recorded_by'], self.owner.get_full_name() or self.owner.email)
        contact = WhatsAppContact.objects.get(client_team_member=self.member)
        self.assertIn('Reply STOP', contact.opt_in_wording)
        listed = self.client.get(reverse('api-client-team-members', args=[self.workspace.id, self.team.id])).json()
        self.assertTrue(listed[0]['whatsapp']['opted_in'])

    def test_number_without_consent_is_stored_but_not_messageable(self):
        self.as_user(self.owner)
        data = self.client.put(self.url(), {'phone': '+447700900123', 'opted_in': False}, format='json').json()
        self.assertFalse(data['opted_in'])

    def test_changing_the_number_drops_consent_and_opt_out_is_recorded(self):
        self.opt_in()
        contact = set_member_contact(member=self.member, phone='+447700900999', opted_in=False, recorded_by=self.owner)
        self.assertFalse(contact.can_message)
        self.opt_in('+447700900999')
        contact = set_member_contact(member=self.member, phone='+447700900999', opted_in=False, recorded_by=self.owner)
        self.assertEqual(contact.opt_out_method, 'agency')
        self.assertIsNotNone(contact.opted_out_at)

    def test_only_client_team_managers_can_edit_numbers(self):
        self.as_user(self.editor)
        response = self.client.put(self.url(), {'phone': '+447700900123', 'opted_in': True, 'consent_confirmed': True}, format='json')
        self.assertEqual(response.status_code, 403)

    def test_client_can_opt_in_and_out_themselves(self):
        self.as_user(self.cleo)
        url = reverse('api-my-client-whatsapp', args=[self.workspace.id])
        self.assertIn('Reply STOP', self.client.get(url).json()['opt_in_wording'])
        data = self.client.put(url, {'phone': '07700 900123', 'opted_in': True}, format='json').json()
        self.assertEqual((data['phone'], data['opted_in'], data['opt_in_method']), ('+447700900123', True, 'client_self'))
        data = self.client.put(url, {'phone': '07700 900123', 'opted_in': False}, format='json').json()
        self.assertEqual((data['opted_in'], data['opt_out_method']), (False, 'client_self'))
        self.as_user(self.editor)
        self.assertEqual(self.client.get(url).status_code, 404)

    def test_email_invite_carries_number_and_consent_to_the_new_member(self):
        self.as_user(self.owner)
        url = reverse('api-client-team-invites', args=[self.workspace.id, self.team.id])
        missing = self.client.post(url, {'invite_type': 'EMAIL', 'recipient_email': 'rae@northlight.test', 'whatsapp_phone': '+447700900555', 'whatsapp_opt_in': True}, format='json')
        self.assertEqual(missing.status_code, 400)
        link = self.client.post(url, {'invite_type': 'LINK', 'whatsapp_phone': '+447700900555'}, format='json')
        self.assertEqual(link.status_code, 400)
        created = self.client.post(url, {
            'invite_type': 'EMAIL', 'recipient_email': 'rae@northlight.test', 'whatsapp_phone': '+44 7700 900555',
            'whatsapp_opt_in': True, 'whatsapp_consent_confirmed': True,
        }, format='json')
        self.assertEqual(created.status_code, 201, created.content)
        self.assertTrue(created.json()['whatsapp']['opted_in'])
        rae = _user('rae@northlight.test', 'Rae', 'Chen')
        self.as_user(rae)
        accepted = self.client.post(reverse('api-client-team-invite-accept'), {'token': created.json()['token']}, format='json')
        self.assertIn(accepted.status_code, (200, 201), accepted.content)
        contact = WhatsAppContact.objects.get(client_team_member__user=rae)
        self.assertEqual(contact.phone_e164, '+447700900555')
        self.assertTrue(contact.can_message)
        self.assertIsNone(contact.client_team_invite_id)


class SettingsTests(ApprovalBase, TestCase):
    def test_off_by_default_and_owner_can_switch_on(self):
        self.as_user(self.owner)
        url = reverse('api-workspace-whatsapp-settings', args=[self.workspace.id])
        data = self.client.get(url).json()
        self.assertFalse(data['enabled'])
        self.assertTrue(data['test_mode'])
        self.assertEqual(data['usage'], {'plan': 'FREE', 'used': 0, 'limit': 50})
        self.assertTrue(self.enable()['enabled'])
        self.assertEqual(self.client.patch(url, {'link_expiry_hours': 0}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(url, {'link_expiry_hours': 48}, format='json').json()['link_expiry_hours'], 48)
        self.as_user(self.editor)
        self.assertEqual(self.client.patch(url, {'enabled': False}, format='json').status_code, 403)
        self.assertEqual(self.client.get(url).status_code, 200)


class TriggerTests(ApprovalBase, TestCase):
    def test_entering_approval_sends_email_and_whatsapp_and_the_link_approves(self):
        self.enable()
        self.opt_in()
        self.move(self.v2, 'approval')
        note = Notification.objects.get(kind='CLIENT_APPROVAL_REQUESTED', recipient_user=self.cleo)
        self.assertEqual(note.payload['link_kind'], 'guest')
        self.assertIsNone(note.payload['link'])  # guest tokens never reach the in-app bell
        events = OutboxEvent.objects.filter(topic='approval.requested.deliver')
        self.assertEqual(sorted(e.payload['channel'] for e in events), ['EMAIL', 'WHATSAPP'])
        mail.outbox.clear()
        with self.assertLogs('app.services.whatsapp', 'INFO') as logs:
            process_outbox_events(topic_prefix='approval.')
        self.assertIn('test mode, not sent', logs.output[0])
        self.assertNotIn('+447700900123', logs.output[0])
        self.assertNotIn('token=', logs.output[0])  # the link token is a credential
        [email] = mail.outbox
        self.assertEqual(email.to, ['cleo@northlight.test'])
        self.assertIn('ready for your approval', email.subject)
        wa = self.deliveries('WHATSAPP').get()
        self.assertEqual((wa.status, wa.provider, wa.recipient_masked), ('SENT', 'log', '+44••••123'))
        self.assertTrue(wa.provider_message_id.startswith('log-'))
        self.assertEqual(self.deliveries('EMAIL').get().status, 'SENT')

        # The emailed link is a real guest link that may approve.
        link = events.get(payload__channel='EMAIL').payload['link']
        self.assertIn(link, email.body)
        token = link.split('token=')[1].split('&')[0]
        self.client.force_authenticate(user=None)
        exchange = self.client.post(reverse('api-guest-exchange'), {'token': token, 'name': 'Cleo Client', 'email': 'cleo@northlight.test'}, format='json')
        self.assertEqual(exchange.status_code, 201, exchange.content)
        headers = {'HTTP_X_GUEST_ACCESS_KEY': exchange.json()['access_key']}
        self.assertEqual(self.decide(headers, self.v2, 'approved').status_code, 201)
        self.assertEqual(self.stage_slug(self.v2), 'approved')
        # The team hears about it (the uploader follows the cut).
        self.assertTrue(Notification.objects.filter(kind='MEDIA_APPROVED', recipient_user=self.editor).exists())

        # Activity log shows the request with live delivery statuses, to the team only.
        self.as_user(self.owner)
        feed = self.client.get(reverse('api-workspace-activity', args=[self.workspace.id])).json()
        items = feed['results'] if isinstance(feed, dict) else feed
        [row] = [i for i in items if i['action'] == 'approval_request.sent']
        self.assertEqual({d['channel']: d['status'] for d in row['detail']['deliveries']}, {'EMAIL': 'SENT', 'WHATSAPP': 'SENT'})
        self.assertIn('by email and WhatsApp', row['summary'])
        self.assertTrue(AuditLog.objects.get(action='approval_request.sent').team_only)
        log = self.client.get(reverse('api-notification-deliveries', args=[self.workspace.id]), {'channel': 'WHATSAPP'}).json()
        self.assertEqual(log['results'][0]['recipient'], '+44••••123')

    def test_email_only_when_switch_off_or_no_consent(self):
        self.opt_in()
        self.move(self.v2, 'approval')
        self.assertEqual([e.payload['channel'] for e in OutboxEvent.objects.filter(topic='approval.requested.deliver')], ['EMAIL'])
        self.move(self.v2, 'in-review')
        self.enable()
        set_member_contact(member=self.member, phone='+447700900123', opted_in=False, recorded_by=self.owner)
        self.move(self.v2, 'approval')
        self.assertFalse(OutboxEvent.objects.filter(topic='approval.requested.deliver', payload__channel='WHATSAPP').exists())

    def test_no_message_for_other_stages_or_projects_without_a_client(self):
        self.enable()
        self.opt_in()
        self.move(self.v2, 'in-review')
        self.assertFalse(Notification.objects.filter(kind='CLIENT_APPROVAL_REQUESTED').exists())
        Project.objects.filter(id=self.project_id).update(client_team=None)
        self.move(self.v2, 'approval')
        self.assertFalse(Notification.objects.filter(kind='CLIENT_APPROVAL_REQUESTED').exists())

    def test_a_client_who_can_sign_in_gets_the_review_link(self):
        user = self.add_client_member(['workspace.read', 'project.read', 'media.read', 'review.comment.read'], email='sam@client.test')
        team_id = ClientTeamMember.objects.get(user=user).client_team_id
        Project.objects.filter(id=self.project_id).update(client_team_id=team_id)
        self.move(self.v2, 'approval')
        note = Notification.objects.get(kind='CLIENT_APPROVAL_REQUESTED', recipient_user=user)
        self.assertEqual(note.payload['link_kind'], 'portal')
        self.assertTrue(note.payload['link'].startswith('/review?media='))
        event = OutboxEvent.objects.get(topic='approval.requested.deliver')
        self.assertNotIn('token=', event.payload['link'])

    def test_send_time_rechecks_opt_out_and_the_plan_cap(self):
        self.enable()
        self.opt_in()
        self.move(self.v2, 'approval')
        opt_out_phone('447700900123')
        process_outbox_events(topic_prefix='approval.')
        wa = self.deliveries('WHATSAPP').get()
        self.assertEqual(wa.status, 'SKIPPED')
        self.assertIn('opt-in', wa.last_error)

    @override_settings(PLAN_LIMITS={'FREE': {'max_workspaces_owned': 1, 'max_projects_per_workspace': 3, 'max_storage_bytes': 1, 'whatsapp_messages_per_month': 0}, 'PRO': {'max_workspaces_owned': 1, 'max_projects_per_workspace': 3, 'max_storage_bytes': 1, 'whatsapp_messages_per_month': 0}})
    def test_monthly_cap_skips_whatsapp_but_email_still_goes(self):
        self.enable()
        self.opt_in()
        self.move(self.v2, 'approval')
        process_outbox_events(topic_prefix='approval.')
        wa = self.deliveries('WHATSAPP').get()
        self.assertEqual(wa.status, 'SKIPPED')
        self.assertIn('Monthly WhatsApp limit', wa.last_error)
        self.assertEqual(self.deliveries('EMAIL').get().status, 'SENT')

    def test_retryable_errors_retry_and_permanent_errors_stop(self):
        self.enable()
        self.opt_in()
        self.move(self.v2, 'approval')
        with mock.patch('app.services.whatsapp.LogProvider.send_template', side_effect=WhatsAppError('rate limited', retryable=True)):
            process_outbox_events(topic_prefix='approval.')
        event = OutboxEvent.objects.get(payload__channel='WHATSAPP')
        self.assertEqual(event.status, OutboxEventStatus.FAILED)
        self.assertEqual(self.deliveries('WHATSAPP').get().status, 'FAILED')
        OutboxEvent.objects.filter(id=event.id).update(available_at=timezone.now())
        with mock.patch('app.services.whatsapp.LogProvider.send_template', side_effect=WhatsAppError('bad number', retryable=False)):
            process_outbox_events(topic_prefix='approval.', retry_base_seconds=0)
        event.refresh_from_db()
        self.assertEqual(event.status, OutboxEventStatus.PUBLISHED)
        wa = self.deliveries('WHATSAPP').get()
        self.assertEqual((wa.status, wa.attempts), ('FAILED', 2))
        self.assertIn('bad number', wa.last_error)

    def test_moving_back_into_approval_sends_again_but_one_entry_sends_once(self):
        self.enable()
        self.opt_in()
        self.move(self.v2, 'approval')
        self.move(self.v2, 'revision')
        self.move(self.v2, 'approval')
        self.assertEqual(Notification.objects.filter(kind='CLIENT_APPROVAL_REQUESTED').count(), 2)
        process_outbox_events(topic_prefix='approval.')
        process_outbox_events(topic_prefix='approval.')
        self.assertEqual(self.deliveries('WHATSAPP').filter(status='SENT').count(), 2)


class WebhookTests(ApprovalBase, TestCase):
    def setUp(self):
        super().setUp()
        self.enable()
        self.opt_in()
        self.move(self.v2, 'approval')
        process_outbox_events(topic_prefix='approval.')
        self.delivery = self.deliveries('WHATSAPP').get()
        self.client.force_authenticate(user=None)

    def post(self, payload, secret=None):
        body = json.dumps(payload).encode()
        headers = {}
        if secret:
            headers['HTTP_X_HUB_SIGNATURE_256'] = 'sha256=' + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        return self.client.generic('POST', reverse('api-whatsapp-webhook'), body, content_type='application/json', **headers)

    def status(self, state, ts='1760900000'):
        return {'entry': [{'changes': [{'value': {'statuses': [{'id': self.delivery.provider_message_id, 'status': state, 'timestamp': ts}]}}]}]}

    def test_statuses_update_the_delivery_log_in_order(self):
        self.assertEqual(self.post(self.status('delivered')).status_code, 200)
        self.post(self.status('read'))
        self.post(self.status('delivered'))  # late, must not step back
        self.delivery.refresh_from_db()
        self.assertEqual(self.delivery.status, 'READ')
        self.assertIsNotNone(self.delivery.delivered_at)
        self.assertIsNotNone(self.delivery.read_at)

    def test_stop_reply_opts_out(self):
        self.post({'entry': [{'changes': [{'value': {'messages': [{'from': '447700900123', 'type': 'text', 'text': {'body': 'STOP'}}]}}]}]})
        contact = WhatsAppContact.objects.get(client_team_member=self.member)
        self.assertFalse(contact.can_message)
        self.assertEqual(contact.opt_out_method, 'stop_reply')

    @override_settings(WHATSAPP_PROVIDER='meta', WHATSAPP_APP_SECRET='shh', WHATSAPP_WEBHOOK_VERIFY_TOKEN='verify-me')
    def test_signature_and_verification_handshake(self):
        self.assertEqual(self.post(self.status('delivered')).status_code, 401)
        self.assertEqual(self.post(self.status('delivered'), secret='wrong').status_code, 401)
        self.assertEqual(self.post(self.status('delivered'), secret='shh').status_code, 200)
        url = reverse('api-whatsapp-webhook')
        ok = self.client.get(url, {'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': '42'})
        self.assertEqual((ok.status_code, ok.content), (200, b'42'))
        self.assertEqual(self.client.get(url, {'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '42'}).status_code, 403)


@override_settings(WHATSAPP_PROVIDER='meta', WHATSAPP_ACCESS_TOKEN='token', WHATSAPP_PHONE_NUMBER_ID='123')
class MetaProviderTests(TestCase):
    def send(self):
        return MetaCloudProvider().send_template(to='+447700900123', template='t', language='en_GB', body_params=['Cleo'], button_param='guest-review?token=x')

    def test_posts_the_template_and_returns_the_id(self):
        with mock.patch('app.services.whatsapp.requests.post') as post:
            post.return_value = mock.Mock(status_code=200, json=lambda: {'messages': [{'id': 'wamid.1'}]})
            self.assertEqual(self.send(), 'wamid.1')
        body = post.call_args.kwargs['json']
        self.assertEqual(body['to'], '447700900123')
        self.assertEqual(body['template']['components'][1]['parameters'][0]['text'], 'guest-review?token=x')
        self.assertEqual(post.call_args.kwargs['headers']['Authorization'], 'Bearer token')

    def test_classifies_errors(self):
        with mock.patch('app.services.whatsapp.requests.post') as post:
            post.return_value = mock.Mock(status_code=400, text='', json=lambda: {'error': {'code': 131026, 'message': 'undeliverable'}})
            with self.assertRaises(WhatsAppError) as bad:
                self.send()
            self.assertFalse(bad.exception.retryable)
            post.return_value = mock.Mock(status_code=429, text='', json=lambda: {'error': {'code': 130429, 'message': 'rate'}})
            with self.assertRaises(WhatsAppError) as limited:
                self.send()
            self.assertTrue(limited.exception.retryable)

    @override_settings(WHATSAPP_ACCESS_TOKEN='')
    def test_missing_credentials_are_a_permanent_error(self):
        with self.assertRaises(WhatsAppError) as missing:
            self.send()
        self.assertFalse(missing.exception.retryable)
