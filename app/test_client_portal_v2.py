"""Client portal v2: studio branding, the client project page and project requests."""
import io
from datetime import timedelta

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from .models import (
    ClientTeam, MediaVersion, Notification, NotificationKind, Project, ProjectRequest, ProjectStatus, ResourceAccess,
    WorkflowStage, WorkspaceMembership,
)
from .permissions import MEDIA_DOWNLOAD, MEDIA_READ, PROJECT_READ, WORKSPACE_READ
from .services.decisions import record_decision
from .services.portal import compute_phases
from .test_role_dashboards import DashboardBase


def image_file(fmt='PNG', name='logo.png', mime='image/png'):
    buffer = io.BytesIO()
    Image.new('RGB', (40, 20), (124, 92, 255)).save(buffer, format=fmt)
    return SimpleUploadedFile(name, buffer.getvalue(), content_type=mime)


class PortalBase(DashboardBase, TestCase):
    def setUp(self):
        super().setUp()
        cache.clear()
        role = self.custom_role('Client reviewer', [WORKSPACE_READ, PROJECT_READ, MEDIA_READ, MEDIA_DOWNLOAD, 'review.comment.create'])
        self.client_user = self.add_client_member('sam@client.example', role=role, team_name='Northlight Coffee')
        self.team = ClientTeam.objects.get(workspace=self.workspace, name='Northlight Coffee')
        Project.objects.filter(id=self.project_id).update(client_team=self.team, status=ProjectStatus.ACTIVE)
        self.project = Project.objects.get(id=self.project_id)


