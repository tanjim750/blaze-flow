"""Client portal v2: studio branding, the client's project page, and project requests.

Three pieces, all seen from the client's side of a workspace:

* **Branding** — an accent colour, a logo and a welcome line on ``WorkspaceProfile``. The
  logo is served by a public route so an upload page opened by someone without an account
  can show it too. Raster images only (no SVG: it can carry script).
* **Project overview** — where a project stands, in plain words, built only from what a
  client may already see: the project's status and dates, its cuts and their stages, and
  the decisions clients made. Tasks and internal stages never appear.
* **Project requests** — a client asks for new work; the studio accepts (a draft project
  opens for that client, carrying the brief) or declines with a note.
"""
import io
import re
import uuid
from datetime import datetime, time

from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.db import transaction
from django.utils import timezone

from app.models import (
    MediaVersion, MediaVersionStatus, Notification, NotificationKind, ProjectAccessMode,
    ProjectRequest, ProjectRequestStatus, ProjectStatus, ResourceAccess, ReviewDecision, ReviewDecisionKind,
    UserStatus, WorkspaceMembership, WorkspaceMembershipStatus, WorkspacePrincipalType, WorkspaceProfile,
)
from app.serializers.media import media_poster_variant
from app.serializers.projects import ASPECT_RATIOS, PLATFORMS

from .audit import record_user_audit
from .dashboard import current_stages
from .notifications import in_app_enabled
from .workspaces import get_or_create_workspace_profile

HEX_COLOR = re.compile(r'^#[0-9a-fA-F]{6}$')
LOGO_MAX_BYTES = 2 * 1024 * 1024
LOGO_TYPES = {'PNG': 'image/png', 'JPEG': 'image/jpeg', 'WEBP': 'image/webp'}
LOGO_EXT = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp'}

# What a client can ask for. Our own catalogue; labels live in the frontend too.
DELIVERABLE_KINDS = {
    'hero_film': 'Hero film',
    'social_cutdown': 'Social cut-down',
    'product_video': 'Product video',
    'event_recap': 'Event recap',
    'ad_spot': 'Ad spot',
    'motion_graphics': 'Motion graphics',
    'photo_set': 'Photo set',
    'other': 'Something else',
}
BUDGET_RANGES = ('under_2k', '2k_5k', '5k_10k', '10k_plus', 'not_sure')
BUDGET_LABELS = {
    'under_2k': 'Under 2k', '2k_5k': '2k–5k', '5k_10k': '5k–10k', '10k_plus': '10k+', 'not_sure': 'Not sure yet',
}


class PortalError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


# ------------------------------------------------------------------- branding

def logo_url(workspace_id, profile):
    if not profile or not profile.logo_object_key:
        return None
    stamp = int(profile.logo_updated_at.timestamp()) if profile.logo_updated_at else 0
    return f'/api/public/studios/{workspace_id}/logo/?v={stamp}'


def branding_for(workspace):
    profile = WorkspaceProfile.objects.filter(workspace=workspace).first()
    return {
        'studio_name': (profile.business_name if profile and profile.business_name else None) or workspace.name,
        'brand_color': profile.brand_color if profile else None,
        'logo_url': logo_url(workspace.id, profile),
        'portal_welcome': profile.portal_welcome if profile else None,
    }


def update_branding(*, workspace, user, changes):
    profile = get_or_create_workspace_profile(workspace=workspace)
    if 'brand_color' in changes:
        color = (changes['brand_color'] or '').strip()
        if color and not HEX_COLOR.match(color):
            raise PortalError('Use a colour like #7C5CFF.')
        profile.brand_color = color.upper() if color else None
    if 'portal_welcome' in changes:
        profile.portal_welcome = (changes['portal_welcome'] or '').strip() or None
    profile.updated_at = timezone.now()
    profile.save()
    record_user_audit(user=user, workspace=workspace, action='workspace.branding.updated', entity_type='workspace',
                      entity_id=workspace.id, metadata={k: changes[k] for k in changes})
    return profile


def _sniff_logo(upload):
    """The verified mime type of a raster logo, or a PortalError. Reads the bytes itself."""
    from PIL import Image, UnidentifiedImageError
    if upload.size > LOGO_MAX_BYTES:
        raise PortalError('Keep the logo under 2 MB.', status=413)
    data = upload.read()
    try:
        with Image.open(io.BytesIO(data)) as image:
            kind = image.format
            image.verify()
    except (UnidentifiedImageError, OSError, SyntaxError) as exc:
        raise PortalError('That file is not an image we can use. Try a PNG, JPG or WebP.') from exc
    if kind not in LOGO_TYPES:
        raise PortalError('Use a PNG, JPG or WebP logo.')
    return LOGO_TYPES[kind], data


