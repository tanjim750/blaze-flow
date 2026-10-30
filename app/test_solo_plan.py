"""Solo plan: owner-only, 200 GB, no AI QA / team members / editor payouts; client review included."""
from types import SimpleNamespace

from django.conf import settings
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .models import SubscriptionPlan, UserSubscription
from .services import SubscriptionError, enforce_workspace_storage_limit
from .services.plan_features import (
    AI_QA, EDITOR_PAYOUTS, TEAM_MEMBERS, PlanUpgradeRequired, plan_has_feature, require_workspace_feature,
)
from .services.subscriptions import change_plan
from .test_access_projects import WorkspaceAccessSetupMixin

GB = 1024 * 1024 * 1024


class SoloPlanConfigTests(TestCase):
    def test_solo_limits_and_features(self):
        solo = settings.PLAN_LIMITS['SOLO']
        self.assertEqual(solo['max_storage_bytes'], 200 * GB)
        self.assertEqual(solo['max_members'], 1)
        for feature in (AI_QA, TEAM_MEMBERS, EDITOR_PAYOUTS):
            self.assertFalse(plan_has_feature('SOLO', feature))
            # Existing plans keep everything, so existing workspaces are unchanged.
            self.assertTrue(plan_has_feature('FREE', feature))
            self.assertTrue(plan_has_feature('PRO', feature))
        self.assertEqual(settings.PLATFORM_SOLO_PRICE_MINOR, 599)


class SoloGatingApiTests(WorkspaceAccessSetupMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.owner.email_verified_at = timezone.now()
        self.owner.save(update_fields=['email_verified_at'])
        self.client.force_authenticate(self.owner)

    def _go_solo(self):
        response = self.client.post(reverse('api-subscription-upgrade'), {'plan': 'SOLO'}, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def test_choose_solo_returns_limits_and_features(self):
        data = self._go_solo()
        self.assertEqual(data['plan'], 'SOLO')
        self.assertEqual(data['limits']['max_storage_bytes'], 200 * GB)
        self.assertEqual(data['limits']['max_members'], 1)
        self.assertEqual(data['features'], {'ai_qa': False, 'team_members': False, 'editor_payouts': False})

    def test_free_workspace_entitlements_unchanged(self):
        data = self.client.get(reverse('api-workspace-entitlements', args=[self.workspace.id])).json()
        self.assertEqual(data['plan'], 'FREE')
        self.assertTrue(all(data['features'].values()))

    def test_workspace_list_carries_plan_and_feature_list(self):
        item = next(w for w in self.client.get(reverse('api-workspaces')).json() if w['id'] == str(self.workspace.id))
        self.assertEqual(item['plan'], 'FREE')
        self.assertEqual(sorted(item['plan_features']), ['ai_qa', 'editor_payouts', 'team_members'])
        self._go_solo()
        item = next(w for w in self.client.get(reverse('api-workspaces')).json() if w['id'] == str(self.workspace.id))
        self.assertEqual((item['plan'], item['plan_features']), ('SOLO', []))

    def test_solo_entitlements_endpoint(self):
        self._go_solo()
        data = self.client.get(reverse('api-workspace-entitlements', args=[self.workspace.id])).json()
        self.assertEqual(data['plan'], 'SOLO')
        self.assertEqual(data['upgrade_to'], 'starter')
        self.assertFalse(data['features']['ai_qa'])

    def test_solo_owner_cannot_invite_team_members(self):
        self._go_solo()
        response = self.client.post(
            reverse('api-workspace-invitations', args=[self.workspace.id]),
            {'email': self.member_user.email, 'role_id': str(self.member_role.id), 'project_access_mode': 'ALL'},
            format='json',
        )
        self.assertEqual(response.status_code, 403)
        body = response.json()
        self.assertEqual(body['code'], 'plan_upgrade_required')
        self.assertEqual(body['feature'], 'team_members')
        self.assertIn('Upgrade to Starter', body['detail'])

    def test_invite_sent_before_solo_cannot_be_accepted_after(self):
        response = self.client.post(
            reverse('api-workspace-invitations', args=[self.workspace.id]),
            {'email': self.member_user.email, 'role_id': str(self.member_role.id), 'project_access_mode': 'ALL'},
            format='json',
        )
        token = response.json()['token']
        self._go_solo()
        self.client.force_authenticate(self.member_user)
        accepted = self.client.post(reverse('api-workspace-invite-accept'), {'token': token}, format='json')
        self.assertEqual(accepted.status_code, 403)

    def test_cannot_switch_to_solo_with_team_members(self):
        self.invite_and_accept()
        self.client.force_authenticate(self.owner)
        response = self.client.post(reverse('api-subscription-upgrade'), {'plan': 'SOLO'}, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('Solo is for one person', response.json()['detail'])

    def test_solo_blocks_editor_payouts(self):
        self._go_solo()
        response = self.client.get(reverse('api-billing-payouts', args=[self.workspace.id]))
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['feature'], 'editor_payouts')

    def test_solo_keeps_invoicing_summary(self):
        self._go_solo()
        response = self.client.get(reverse('api-billing-summary', args=[self.workspace.id]))
        self.assertEqual(response.status_code, 200)

    def test_solo_blocks_ai_qa_in_service(self):
        from .ai_qa.service import start_review
        self._go_solo()
        media = SimpleNamespace(project=SimpleNamespace(workspace=self.workspace))
        with self.assertRaises(PlanUpgradeRequired):
            start_review(media_version=media, user=self.owner)

    def test_solo_storage_cap_is_200gb(self):
        self._go_solo()
        enforce_workspace_storage_limit(workspace=self.workspace, additional_bytes=200 * GB)
        with self.assertRaises(SubscriptionError):
            enforce_workspace_storage_limit(workspace=self.workspace, additional_bytes=200 * GB + 1)

    def test_solo_allows_one_workspace(self):
        self._go_solo()
        response = self.client.post(reverse('api-workspaces'), {'name': 'Second', 'timezone': 'UTC'}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_upgrade_from_solo_to_pro_reopens_features(self):
        self._go_solo()
        response = self.client.post(reverse('api-subscription-upgrade'), {'plan': 'PRO'}, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(require_workspace_feature(self.workspace, TEAM_MEMBERS), 'PRO')

    def test_default_upgrade_still_pro(self):
        response = self.client.post(reverse('api-subscription-upgrade'))
        self.assertEqual(response.json()['plan'], 'PRO')

    def test_rejects_unknown_plan(self):
        with self.assertRaises(SubscriptionError):
            change_plan(user=self.owner, plan='FREE')

    def test_solo_can_be_cancelled(self):
        self._go_solo()
        response = self.client.post(reverse('api-subscription-cancel'))
        self.assertEqual(response.status_code, 200)
        self.assertTrue(UserSubscription.objects.get(user=self.owner).cancel_at_period_end)
        self.assertEqual(UserSubscription.objects.get(user=self.owner).plan, SubscriptionPlan.SOLO)
