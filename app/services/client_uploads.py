"""Files sent in from outside the team: public upload links and the client portal.

Both paths end in the same place, ``upload_project_file`` (the pipeline every other upload
uses: signature check, storage limit, security scan, media asset), with the file filed in
the project's "From client" folder and a ``ClientUpload`` row recording who sent it.

The team hears about it twice: one notification per drop (a batch of files sent together)
for the link's creator and the primary owner, and one activity row per file.
"""
import secrets
import uuid
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from app.models import (
    ClientUpload, Notification, NotificationKind, ProjectFolder, ProjectStatus, UploadLink, UserStatus, WorkspaceMembership,
    WorkspaceMembershipStatus, WorkspacePrincipalType,
)
from app.permissions import (
    PROJECT_FILE_CREATE, PROJECT_READ, has_project_permission, memberships_with_permission,
)

from .audit import record_user_audit
from .notifications import in_app_enabled
from .project_files import ProjectFileError, _validate_project_file, upload_project_file

FROM_CLIENT_FOLDER = 'From client'
UPLOAD_KINDS = ('video', 'image', 'audio', 'document')
# A link is a public door: past this many files a day it stops taking more, whoever asks.
MAX_FILES_PER_LINK_PER_DAY = int(getattr(settings, 'UPLOAD_LINK_MAX_FILES_PER_DAY', 300))
# Accept attributes for the browser's file picker, per kind.
KIND_ACCEPT = {
    'video': ['video/*'],
    'image': ['image/*'],
    'audio': ['audio/*'],
    'document': ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.rtf'],
}


class ClientUploadError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def file_kind(mime_type):
    head = (mime_type or '').split('/')[0]
    return head if head in ('video', 'image', 'audio') else 'document'


def effective_max_bytes(link):
    ceiling = settings.MAX_PROJECT_FILE_BYTES
    return min(link.max_file_bytes, ceiling) if link and link.max_file_bytes else ceiling


def link_status(link, now=None):
    now = now or timezone.now()
    if link.revoked_at:
        return 'revoked'
    if link.expires_at and link.expires_at <= now:
        return 'expired'
    return 'active'


def _clean_kinds(kinds):
    kinds = list(dict.fromkeys(kinds or []))
    unknown = [kind for kind in kinds if kind not in UPLOAD_KINDS]
    if unknown:
        raise ClientUploadError(f"Unknown file types: {', '.join(unknown)}. Use {', '.join(UPLOAD_KINDS)}.")
    return [] if set(kinds) == set(UPLOAD_KINDS) else kinds


# ----------------------------------------------------------------------- links

def create_upload_link(*, project, user, membership, label, instructions='', due_at=None, expires_at=None,
                       max_file_bytes=None, allowed_kinds=None):
    if expires_at and expires_at <= timezone.now():
        raise ClientUploadError('The expiry has to be in the future.')
    if max_file_bytes is not None and max_file_bytes > settings.MAX_PROJECT_FILE_BYTES:
        raise ClientUploadError('The size limit is above what this workspace accepts per file.')
    link = UploadLink.objects.create(
        workspace=project.workspace, project=project, label=label.strip(), instructions=(instructions or '').strip(),
        token=secrets.token_urlsafe(24), due_at=due_at, expires_at=expires_at, max_file_bytes=max_file_bytes,
        allowed_kinds=_clean_kinds(allowed_kinds), created_by_workspace_membership=membership, created_by_user=user,
    )
    record_user_audit(
        user=user, workspace=project.workspace, action='upload_link.created', entity_type='upload_link',
        entity_id=link.id, project=project, team_only=True, metadata={'label': link.label},
    )
    return link


def update_upload_link(*, link, user, changes):
    if link.revoked_at:
        raise ClientUploadError('A revoked link cannot be changed.')
    if 'allowed_kinds' in changes:
        changes['allowed_kinds'] = _clean_kinds(changes['allowed_kinds'])
    if changes.get('max_file_bytes') and changes['max_file_bytes'] > settings.MAX_PROJECT_FILE_BYTES:
        raise ClientUploadError('The size limit is above what this workspace accepts per file.')
    for field, value in changes.items():
        setattr(link, field, value.strip() if isinstance(value, str) else value)
    link.save()
    return link