def set_logo(*, workspace, user, upload):
    mime_type, data = _sniff_logo(upload)
    profile = get_or_create_workspace_profile(workspace=workspace)
    old_key = profile.logo_object_key
    key = default_storage.save(f'workspaces/{workspace.id}/branding/logo-{uuid.uuid4().hex[:10]}.{LOGO_EXT[mime_type]}', ContentFile(data))
    now = timezone.now()
    profile.logo_object_key, profile.logo_mime_type, profile.logo_updated_at, profile.updated_at = key, mime_type, now, now
    profile.save()
    if old_key and old_key != key:
        default_storage.delete(old_key)
    record_user_audit(user=user, workspace=workspace, action='workspace.logo.updated', entity_type='workspace', entity_id=workspace.id)
    return profile


def clear_logo(*, workspace, user):
    profile = get_or_create_workspace_profile(workspace=workspace)
    if profile.logo_object_key:
        default_storage.delete(profile.logo_object_key)
    profile.logo_object_key = profile.logo_mime_type = None
    profile.logo_updated_at = profile.updated_at = timezone.now()
    profile.save()
    record_user_audit(user=user, workspace=workspace, action='workspace.logo.removed', entity_type='workspace', entity_id=workspace.id)
    return profile


# ----------------------------------------------------------- project overview

PHASES = (
    ('kickoff', 'Kick-off'),
    ('production', 'In production'),
    ('review', 'Your review'),
    ('signoff', 'Signed off'),
    ('delivered', 'Delivered'),
)


def _stage_kind(stage):
    if not stage:
        return 'working'
    slug, name = (stage.get('slug') or '').lower(), (stage.get('name') or '').lower()
    if slug == 'approved' or name == 'approved':
        return 'approved'
    if slug in ('revision', 'revisions', 'changes-requested') or name in ('revision', 'revisions', 'changes requested'):
        return 'changes'
    if 'review' in name or 'approv' in name:
        return 'waiting'
    return 'working'


def compute_phases(*, project_status, cuts):
    """Which of our five client phases are done, current or still ahead.

    ``cuts`` are dicts with ``state`` (waiting / changes / approved / working) and
    ``downloadable``. Returns ``(phases, current_key)``.
    """
    states = [cut['state'] for cut in cuts]
    waiting, approved = 'waiting' in states, 'approved' in states
    delivered = project_status == ProjectStatus.COMPLETED or any(cut['state'] == 'approved' and cut['downloadable'] for cut in cuts)
    if project_status == ProjectStatus.DRAFT and not cuts:
        current = 'kickoff'
    elif delivered and not waiting and not any(state in ('changes', 'working') for state in states):
        current = 'delivered'
    elif waiting:
        current = 'review'
    elif approved and not any(state in ('changes', 'working') for state in states):
        current = 'signoff'
    else:
        current = 'production'
    order = [key for key, _ in PHASES]
    at = order.index(current)
    phases = [
        {'key': key, 'label': label, 'state': 'done' if i < at or (key == 'delivered' and current == 'delivered') else 'current' if i == at else 'upcoming'}
        for i, (key, label) in enumerate(PHASES)
    ]
    return phases, current


def _newest_per_cut(media):
    """Ids of the newest version of each cut. Versions of one cut share a media asset (via
    the project file); rows from before versioning fall back to sharing a title."""
    from app.models import ProjectFile
    assets = dict(ProjectFile.objects.filter(
        file_id__in=[item.original_file_id for item in media], media_asset__isnull=False,
    ).values_list('file_id', 'media_asset_id'))
    newest = {}
    for item in media:
        key = assets.get(item.original_file_id) or f'title:{item.title.strip().lower()}'
        if key not in newest or item.version_number > newest[key].version_number:
            newest[key] = item
    return {item.id for item in newest.values()}


