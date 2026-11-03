from datetime import timedelta

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .models import Project
from .services.guest_access import GUEST_LINK_MAX_DAYS, GUEST_LINK_MAX_HOURS
from .test_access_projects import WorkspaceAccessSetupMixin


class GuestLinkExpiryCapTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.owner)
        project = self.client.post(reverse('api-projects', args=[self.workspace.id]), {'name': 'Cap'}, format='json')
        self.project_id = project.json()['id']
        self.url = reverse('api-project-guest-invites', args=[self.workspace.id, self.project_id])

    def test_cap_is_ninety_days(self):
        self.assertEqual(GUEST_LINK_MAX_DAYS, 90)
        self.assertEqual(GUEST_LINK_MAX_HOURS, 90 * 24)

    def test_longer_than_ninety_days_is_rejected(self):
        res = self.client.post(self.url, {'permissions': ['media.read'], 'expires_in_hours': GUEST_LINK_MAX_HOURS + 1}, format='json')
        self.assertEqual(res.status_code, 400)

    def test_ninety_days_is_accepted_and_expiry_is_within_cap(self):
        res = self.client.post(self.url, {'permissions': ['media.read'], 'expires_in_hours': GUEST_LINK_MAX_HOURS}, format='json')
        self.assertIn(res.status_code, (200, 201), res.content)
        body = res.json()
        expires = body.get('expires_at') or body.get('invite', {}).get('expires_at')
        self.assertIsNotNone(expires)
        from django.utils.dateparse import parse_datetime
        self.assertLessEqual(parse_datetime(expires), timezone.now() + timedelta(days=90, minutes=1))


class BriefSanitisingTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.owner)

    def test_brief_is_sanitised_on_write(self):
        res = self.client.post(
            reverse('api-projects', args=[self.workspace.id]),
            {'name': 'XSS', 'description': '<p>Hi<script>alert(1)</script><img src=x onerror=alert(1)></p>'},
            format='json',
        )
        self.assertEqual(res.status_code, 201, res.content)
        self.assertNotIn('script', res.json()['description'])
        self.assertNotIn('onerror', Project.objects.get(id=res.json()['id']).description)

    def test_unsanitised_stored_brief_is_cleaned_on_read(self):
        res = self.client.post(reverse('api-projects', args=[self.workspace.id]), {'name': 'Old'}, format='json')
        Project.objects.filter(id=res.json()['id']).update(description='<p>x<a href="javascript:alert(1)" onclick="y()">l</a></p>')
        detail = self.client.get(reverse('api-projects', args=[self.workspace.id]))
        text = detail.content.decode()
        self.assertNotIn('javascript:', text)
        self.assertNotIn('onclick', text)