def revoke_upload_link(*, link, user):
    if link.revoked_at:
        return link
    link.revoked_at = timezone.now()
    link.revoked_by_user = user
    link.save(update_fields=['revoked_at', 'revoked_by_user', 'updated_at'])
    record_user_audit(
        user=user, workspace=link.workspace, action='upload_link.revoked', entity_type='upload_link',
        entity_id=link.id, project=link.project, team_only=True, metadata={'label': link.label},
    )
    return link


def resolve_link(token):
    """The live link for a token, or a ClientUploadError the public page can show as-is."""
    link = UploadLink.objects.select_related('workspace', 'project').filter(token=token or '').first()
    if link is None:
        raise ClientUploadError('This upload link does not exist.', status=404)
    state = link_status(link)
    if state == 'revoked':
        raise ClientUploadError('This upload link has been turned off by the studio.', status=410)
    if state == 'expired':
        raise ClientUploadError('This upload link has expired.', status=410)
    if link.project.status in (ProjectStatus.ARCHIVED, ProjectStatus.PENDING_DELETION):
        raise ClientUploadError('This project is no longer available.', status=410)
    return link


# ---------------------------------------------------------------------- folder

def from_client_folder(*, project, membership):
    """The project's root "From client" folder, made (or brought back) on first use."""
    folder = ProjectFolder.objects.filter(project=project, parent_folder__isnull=True, name=FROM_CLIENT_FOLDER).first()
    now = timezone.now()
    if folder is not None:
        if folder.deleted_at is not None:
            folder.deleted_at = None
            folder.updated_at = now
            folder.save(update_fields=['deleted_at', 'updated_at'])
        return folder
    try:
        with transaction.atomic():
            return ProjectFolder.objects.create(
                id=uuid.uuid4(), workspace=project.workspace, client_team=project.client_team, project=project,
                parent_folder=None, name=FROM_CLIENT_FOLDER, created_by_workspace_membership=membership,
                created_at=now, updated_at=now,
            )
    except IntegrityError:
        # Two drops raced to make it; the other one won.
        return ProjectFolder.objects.get(project=project, parent_folder__isnull=True, name=FROM_CLIENT_FOLDER)


# ----------------------------------------------------------------- permissions

def portal_upload_membership(*, user, project):
    """The membership a signed-in user sends client files with, or None if they may not.

    Team members who may add project files can. A client may when their client team is
    the project's client and they can see the project: sending footage and brand files is
    part of being the client, even for a role that cannot browse the project's files.
    """
    if not user or not user.is_authenticated:
        return None
    if has_project_permission(user=user, project=project, permission_key=PROJECT_FILE_CREATE):
        return memberships_with_permission(user=user, workspace=project.workspace, permission_key=PROJECT_FILE_CREATE).first()
    if project.client_team_id and has_project_permission(user=user, project=project, permission_key=PROJECT_READ):
        return memberships_with_permission(
            user=user, workspace=project.workspace, permission_key=PROJECT_READ,
        ).filter(principal_type=WorkspacePrincipalType.CLIENT_TEAM, client_team_id=project.client_team_id).first()
    return None


# --------------------------------------------------------------------- uploads

def check_link_upload(link, upload):
    """Size and type rules of one link, checked before anything is stored."""
    limit = effective_max_bytes(link)
    if upload.size > limit:
        raise ClientUploadError(f'"{upload.name}" is {upload.size / 1048576:.0f} MB; this link accepts files up to {limit / 1048576:.0f} MB.', status=413)
    try:
        mime_type = _validate_project_file(upload)
    except ProjectFileError as exc:
        raise ClientUploadError(f'"{upload.name}": {exc}') from exc
    kinds = link.allowed_kinds if link else []
    if kinds and file_kind(mime_type) not in kinds:
        raise ClientUploadError(f'"{upload.name}" is a {file_kind(mime_type)} file; this link accepts {", ".join(kinds)} only.', status=415)
    return mime_type