def project_overview(*, project, can_see_media, can_download):
    cuts, history, events = [], [], []
    base = f'/api/workspaces/{project.workspace_id}/projects/{project.id}'
    if can_see_media:
        media = list(MediaVersion.objects.filter(project=project, status=MediaVersionStatus.ACTIVE).select_related('original_file').order_by('version_number'))
        stages = current_stages([item.id for item in media])
        decisions = list(ReviewDecision.objects.filter(project=project, media_version__in=media).select_related('media_version').order_by('-created_at'))
        latest = {}
        for row in reversed(decisions):
            latest[row.media_version_id] = row
        newest = _newest_per_cut(media)
        for item in media:
            stage = stages.get(item.id)
            state = _stage_kind(stage)
            decision = latest.get(item.id)
            cuts.append({
                'id': str(item.id), 'title': item.title, 'version_number': item.version_number, 'state': state,
                'stage_name': stage['name'] if stage else None, 'stage_entered_at': stage['entered_at'] if stage else None,
                'downloadable': bool(item.allow_download and can_download),
                'download_path': f'{base}/media-versions/{item.id}/download/' if item.allow_download and can_download else None,
                'poster_path': f'{base}/media-versions/{item.id}/poster/' if media_poster_variant(item) else None,
                'review_path': f'/review?media={item.original_file_id}',
                'file_name': item.original_file.original_name, 'mime_type': item.original_file.mime_type,
                'size_bytes': item.original_file.size_bytes, 'created_at': item.created_at,
                'last_decision': {'decision': decision.decision, 'reviewer_name': decision.reviewer_name, 'created_at': decision.created_at} if decision else None,
                # An older version of a cut that has a newer one: kept for the record, left out of progress.
                'superseded': item.id not in newest,
            })
            events.append({'kind': 'shared', 'at': item.created_at, 'title': f'{item.title} · V{item.version_number}', 'text': 'Shared with you for review'})
        for row in decisions:
            version = row.media_version
            history.append({
                'id': str(row.id), 'decision': row.decision, 'reviewer_name': row.reviewer_name, 'message': row.message or '',
                'open_notes_count': row.open_notes_count, 'created_at': row.created_at,
                'media_version_id': str(version.id), 'title': version.title, 'version_number': version.version_number,
            })
            approved = row.decision == ReviewDecisionKind.APPROVED
            events.append({
                'kind': 'approved' if approved else 'changes', 'at': row.created_at,
                'title': f'{version.title} · V{version.version_number}',
                'text': f"{'Approved' if approved else 'Changes asked for'} by {row.reviewer_name}",
            })
    live = [cut for cut in cuts if not cut['superseded']]
    phases, current = compute_phases(project_status=project.status, cuts=live)
    events.append({'kind': 'start', 'at': project.start_at or project.created_at, 'title': 'Project opened', 'text': 'The studio set this project up'})
    if project.due_at:
        events.append({'kind': 'due', 'at': project.due_at, 'title': 'Due date', 'text': 'When the studio aims to hand over'})
    origin = ProjectRequest.objects.filter(project=project).first()
    events.sort(key=lambda event: event['at'])
    return {
        'project': {
            'id': str(project.id), 'name': project.name, 'status': project.status, 'description': project.description or '',
            'start_at': project.start_at, 'due_at': project.due_at, 'created_at': project.created_at,
            'client_team_name': project.client_team.name if project.client_team_id else None,
        },
        'phases': phases, 'current_phase': current, 'cuts': cuts, 'history': history, 'timeline': events,
        'counts': {
            'cuts': len(live), 'waiting': sum(cut['state'] == 'waiting' for cut in live),
            'approved': sum(cut['state'] == 'approved' for cut in live),
            'downloadable': sum(cut['downloadable'] for cut in live),
        },
        'request': {'id': str(origin.id), 'created_at': origin.created_at, 'requester_name': origin.requester_name} if origin else None,
        'media_visible': can_see_media,
    }


# ----------------------------------------------------------- project requests

def client_memberships(*, user, workspace):
    """The active client-team memberships a user acts through in this workspace."""
    from app.permissions import active_memberships_for_user
    return active_memberships_for_user(user=user, workspace=workspace).filter(
        principal_type=WorkspacePrincipalType.CLIENT_TEAM,
    ).select_related('client_team', 'workspace')


