import uuid

from django.core import mail
from django.test import TestCase, override_settings
from django.utils import timezone

from .models import ClientTeam, ClientTeamMember, ClientTeamMemberStatus
from .test_billing import BillingBase


@override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend', APP_BASE_URL='https://app.example.com')
class InvoiceEmailTests(BillingBase, TestCase):
    def setUp(self):
        super().setUp()
        ClientTeam.objects.filter(id=self.team.id).update(email='accounts@northlight.example')
        self.client_user, _ = self.add_member('jo@northlight.example', first='Jo', last='Client')
        now = timezone.now()
        ClientTeamMember.objects.create(id=uuid.uuid4(), client_team=self.team, user=self.client_user, joined_at=now, created_at=now, updated_at=now)
        gone, _ = self.add_member('gone@northlight.example', first='Gone', last='Client')
        ClientTeamMember.objects.create(id=uuid.uuid4(), client_team=self.team, user=gone, status=ClientTeamMemberStatus.REMOVED, joined_at=now, created_at=now, updated_at=now)
        self.priced_project()

    def send(self, **payload):
        draft = self.invoice(send=False)
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(self.url('api-billing-invoice-send', draft['id']), payload, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_send_emails_billing_address_and_active_members_with_portal_link(self):
        data = self.send()
        self.assertEqual(data['emailed_to'], ['accounts@northlight.example', 'jo@northlight.example'])
        self.assertEqual(sorted(m.to[0] for m in mail.outbox), ['accounts@northlight.example', 'jo@northlight.example'])
        message = mail.outbox[0]
        self.assertIn(data['number'], message.subject)
        link = f"https://app.example.com/money/invoices/{data['id']}"
        self.assertIn(link, message.body)
        self.assertIn('1400.00', message.body)
        self.assertIn(link, message.alternatives[0][0])

    def test_email_false_only_marks_sent(self):
        data = self.send(email=False)
        self.assertEqual(data['status'], 'sent')
        self.assertEqual(data['emailed_to'], [])
        self.assertEqual(mail.outbox, [])

    def test_no_recipients_still_sends(self):
        ClientTeam.objects.filter(id=self.team.id).update(email=None)
        ClientTeamMember.objects.filter(client_team=self.team).delete()
        data = self.send()
        self.assertEqual((data['status'], data['emailed_to']), ('sent', []))
        self.assertEqual(mail.outbox, [])

    def test_recipients_listed_on_draft_for_managers(self):
        draft = self.invoice(send=False)
        detail = self.client.get(self.url('api-billing-invoice-detail', draft['id'])).json()
        self.assertEqual(detail['client_recipients'], ['accounts@northlight.example', 'jo@northlight.example'])
