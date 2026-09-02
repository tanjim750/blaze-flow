from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from .models import OAuthIdentity, OAuthProvider, UserStatus, UserSubscription


def _claims(**overrides):
    claims = {
        'sub': 'google-subject-123',
        'email': 'googler@example.com',
        'email_verified': True,
        'given_name': 'Ada',
        'family_name': 'Lovelace',
        'picture': 'https://example.com/avatar.png',
    }
    claims.update(overrides)
    return claims


@override_settings(GOOGLE_OAUTH_CLIENT_ID='test-client-id.apps.googleusercontent.com')
class GoogleOAuthApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    @patch('app.services.google_oauth.verify_google_id_token')
    def test_first_time_sign_in_creates_user_identity_and_free_subscription(self, mock_verify):
        mock_verify.return_value = _claims()

        response = self.client.post(
            reverse('api-google-login'), {'id_token': 'a-real-looking-token'}, format='json'
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn('csrf_token', response.json())
        user = get_user_model().objects.get(email='googler@example.com')
        self.assertIsNotNone(user.email_verified_at)
        self.assertFalse(user.has_usable_password())
        identity = OAuthIdentity.objects.get(user=user, provider=OAuthProvider.GOOGLE)
        self.assertEqual(identity.provider_subject, 'google-subject-123')
        self.assertTrue(UserSubscription.objects.filter(user=user).exists())

    @patch('app.services.google_oauth.verify_google_id_token')
    def test_returning_user_reuses_the_same_identity(self, mock_verify):
        mock_verify.return_value = _claims()
        self.client.post(reverse('api-google-login'), {'id_token': 'first'}, format='json')
        user = get_user_model().objects.get(email='googler@example.com')

        mock_verify.return_value = _claims(given_name='Augusta')
        response = self.client.post(reverse('api-google-login'), {'id_token': 'second'}, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(get_user_model().objects.filter(email='googler@example.com').count(), 1)
        self.assertEqual(OAuthIdentity.objects.filter(user=user, provider=OAuthProvider.GOOGLE).count(), 1)
        identity = OAuthIdentity.objects.get(user=user, provider=OAuthProvider.GOOGLE)
        self.assertEqual(identity.provider_first_name, 'Augusta')

    @patch('app.services.google_oauth.verify_google_id_token')
    def test_verified_email_links_to_an_existing_registered_account(self, mock_verify):
        existing_user = get_user_model().objects.create_user(
            email='googler@example.com',
            password='a-secure-test-password',
            first_name='Existing',
            last_name='User',
        )
        mock_verify.return_value = _claims()

        response = self.client.post(
            reverse('api-google-login'), {'id_token': 'a-token'}, format='json'
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['id'], str(existing_user.id))
        self.assertEqual(get_user_model().objects.filter(email='googler@example.com').count(), 1)
        existing_user.refresh_from_db()
        self.assertIsNotNone(existing_user.email_verified_at)

    @patch('app.services.google_oauth.verify_google_id_token')
    def test_unverified_google_email_does_not_auto_link_or_create(self, mock_verify):
        get_user_model().objects.create_user(
            email='googler@example.com',
            password='a-secure-test-password',
            first_name='Existing',
            last_name='User',
        )
        mock_verify.return_value = _claims(email_verified=False)

        response = self.client.post(
            reverse('api-google-login'), {'id_token': 'a-token'}, format='json'
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(OAuthIdentity.objects.exists())

    @patch('app.services.google_oauth.verify_google_id_token')
    def test_suspended_user_matched_by_email_cannot_sign_in(self, mock_verify):
        suspended = get_user_model().objects.create_user(
            email='googler@example.com',
            password='a-secure-test-password',
            first_name='Suspended',
            last_name='User',
            status=UserStatus.SUSPENDED,
        )
        mock_verify.return_value = _claims()

        response = self.client.post(
            reverse('api-google-login'), {'id_token': 'a-token'}, format='json'
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(OAuthIdentity.objects.filter(user=suspended).exists())

    @patch('app.services.google_oauth.verify_google_id_token')
    def test_suspended_user_with_existing_identity_cannot_sign_in(self, mock_verify):
        mock_verify.return_value = _claims()
        self.client.post(reverse('api-google-login'), {'id_token': 'first'}, format='json')
        user = get_user_model().objects.get(email='googler@example.com')
        user.status = UserStatus.SUSPENDED
        user.save(update_fields=['status'])

        response = self.client.post(reverse('api-google-login'), {'id_token': 'second'}, format='json')

        self.assertEqual(response.status_code, 400)

    @patch('app.services.google_oauth.verify_google_id_token')
    def test_invalid_token_is_rejected(self, mock_verify):
        from app.services.google_oauth import GoogleOAuthError

        mock_verify.side_effect = GoogleOAuthError('This Google sign-in token is invalid or expired.')

        response = self.client.post(
            reverse('api-google-login'), {'id_token': 'garbage'}, format='json'
        )

        self.assertEqual(response.status_code, 400)

    def test_missing_token_field_is_rejected(self):
        response = self.client.post(reverse('api-google-login'), {}, format='json')

        self.assertEqual(response.status_code, 400)


class GoogleOAuthNotConfiguredTests(TestCase):
    @override_settings(GOOGLE_OAUTH_CLIENT_ID='')
    def test_returns_a_clear_error_when_not_configured(self):
        client = APIClient()

        response = client.post(
            reverse('api-google-login'), {'id_token': 'anything'}, format='json'
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn('not configured', response.json()['detail'])
