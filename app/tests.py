import uuid
import re
from datetime import timedelta
from io import StringIO
from unittest.mock import patch

from django.contrib.auth import authenticate, get_user_model
from django.core.exceptions import ValidationError
from django.core import mail
from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.core.management import call_command
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from .models import (
    Annotation,
    EmailVerificationToken,
    File,
    FileStatus,
    MediaVersion,
    MediaVersionStageEntry,
    Project,
    ProjectAccessMode,
    ReviewComment,
    ResourceAccess,
    Role,
    RolePermission,
    PasswordResetToken,
    StorageBackend,
    SubscriptionStatus,
    UserSubscription,
    UserStatus,
    WorkflowStage,
    Workspace,
    WorkspaceMembership,
    WorkspaceMembershipStatus,
    WorkspacePrincipalType,
)
from .services import OWNER_PERMISSION_KEYS, create_workspace
from .throttles import RegistrationThrottle


class UserAuthenticationTests(TestCase):
    def test_user_uses_email_and_hashes_password(self):
        user = get_user_model().objects.create_user(
            email='Developer@Example.com',
            password='a-secure-test-password',
            first_name='Blaze',
            last_name='Developer',
        )

        self.assertEqual(user.email, 'developer@example.com')
        self.assertNotEqual(user.password, 'a-secure-test-password')
        self.assertTrue(user.check_password('a-secure-test-password'))
        self.assertEqual(
            authenticate(email='Developer@example.com', password='a-secure-test-password'),
            user,
        )

    def test_suspended_user_cannot_authenticate(self):
        user = get_user_model().objects.create_user(
            email='suspended@example.com',
            password='a-secure-test-password',
            first_name='Suspended',
            last_name='User',
            status=UserStatus.SUSPENDED,
        )

        self.assertFalse(user.is_active)
        self.assertIsNone(
            authenticate(email='suspended@example.com', password='a-secure-test-password')
        )

    def test_superuser_has_required_flags(self):
        user = get_user_model().objects.create_superuser(
            email='admin@example.com',
            password='a-secure-test-password',
            first_name='Blaze',
            last_name='Admin',
        )

        self.assertTrue(user.is_staff)
        self.assertTrue(user.is_superuser)

    def test_database_rejects_email_case_duplicates(self):
        get_user_model().objects.create_user(
            email='unique@example.com',
            password='a-secure-test-password',
            first_name='First',
            last_name='User',
        )

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                get_user_model().objects.create(
                    email='UNIQUE@example.com',
                    password='not-a-real-password-hash',
                    first_name='Second',
                    last_name='User',
                )


class HealthCheckTests(TestCase):
    def test_health_check_is_public(self):
        response = self.client.get(reverse('api-health'))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'message': 'ok'})


class AuthenticationApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_registration_login_me_and_logout_flow(self):
        registration = self.client.post(
            reverse('api-register'),
            {
                'email': 'new.user@example.com',
                'password': 'a-secure-test-password',
                'first_name': 'New',
                'last_name': 'User',
                'timezone': 'Europe/London',
            },
            format='json',
        )
        self.assertEqual(registration.status_code, 201)
        self.assertNotIn('password', registration.json())

        login_response = self.client.post(
            reverse('api-login'),
            {'email': 'NEW.USER@example.com', 'password': 'a-secure-test-password'},
            format='json',
        )
        self.assertEqual(login_response.status_code, 200)
        self.assertIn('csrf_token', login_response.json())
        self.assertIn('csrftoken', login_response.cookies)

        me_response = self.client.get(reverse('api-current-user'))
        self.assertEqual(me_response.status_code, 200)
        self.assertEqual(me_response.json()['email'], 'new.user@example.com')

        logout_response = self.client.post(reverse('api-logout'))
        self.assertEqual(logout_response.status_code, 204)
        self.assertIn(self.client.get(reverse('api-current-user')).status_code, (401, 403))

    def test_duplicate_registration_is_rejected_case_insensitively(self):
        get_user_model().objects.create_user(
            email='existing@example.com',
            password='a-secure-test-password',
            first_name='Existing',
            last_name='User',
        )

        response = self.client.post(
            reverse('api-register'),
            {
                'email': 'EXISTING@example.com',
                'password': 'a-secure-test-password',
                'first_name': 'Duplicate',
                'last_name': 'User',
            },
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn('email', response.json())

    def test_suspended_user_cannot_log_in(self):
        get_user_model().objects.create_user(
            email='blocked@example.com',
            password='a-secure-test-password',
            first_name='Blocked',
            last_name='User',
            status=UserStatus.SUSPENDED,
        )

        response = self.client.post(
            reverse('api-login'),
            {'email': 'blocked@example.com', 'password': 'a-secure-test-password'},
            format='json',
        )

        self.assertEqual(response.status_code, 400)

    def test_password_reset_is_enumeration_safe_single_use_and_changes_login(self):
        user = get_user_model().objects.create_user(
            email='reset@example.com', password='old-secure-password-123',
            first_name='Reset', last_name='User',
        )
        request_url = reverse('api-password-reset-request')
        existing = self.client.post(request_url, {'email': user.email}, format='json')
        unknown = self.client.post(request_url, {'email': 'unknown@example.com'}, format='json')
        self.assertEqual(existing.status_code, 202)
        self.assertEqual(unknown.status_code, 202)
        self.assertEqual(existing.json(), unknown.json())
        self.assertEqual(len(mail.outbox), 1)
        token = re.search(r'token=([^\s]+)', mail.outbox[0].body).group(1)
        confirm_url = reverse('api-password-reset-confirm')
        confirmed = self.client.post(
            confirm_url,
            {'token': token, 'new_password': 'new-secure-password-456'},
            format='json',
        )
        replayed = self.client.post(
            confirm_url,
            {'token': token, 'new_password': 'another-secure-password-789'},
            format='json',
        )
        self.assertEqual(confirmed.status_code, 204)
        self.assertEqual(replayed.status_code, 400)
        self.assertEqual(self.client.post(reverse('api-login'), {'email': user.email, 'password': 'old-secure-password-123'}, format='json').status_code, 400)
        self.assertEqual(self.client.post(reverse('api-login'), {'email': user.email, 'password': 'new-secure-password-456'}, format='json').status_code, 200)

    def test_registration_sends_single_use_email_verification(self):
        registration = self.client.post(
            reverse('api-register'),
            {
                'email': 'verify@example.com',
                'password': 'a-secure-test-password',
                'first_name': 'Verify',
                'last_name': 'User',
            },
            format='json',
        )
        self.assertEqual(registration.status_code, 201)
        self.assertIsNone(registration.json()['email_verified_at'])
        self.assertEqual(len(mail.outbox), 1)
        self.assertNotIn('verify@example.com', EmailVerificationToken.objects.get().token_hash)
        token = re.search(r'token=([^\s]+)', mail.outbox[0].body).group(1)

        confirmed = self.client.post(
            reverse('api-email-verification-confirm'), {'token': token}, format='json'
        )
        replayed = self.client.post(
            reverse('api-email-verification-confirm'), {'token': token}, format='json'
        )
        user = get_user_model().objects.get(email='verify@example.com')
        self.assertEqual(confirmed.status_code, 204)
        self.assertEqual(replayed.status_code, 400)
        self.assertIsNotNone(user.email_verified_at)

    def test_email_verification_request_is_enumeration_safe_and_rotates_token(self):
        user = get_user_model().objects.create_user(
            email='resend@example.com', password='a-secure-test-password',
            first_name='Resend', last_name='User',
        )
        url = reverse('api-email-verification-request')
        first = self.client.post(url, {'email': user.email}, format='json')
        first_token = EmailVerificationToken.objects.get()
        unknown = self.client.post(url, {'email': 'unknown@example.com'}, format='json')
        second = self.client.post(url, {'email': user.email}, format='json')
        first_token.refresh_from_db()
        self.assertEqual(first.status_code, 202)
        self.assertEqual(first.json(), unknown.json())
        self.assertEqual(second.status_code, 202)
        self.assertIsNotNone(first_token.invalidated_at)
        self.assertEqual(EmailVerificationToken.objects.count(), 2)

    def test_purge_auth_tokens_dry_run_and_delete_expired_tokens(self):
        user = get_user_model().objects.create_user(
            email='cleanup@example.com', password='a-secure-test-password',
            first_name='Cleanup', last_name='User',
        )
        expired_at = timezone.now() - timedelta(minutes=1)
        PasswordResetToken.objects.create(
            id=uuid.uuid4(), user=user, token_hash='reset-expired',
            expires_at=expired_at, created_at=expired_at,
        )
        EmailVerificationToken.objects.create(
            id=uuid.uuid4(), user=user, token_hash='verification-expired',
            expires_at=expired_at, created_at=expired_at,
        )
        output = StringIO()
        call_command('purge_auth_tokens', '--dry-run', stdout=output)
        self.assertEqual(PasswordResetToken.objects.count(), 1)
        self.assertEqual(EmailVerificationToken.objects.count(), 1)
        call_command('purge_auth_tokens', stdout=output)
        self.assertEqual(PasswordResetToken.objects.count(), 0)
        self.assertEqual(EmailVerificationToken.objects.count(), 0)

    def test_authenticated_password_change_checks_current_password(self):
        user = get_user_model().objects.create_user(
            email='change@example.com', password='current-secure-password-123',
            first_name='Change', last_name='User',
        )
        self.client.force_authenticate(user)
        url = reverse('api-password-change')
        denied = self.client.post(
            url,
            {'current_password': 'wrong-password', 'new_password': 'replacement-secure-password-456'},
            format='json',
        )
        changed = self.client.post(
            url,
            {'current_password': 'current-secure-password-123', 'new_password': 'replacement-secure-password-456'},
            format='json',
        )
        user.refresh_from_db()
        self.assertEqual(denied.status_code, 400)
        self.assertEqual(changed.status_code, 204)
        self.assertTrue(user.check_password('replacement-secure-password-456'))

    def test_registration_is_throttled_by_client_address(self):
        cache.clear()
        with patch.object(RegistrationThrottle, 'rate', '1/min', create=True):
            first = self.client.post(
                reverse('api-register'),
                {'email': 'rate-one@example.com', 'password': 'secure-password-123', 'first_name': 'Rate', 'last_name': 'One'},
                format='json', REMOTE_ADDR='203.0.113.10',
            )
            second = self.client.post(
                reverse('api-register'),
                {'email': 'rate-two@example.com', 'password': 'secure-password-456', 'first_name': 'Rate', 'last_name': 'Two'},
                format='json', REMOTE_ADDR='203.0.113.10',
            )
        cache.clear()
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 429)

    def test_session_writes_require_the_login_csrf_token(self):
        get_user_model().objects.create_user(
            email='csrf@example.com',
            password='a-secure-test-password',
            first_name='Csrf',
            last_name='User',
        )
        csrf_client = APIClient(enforce_csrf_checks=True)
        login_response = csrf_client.post(
            reverse('api-login'),
            {'email': 'csrf@example.com', 'password': 'a-secure-test-password'},
            format='json',
        )
        token = login_response.json()['csrf_token']

        rejected = csrf_client.post(
            reverse('api-workspaces'),
            {'name': 'No CSRF', 'timezone': 'UTC'},
            format='json',
        )
        accepted = csrf_client.post(
            reverse('api-workspaces'),
            {'name': 'With CSRF', 'timezone': 'UTC'},
            format='json',
            HTTP_X_CSRFTOKEN=token,
        )

        self.assertEqual(rejected.status_code, 403)
        self.assertEqual(accepted.status_code, 201)

    def test_registration_ignores_a_stale_authenticated_session(self):
        existing_user = get_user_model().objects.create_user(
            email='stale-session@example.com',
            password='a-secure-test-password',
            first_name='Stale',
            last_name='Session',
        )
        csrf_client = APIClient(enforce_csrf_checks=True)
        csrf_client.force_login(existing_user)

        response = csrf_client.post(
            reverse('api-register'),
            {
                'email': 'fresh-registration@example.com',
                'password': 'another-secure-password',
                'first_name': 'Fresh',
                'last_name': 'Registration',
            },
            format='json',
        )

        self.assertEqual(response.status_code, 201)


class WorkspaceCreationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = get_user_model().objects.create_user(
            email='owner@example.com',
            password='a-secure-test-password',
            first_name='Workspace',
            last_name='Owner',
        )

    def test_authenticated_user_creates_complete_owner_graph(self):
        self.client.force_authenticate(self.user)

        response = self.client.post(
            reverse('api-workspaces'),
            {'name': 'Creative Studio', 'timezone': 'Europe/London'},
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        workspace = Workspace.objects.get(slug='creative-studio')
        membership = WorkspaceMembership.objects.get(workspace=workspace)
        self.assertEqual(workspace.created_by_user, self.user)
        self.assertTrue(membership.is_primary_owner)
        self.assertEqual(membership.user, self.user)
        self.assertEqual(membership.role.name, 'Owner')
        self.assertEqual(membership.project_access_mode, ProjectAccessMode.ALL)
        self.assertSetEqual(
            set(RolePermission.objects.filter(role=membership.role).values_list('permission_key', flat=True)),
            set(OWNER_PERMISSION_KEYS),
        )

    def test_anonymous_user_cannot_create_workspace(self):
        response = self.client.post(
            reverse('api-workspaces'),
            {'name': 'Forbidden', 'timezone': 'UTC'},
            format='json',
        )

        self.assertIn(response.status_code, (401, 403))
        self.assertFalse(Workspace.objects.exists())

    def test_invalid_timezone_is_rejected(self):
        self.client.force_authenticate(self.user)
        response = self.client.post(
            reverse('api-workspaces'),
            {'name': 'Bad Time', 'timezone': 'Not/A-Timezone'},
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn('timezone', response.json())

    def test_duplicate_workspace_slug_is_rejected(self):
        create_workspace(
            owner=self.user,
            name='Existing Studio',
            slug='existing-studio',
            workspace_timezone='UTC',
        )
        self.client.force_authenticate(self.user)

        response = self.client.post(
            reverse('api-workspaces'),
            {'name': 'Duplicate Studio', 'slug': 'existing-studio', 'timezone': 'UTC'},
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn('slug', response.json())

    def test_workspace_creation_rolls_back_on_owner_graph_failure(self):
        with patch(
            'app.services.workspaces.RolePermission.objects.bulk_create',
            side_effect=RuntimeError('simulated permission failure'),
        ):
            with self.assertRaises(RuntimeError):
                create_workspace(
                    owner=self.user,
                    name='Rollback Studio',
                    slug='rollback-studio',
                    workspace_timezone='UTC',
                )

        self.assertFalse(Workspace.objects.filter(slug='rollback-studio').exists())
        self.assertFalse(Role.objects.filter(name='Owner').exists())


class DomainInvariantTests(TestCase):
    def setUp(self):
        self.now = timezone.now()
        self.user = get_user_model().objects.create_user(
            email='invariants@example.com',
            password='a-secure-test-password',
            first_name='Invariant',
            last_name='Tester',
        )
        self.workspace, self.owner_membership = create_workspace(
            owner=self.user,
            name='Invariant Workspace',
            slug='invariant-workspace',
            workspace_timezone='UTC',
        )

    def _workspace(self, name, slug):
        return Workspace.objects.create(
            id=uuid.uuid4(),
            name=name,
            slug=slug,
            created_by_user=self.user,
            timezone='UTC',
            created_at=self.now,
            updated_at=self.now,
        )

    def _media_version(self):
        project = Project.objects.create(
            id=uuid.uuid4(),
            workspace=self.workspace,
            created_by_user=self.user,
            name='Review Project',
            created_at=self.now,
            updated_at=self.now,
        )
        storage = StorageBackend.objects.create(
            id=uuid.uuid4(),
            name='Test storage',
            provider='test',
            created_at=self.now,
            updated_at=self.now,
        )
        original_file = File.objects.create(
            id=uuid.uuid4(),
            storage_backend=storage,
            object_key=f'test/{uuid.uuid4()}',
            original_name='review.mp4',
            mime_type='video/mp4',
            size_bytes=1024,
            status=FileStatus.READY,
            created_at=self.now,
            updated_at=self.now,
        )
        return MediaVersion.objects.create(
            id=uuid.uuid4(),
            project=project,
            original_file=original_file,
            version_number=1,
            title='Review version',
            created_by_user=self.user,
            created_at=self.now,
            updated_at=self.now,
        )

    def test_membership_requires_exactly_one_matching_principal(self):
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                WorkspaceMembership.objects.create(
                    id=uuid.uuid4(),
                    workspace=self.workspace,
                    principal_type=WorkspacePrincipalType.USER,
                    status=WorkspaceMembershipStatus.ACTIVE,
                    joined_at=self.now,
                    created_at=self.now,
                    updated_at=self.now,
                )

    def test_workspace_cannot_have_two_active_primary_owners(self):
        second_user = get_user_model().objects.create_user(
            email='second-owner@example.com',
            password='a-secure-test-password',
            first_name='Second',
            last_name='Owner',
        )
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                WorkspaceMembership.objects.create(
                    id=uuid.uuid4(),
                    workspace=self.workspace,
                    principal_type=WorkspacePrincipalType.USER,
                    user=second_user,
                    role=self.owner_membership.role,
                    project_access_mode=ProjectAccessMode.ALL,
                    is_primary_owner=True,
                    status=WorkspaceMembershipStatus.ACTIVE,
                    joined_at=self.now,
                    created_at=self.now,
                    updated_at=self.now,
                )

    def test_resource_access_rejects_cross_workspace_project(self):
        other_workspace = self._workspace('Other Workspace', 'other-workspace')
        project = Project.objects.create(
            id=uuid.uuid4(),
            workspace=other_workspace,
            created_by_user=self.user,
            name='Other Project',
            created_at=self.now,
            updated_at=self.now,
        )
        access = ResourceAccess(
            id=uuid.uuid4(),
            workspace_membership=self.owner_membership,
            project=project,
            created_at=self.now,
        )

        with self.assertRaises(ValidationError):
            access.full_clean()

    def test_review_comment_and_annotation_require_exactly_one_author(self):
        media_version = self._media_version()

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                ReviewComment.objects.create(
                    id=uuid.uuid4(),
                    media_version=media_version,
                    created_at=self.now,
                    updated_at=self.now,
                )
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Annotation.objects.create(
                    id=uuid.uuid4(),
                    media_version=media_version,
                    created_at=self.now,
                    updated_at=self.now,
                )

    def test_media_version_cannot_have_two_open_stage_entries(self):
        media_version = self._media_version()
        stage = WorkflowStage.objects.create(
            id=uuid.uuid4(),
            workspace=self.workspace,
            name='Review',
            slug='review',
            sort_order=1,
            created_by_user=self.user,
            created_at=self.now,
            updated_at=self.now,
        )
        entry_data = {
            'media_version': media_version,
            'workflow_stage': stage,
            'snapshot': {'stage': 'review'},
            'entered_at': self.now,
            'changed_by_user': self.user,
            'created_at': self.now,
        }
        MediaVersionStageEntry.objects.create(id=uuid.uuid4(), **entry_data)

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                MediaVersionStageEntry.objects.create(id=uuid.uuid4(), **entry_data)

    def test_user_cannot_have_two_current_subscriptions(self):
        subscription_data = {
            'user': self.user,
            'started_at': self.now,
            'created_at': self.now,
            'updated_at': self.now,
        }
        UserSubscription.objects.create(
            id=uuid.uuid4(),
            status=SubscriptionStatus.ACTIVE,
            **subscription_data,
        )

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                UserSubscription.objects.create(
                    id=uuid.uuid4(),
                    status=SubscriptionStatus.PAST_DUE,
                    **subscription_data,
                )