class BrandingTests(PortalBase):
    def url(self, name='api-workspace-branding'):
        return reverse(name, args=[self.workspace.id])

    def test_owner_sets_colour_welcome_and_logo_which_clients_and_public_pages_see(self):
        self.as_user(self.owner)
        response = self.client.patch(self.url(), {'brand_color': '#7c5cff', 'portal_welcome': 'Hi from the studio'}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['brand_color'], '#7C5CFF')
        logo = self.client.post(self.url('api-workspace-branding-logo'), {'file': image_file()}, format='multipart')
        self.assertEqual(logo.status_code, 201, logo.content)
        logo_url = logo.json()['logo_url']
        self.assertTrue(logo_url.startswith(f'/api/public/studios/{self.workspace.id}/logo/'))
        served = APIClient().get(reverse('api-public-studio-logo', args=[self.workspace.id]))
        self.assertEqual(served.status_code, 200)
        self.assertEqual(served['Content-Type'], 'image/png')
        self.assertEqual(served['X-Content-Type-Options'], 'nosniff')
        self.as_user(self.client_user)
        portal = self.client.get(reverse('api-client-portal', args=[self.workspace.id])).json()
        self.assertEqual(portal['branding']['brand_color'], '#7C5CFF')
        self.assertEqual(portal['branding']['portal_welcome'], 'Hi from the studio')
        self.assertEqual(portal['branding']['logo_url'], logo_url)

    def test_branding_reaches_the_public_upload_page(self):
        self.as_user(self.owner)
        self.client.patch(self.url(), {'brand_color': '#22AA88'}, format='json')
        link = self.client.post(reverse('api-project-upload-links', args=[self.workspace.id, self.project_id]), {'label': 'Footage'}, format='json').json()
        public = APIClient().get(reverse('api-public-upload-link', args=[link['token']])).json()
        self.assertEqual(public['branding']['brand_color'], '#22AA88')
        self.assertIsNone(public['branding']['logo_url'])

    def test_rejects_bad_colour_svg_and_fake_images(self):
        self.as_user(self.owner)
        self.assertEqual(self.client.patch(self.url(), {'brand_color': 'red'}, format='json').status_code, 400)
        svg = SimpleUploadedFile('logo.svg', b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', content_type='image/svg+xml')
        self.assertEqual(self.client.post(self.url('api-workspace-branding-logo'), {'file': svg}, format='multipart').status_code, 400)
        fake = SimpleUploadedFile('logo.png', b'\x89PNG\r\n\x1a\nnot really', content_type='image/png')
        self.assertEqual(self.client.post(self.url('api-workspace-branding-logo'), {'file': fake}, format='multipart').status_code, 400)
        gif = image_file('GIF', 'logo.gif', 'image/gif')
        self.assertEqual(self.client.post(self.url('api-workspace-branding-logo'), {'file': gif}, format='multipart').status_code, 400)

    def test_clients_cannot_change_branding_and_logo_can_be_removed(self):
        self.as_user(self.client_user)
        self.assertEqual(self.client.patch(self.url(), {'brand_color': '#000000'}, format='json').status_code, 403)
        self.assertFalse(self.client.get(self.url()).json()['can_edit'])
        self.as_user(self.owner)
        self.client.post(self.url('api-workspace-branding-logo'), {'file': image_file('WEBP', 'l.webp', 'image/webp')}, format='multipart')
        removed = self.client.delete(self.url('api-workspace-branding-logo'))
        self.assertIsNone(removed.json()['logo_url'])
        self.assertEqual(APIClient().get(reverse('api-public-studio-logo', args=[self.workspace.id])).status_code, 404)


class ProjectOverviewTests(PortalBase):
    def overview(self, user=None):
        self.as_user(user or self.client_user)
        return self.client.get(reverse('api-client-project-overview', args=[self.workspace.id, self.project_id]))

    def test_phases_follow_cuts_and_decisions(self):
        data = self.overview().json()
        self.assertEqual(data['current_phase'], 'production')
        cut = self.upload(title='Hero 30s')
        stage = WorkflowStage.objects.get(workspace=self.workspace, slug='in-review')
        response = self.client.post(reverse('api-media-version-workflow', args=[self.workspace.id, self.project_id, cut['id']]), {'workflow_stage_id': str(stage.id)}, format='json')
        self.assertIn(response.status_code, (200, 201), response.content)
        data = self.overview().json()
        self.assertEqual(data['current_phase'], 'review')
        self.assertEqual(data['counts']['waiting'], 1)
        media = MediaVersion.objects.get(id=cut['id'])
        record_decision(media_version=media, decision='approved', user=self.client_user)
        MediaVersion.objects.filter(id=cut['id']).update(allow_download=True)
        data = self.overview().json()
        self.assertEqual(data['current_phase'], 'delivered')
        self.assertEqual(data['history'][0]['decision'], 'approved')
        self.assertEqual(data['history'][0]['reviewer_name'], 'Cleo Client')
        self.assertTrue(data['cuts'][0]['download_path'].endswith(f"/media-versions/{cut['id']}/download/"))
        kinds = [event['kind'] for event in data['timeline']]
        self.assertIn('shared', kinds)
        self.assertIn('approved', kinds)
        self.assertNotIn('tasks', data)

    def test_an_older_version_in_revision_does_not_hold_progress_back(self):
        stages = {stage.slug: stage for stage in WorkflowStage.objects.filter(workspace=self.workspace)}
        first = self.upload(title='Hero 30s')
        second = self.upload(title='Hero 30s')
        for cut, slug in ((first, 'revision'), (second, 'approved')):
            self.client.post(reverse('api-media-version-workflow', args=[self.workspace.id, self.project_id, cut['id']]), {'workflow_stage_id': str(stages[slug].id)}, format='json')
        data = self.overview().json()
        by_id = {cut['id']: cut for cut in data['cuts']}
        self.assertTrue(by_id[first['id']]['superseded'])
        self.assertFalse(by_id[second['id']]['superseded'])
        self.assertEqual(data['current_phase'], 'signoff')
        self.assertEqual(data['counts']['cuts'], 1)

    def test_without_media_read_no_cuts_are_listed(self):
        role = self.custom_role('Project only', [WORKSPACE_READ, PROJECT_READ])
        WorkspaceMembership.objects.filter(client_team=self.team).update(role=role)
        self.upload(title='Secret cut')
        data = self.overview().json()
        self.assertFalse(data['media_visible'])
        self.assertEqual(data['cuts'], [])

    def test_outsider_gets_404(self):
        other, _ = self.add_member('nobody@example.com', mode='SELECTED')
        self.assertEqual(self.overview(other).status_code, 404)

    def test_compute_phases_shapes(self):
        phases, current = compute_phases(project_status='DRAFT', cuts=[])
        self.assertEqual(current, 'kickoff')
        self.assertEqual([p['state'] for p in phases], ['current', 'upcoming', 'upcoming', 'upcoming', 'upcoming'])
        _, current = compute_phases(project_status='ACTIVE', cuts=[{'state': 'approved', 'downloadable': False}])
        self.assertEqual(current, 'signoff')
        _, current = compute_phases(project_status='ACTIVE', cuts=[{'state': 'approved', 'downloadable': False}, {'state': 'changes', 'downloadable': False}])
        self.assertEqual(current, 'production')
        phases, current = compute_phases(project_status='COMPLETED', cuts=[])
        self.assertEqual(current, 'delivered')
        self.assertTrue(all(p['state'] == 'done' for p in phases))


class ProjectRequestTests(PortalBase):
    def setUp(self):
        super().setUp()
        self.editor, _ = self.add_member('editor@example.com', first='Maya', last='Chen')

    payload = {
        'title': 'Summer menu launch', 'deliverables': [{'kind': 'hero_film', 'quantity': 1}, {'kind': 'social_cutdown', 'quantity': 4}],
        'platform': 'Instagram', 'aspect_ratio': '9:16', 'target_length_seconds': 30,
        'brief': 'Three new cold brews. Bright, summery, people outdoors.', 'references': 'https://example.com/ref',
        'budget_range': '5k_10k',
    }

    def url(self):
        return reverse('api-project-requests', args=[self.workspace.id])

    def submit(self, **extra):
        self.as_user(self.client_user)
        wanted = (timezone.localdate() + timedelta(days=30)).isoformat()
        return self.client.post(self.url(), {**self.payload, 'wanted_by': wanted, **extra}, format='json')

    def test_client_submits_owner_is_told_and_accepting_opens_a_draft_project_the_client_sees(self):
        response = self.submit()
        self.assertEqual(response.status_code, 201, response.content)
        created = response.json()
        self.assertEqual(created['status'], 'pending')
        self.assertNotIn('requester_email', created)
        self.assertTrue(Notification.objects.filter(recipient_user=self.owner, kind=NotificationKind.PROJECT_REQUEST_NEW).exists())
        # An ordinary member who may create projects is not pinged about every new brief.
        self.assertFalse(Notification.objects.filter(recipient_user=self.editor, kind=NotificationKind.PROJECT_REQUEST_NEW).exists())
        listed = self.client.get(self.url()).json()
        self.assertEqual(listed['viewer'], 'client')
        self.assertTrue(listed['can_request'])
        self.as_user(self.owner)
        inbox = self.client.get(self.url()).json()
        self.assertEqual(inbox['viewer'], 'team')
        self.assertEqual(inbox['pending_count'], 1)
        self.assertEqual(inbox['requests'][0]['requester_email'], 'sam@client.example')
        accepted = self.client.patch(reverse('api-project-request-detail', args=[self.workspace.id, created['id']]), {'action': 'accept', 'note': 'Love it'}, format='json')
        self.assertEqual(accepted.status_code, 200, accepted.content)
        project = Project.objects.get(id=accepted.json()['project_id'])
        self.assertEqual(project.status, ProjectStatus.DRAFT)
        self.assertEqual(project.client_team, self.team)
        self.assertIn('cold brews', project.description)
        self.assertEqual(project.deliverable_specs['platform'], 'Instagram')
        self.assertIn('4 × Social cut-down', project.deliverable_specs['notes'])
        self.assertIsNotNone(project.due_at)
        self.assertTrue(Notification.objects.filter(recipient_user=self.client_user, kind=NotificationKind.PROJECT_REQUEST_DECIDED).exists())
        self.as_user(self.client_user)
        page = self.client.get(reverse('api-client-project-overview', args=[self.workspace.id, project.id]))
        self.assertEqual(page.status_code, 200)
        self.assertEqual(page.json()['current_phase'], 'kickoff')
        self.assertEqual(page.json()['request']['id'], created['id'])
        again = self.client.patch(reverse('api-project-request-detail', args=[self.workspace.id, created['id']]), {'action': 'withdraw'}, format='json')
        self.assertEqual(again.status_code, 409)

    def test_accept_grants_selected_mode_client_team_access(self):
        WorkspaceMembership.objects.filter(client_team=self.team).update(project_access_mode='SELECTED')
        created = self.submit().json()
        self.as_user(self.owner)
        accepted = self.client.patch(reverse('api-project-request-detail', args=[self.workspace.id, created['id']]), {'action': 'accept', 'name': 'Summer 2027'}, format='json').json()
        self.assertTrue(ResourceAccess.objects.filter(project_id=accepted['project_id'], workspace_membership__client_team=self.team).exists())
        self.assertEqual(Project.objects.get(id=accepted['project_id']).name, 'Summer 2027')

    def test_decline_needs_a_note_and_client_can_withdraw(self):
        created = self.submit().json()
        self.as_user(self.owner)
        detail = reverse('api-project-request-detail', args=[self.workspace.id, created['id']])
        self.assertEqual(self.client.patch(detail, {'action': 'decline'}, format='json').status_code, 400)
        declined = self.client.patch(detail, {'action': 'decline', 'note': 'Fully booked in July'}, format='json')
        self.assertEqual(declined.json()['status'], 'declined')
        second = self.submit(title='Another').json()
        self.as_user(self.client_user)
        withdrawn = self.client.patch(reverse('api-project-request-detail', args=[self.workspace.id, second['id']]), {'action': 'withdraw'}, format='json')
        self.assertEqual(withdrawn.json()['status'], 'withdrawn')

    def test_validation_and_permissions(self):
        self.assertEqual(self.submit(deliverables=[]).status_code, 400)
        self.assertEqual(self.submit(deliverables=[{'kind': 'teleport', 'quantity': 1}]).status_code, 400)
        self.assertEqual(self.submit(wanted_by=(timezone.localdate() - timedelta(days=1)).isoformat()).status_code, 400)
        self.assertEqual(self.submit(deliverables=[{'kind': 'ad_spot', 'quantity': 1}, {'kind': 'ad_spot', 'quantity': 2}]).status_code, 400)
        # The team asks through the normal New project flow, not the client form.
        self.as_user(self.owner)
        self.assertEqual(self.client.post(self.url(), self.payload, format='json').status_code, 403)
        created = self.submit().json()
        # A client cannot answer their own request.
        accepted = self.client.patch(reverse('api-project-request-detail', args=[self.workspace.id, created['id']]), {'action': 'accept'}, format='json')
        self.assertEqual(accepted.status_code, 403)
        self.assertEqual(ProjectRequest.objects.get(id=created['id']).status, 'pending')

    def test_other_client_team_does_not_see_requests(self):
        self.submit()
        role = self.custom_role('Other client', [WORKSPACE_READ, PROJECT_READ])
        other = self.add_client_member('ola@other.example', role=role, team_name='Other Co')
        self.as_user(other)
        self.assertEqual(self.client.get(self.url()).json()['requests'], [])