def _clean_deliverables(items):
    out = []
    for item in items or []:
        kind = item.get('kind') if isinstance(item, dict) else None
        if kind not in DELIVERABLE_KINDS:
            raise PortalError(f'Unknown deliverable: {kind}.')
        try:
            quantity = int(item.get('quantity') or 1)
        except (TypeError, ValueError) as exc:
            raise PortalError('Quantities have to be whole numbers.') from exc
        if not 1 <= quantity <= 50:
            raise PortalError('Ask for between 1 and 50 of each deliverable.')
        if kind in {row['kind'] for row in out}:
            raise PortalError(f'{DELIVERABLE_KINDS[kind]} is listed twice.')
        out.append({'kind': kind, 'quantity': quantity})
    if not out:
        raise PortalError('Pick at least one thing you would like made.')
    return out


def submit_request(*, user, membership, data):
    if data.get('platform') and data['platform'] not in PLATFORMS:
        raise PortalError('Unknown platform.')
    if data.get('aspect_ratio') and data['aspect_ratio'] not in ASPECT_RATIOS:
        raise PortalError('Unknown aspect ratio.')
    if data.get('budget_range') and data['budget_range'] not in BUDGET_RANGES:
        raise PortalError('Unknown budget range.')
    wanted_by = data.get('wanted_by')
    if wanted_by and wanted_by < timezone.localdate():
        raise PortalError('Pick a date from today on.')
    workspace = membership.workspace
    request = ProjectRequest.objects.create(
        workspace=workspace, client_team=membership.client_team, requested_by_user=user,
        requester_name=user.get_full_name() or user.email, title=data['title'].strip(),
        deliverables=_clean_deliverables(data.get('deliverables')), platform=data.get('platform') or None,
        aspect_ratio=data.get('aspect_ratio') or None, target_length_seconds=data.get('target_length_seconds'),
        brief=data['brief'].strip(), references=(data.get('references') or '').strip(), wanted_by=wanted_by,
        budget_range=data.get('budget_range') or '',
    )
    record_user_audit(user=user, workspace=workspace, action='project_request.submitted', entity_type='project_request',
                      entity_id=request.id, metadata={'title': request.title, 'client_team': membership.client_team.name})
    _notify(request, NotificationKind.PROJECT_REQUEST_NEW, recipients=_studio_leads(workspace), actor=user)
    return request


def withdraw_request(*, request, user):
    if request.status != ProjectRequestStatus.PENDING:
        raise PortalError('Only a request still waiting for the studio can be withdrawn.', status=409)
    request.status = ProjectRequestStatus.WITHDRAWN
    request.decided_at = timezone.now()
    request.save(update_fields=['status', 'decided_at', 'updated_at'])
    record_user_audit(user=user, workspace=request.workspace, action='project_request.withdrawn', entity_type='project_request', entity_id=request.id)
    return request


def _due_from(day):
    return timezone.make_aware(datetime.combine(day, time(17, 0))) if day else None


def _specs_note(request):
    lines = [', '.join(f"{row['quantity']} × {DELIVERABLE_KINDS[row['kind']]}" for row in request.deliverables)]
    if request.budget_range:
        lines.append(f'Budget hint: {BUDGET_LABELS[request.budget_range]}')
    return ' · '.join(line for line in lines if line)[:2000]


@transaction.atomic
def accept_request(*, request, user, membership, name=None, note=''):
    """Opens a draft project for the client team that asked, and lets that team see it."""
    from .projects import create_project
    from .subscriptions import enforce_project_creation_limit

    request = ProjectRequest.objects.select_for_update().get(id=request.id)
    if request.status != ProjectRequestStatus.PENDING:
        raise PortalError('This request has already been answered.', status=409)
    enforce_project_creation_limit(workspace=request.workspace)
    description = request.brief
    if request.references:
        description += f'\n\nReferences from the client:\n{request.references}'
    project = create_project(
        workspace=request.workspace, created_by_user=user, authorizing_membership=membership,
        client_team=request.client_team, name=(name or request.title).strip()[:200], description=description,
        status=ProjectStatus.DRAFT, due_at=_due_from(request.wanted_by),
        deliverable_specs={
            'aspect_ratio': request.aspect_ratio, 'platform': request.platform,
            'target_length_seconds': request.target_length_seconds, 'resolution': None, 'notes': _specs_note(request),
        },
    )
    now = timezone.now()
    for team_membership in WorkspaceMembership.objects.filter(
        workspace=request.workspace, principal_type=WorkspacePrincipalType.CLIENT_TEAM, client_team=request.client_team,
        status=WorkspaceMembershipStatus.ACTIVE, project_access_mode=ProjectAccessMode.SELECTED,
    ):
        ResourceAccess.objects.get_or_create(workspace_membership=team_membership, project=project, defaults={'id': uuid.uuid4(), 'created_at': now})
    request.status, request.project, request.decided_by_user, request.decided_at = ProjectRequestStatus.ACCEPTED, project, user, now
    request.decision_note = (note or '').strip()
    request.save()
    record_user_audit(user=user, workspace=request.workspace, action='project_request.accepted', entity_type='project_request',
                      entity_id=request.id, project=project, team_only=False, metadata={'title': request.title})
    _notify(request, NotificationKind.PROJECT_REQUEST_DECIDED, recipients=[request.requested_by_user], actor=user)
    return request