def _daily_cap(link):
    since = timezone.now() - timedelta(days=1)
    if ClientUpload.objects.filter(upload_link=link, created_at__gte=since).count() >= MAX_FILES_PER_LINK_PER_DAY:
        raise ClientUploadError('This link has received its daily limit of files. Please try again tomorrow.', status=429)


def receive_client_upload(*, project, upload, name, email, batch_id, link=None, user=None, membership=None):
    """Stores one file sent by a client and tells the team. Returns the ClientUpload."""
    if link is not None:
        _daily_cap(link)
        membership = link.created_by_workspace_membership
    if membership is None:
        raise ClientUploadError('You cannot send files to this project.', status=403)
    check_link_upload(link, upload)
    folder = from_client_folder(project=project, membership=membership)
    try:
        project_file = upload_project_file(project=project, upload=upload, membership=membership, folder=folder)
    except ProjectFileError as exc:
        raise ClientUploadError(str(exc)) from exc
    received = ClientUpload.objects.create(
        workspace=project.workspace, project=project, project_file=project_file, upload_link=link,
        uploaded_by_user=user, uploader_name=name.strip()[:120], uploader_email=email.strip().lower(), batch_id=batch_id,
    )
    record_user_audit(
        user=user, workspace=project.workspace, action='client_upload.received', entity_type='project_file',
        entity_id=project_file.id, project=project, team_only=False,
        metadata={
            'file_name': project_file.file.original_name, 'folder_id': str(folder.id),
            'uploader_name': received.uploader_name, 'via': 'link' if link else 'portal',
            'upload_link_id': str(link.id) if link else None, 'label': link.label if link else None,
        },
    )
    notify_client_upload(received=received, folder=folder, actor=user)
    return received


def _primary_owner(workspace):
    membership = WorkspaceMembership.objects.filter(
        workspace=workspace, is_primary_owner=True, status=WorkspaceMembershipStatus.ACTIVE,
        principal_type=WorkspacePrincipalType.USER,
    ).select_related('user').first()
    return membership.user if membership else None


def notify_client_upload(*, received, folder, actor=None):
    """One row per drop and recipient, counted up as more files of the same drop land.

    A re-used row is marked unread again so a second file is not lost under a read first one.
    """
    workspace, project = received.workspace, received.project
    recipients = {}
    link = received.upload_link
    for user in (link.created_by_user if link else None, _primary_owner(workspace)):
        if user is not None:
            recipients[user.id] = user
    batch = ClientUpload.objects.filter(batch_id=received.batch_id).select_related('project_file__file').order_by('created_at')
    names = [row.project_file.file.original_name for row in batch]
    payload = {
        'project_id': str(project.id), 'project_name': project.name, 'folder_id': str(folder.id),
        'link': f'/files?folder={folder.id}', 'uploader_name': received.uploader_name,
        'uploader_email': received.uploader_email, 'file_count': len(names), 'file_names': names[-5:],
        'upload_link_label': link.label if link else None, 'actor_name': received.uploader_name,
    }
    now = timezone.now()
    for user in recipients.values():
        if user.status != UserStatus.ACTIVE or (actor is not None and user.id == actor.id):
            continue
        if not in_app_enabled(user_id=user.id, workspace_id=workspace.id, kind=NotificationKind.CLIENT_UPLOAD_RECEIVED):
            continue
        notification, created = Notification.objects.get_or_create(
            recipient_user=user, kind=NotificationKind.CLIENT_UPLOAD_RECEIVED,
            entity_type='client_upload_batch', entity_id=str(received.batch_id),
            defaults={'id': uuid.uuid4(), 'workspace': workspace, 'actor_user': actor, 'payload': payload, 'created_at': now},
        )
        if not created:
            notification.payload = payload
            notification.read_at = None
            notification.created_at = now
            notification.save(update_fields=['payload', 'read_at', 'created_at'])