def decline_request(*, request, user, note):
    if request.status != ProjectRequestStatus.PENDING:
        raise PortalError('This request has already been answered.', status=409)
    note = (note or '').strip()
    if not note:
        raise PortalError('Add a short note so the client knows why.')
    request.status, request.decided_by_user, request.decided_at, request.decision_note = ProjectRequestStatus.DECLINED, user, timezone.now(), note
    request.save()
    record_user_audit(user=user, workspace=request.workspace, action='project_request.declined', entity_type='project_request',
                      entity_id=request.id, metadata={'title': request.title})
    _notify(request, NotificationKind.PROJECT_REQUEST_DECIDED, recipients=[request.requested_by_user], actor=user)
    return request


def _studio_leads(workspace):
    """Who hears about a new request: the primary owner and people who manage the workspace.

    Not everyone who may create projects: on most studios that is every editor, and a new
    brief is a sales decision, not something to land in each editor's bell.
    """
    from app.models import RolePermission, RoleStatus
    creator_roles = set(RolePermission.objects.filter(
        permission_key='workspace.manage', role__status=RoleStatus.ACTIVE,
    ).values_list('role_id', flat=True))
    users = {}
    for membership in WorkspaceMembership.objects.filter(
        workspace=workspace, principal_type=WorkspacePrincipalType.USER, status=WorkspaceMembershipStatus.ACTIVE,
    ).select_related('user'):
        if membership.is_primary_owner or membership.role_id in creator_roles:
            users[membership.user_id] = membership.user
    return list(users.values())


def _notify(request, kind, *, recipients, actor):
    payload = {
        'request_id': str(request.id), 'title': request.title, 'status': request.status,
        'client_team_name': request.client_team.name, 'requester_name': request.requester_name,
        'project_id': str(request.project_id) if request.project_id else None,
        'decision_note': request.decision_note[:240] if request.decision_note else '',
        'actor_name': (actor.get_full_name() or actor.email) if actor else None,
        'link': '/clients/requests' if kind == NotificationKind.PROJECT_REQUEST_NEW
        else (f'/portal/projects/{request.project_id}' if request.project_id else '/portal/requests'),
    }
    now = timezone.now()
    for user in recipients:
        if user is None or user.status != UserStatus.ACTIVE or (actor is not None and user.id == actor.id):
            continue
        if not in_app_enabled(user_id=user.id, workspace_id=request.workspace_id, kind=kind):
            continue
        Notification.objects.create(
            id=uuid.uuid4(), recipient_user=user, workspace=request.workspace, actor_user=actor, kind=kind,
            entity_type='project_request', entity_id=str(request.id), payload=payload, created_at=now,
        )


def request_data(request, *, for_team):
    data = {
        'id': str(request.id), 'title': request.title, 'status': request.status,
        'client_team': {'id': str(request.client_team_id), 'name': request.client_team.name},
        'requester_name': request.requester_name, 'deliverables': request.deliverables,
        'platform': request.platform, 'aspect_ratio': request.aspect_ratio,
        'target_length_seconds': request.target_length_seconds, 'brief': request.brief,
        'references': request.references, 'wanted_by': request.wanted_by, 'budget_range': request.budget_range or None,
        'decision_note': request.decision_note, 'decided_at': request.decided_at,
        'decided_by_name': (request.decided_by_user.get_full_name() or request.decided_by_user.email) if request.decided_by_user else None,
        'project_id': str(request.project_id) if request.project_id else None,
        'created_at': request.created_at, 'updated_at': request.updated_at,
    }
    if for_team and request.requested_by_user_id:
        data['requester_email'] = request.requested_by_user.email
    return data
