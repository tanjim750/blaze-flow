"""Project messages: one thread per project, in two channels.

* ``client`` ("With client"): the team and the project's client contacts.
* ``team`` ("Team only"): workspace users only. Anyone who is in the workspace only through a
  client team never gets a team message back from any route: every read goes through
  ``thread_access``, which only offers the team channel to people ``can_see_team_notes``.

Reading needs ``project.read`` on the project; posting needs ``review.comment.create`` (the
key that already separates commenters from read-only members), so the permissions endpoint
answers "may I post?" with no new key.

Notifications go through the centre: one row per person and thread, counted up while unread
(a burst of ten messages is one bell entry saying "10 new messages"), plus one row per
@mention. The sender is never notified, and each person's in-app settings are respected.
"""
import uuid
from pathlib import Path

from django.conf import settings
from django.core.files.storage import default_storage
from django.db import transaction
from django.db.models import Count, Max, Q
from django.utils import timezone

from app.models import (
    ClientTeamMember, ClientTeamMemberStatus, File, FileSecurityScan, FileStatus, MediaVersion, MediaVersionStatus,
    MessageChannel, Notification, NotificationKind, ProjectAccessMode, ProjectFile, ProjectMessage,
    ProjectMessageAttachment, ProjectMessageRead, ResourceAccess, RolePermission, RoleStatus, UserStatus,
    WorkspaceMembership, WorkspaceMembershipStatus, WorkspacePrincipalType,
)
from app.permissions import (
    MEDIA_READ, PROJECT_FILE_READ, PROJECT_READ, REVIEW_COMMENT_CREATE, has_project_permission,
    memberships_with_permission,
)

from .audit import record_user_audit
from .comments import can_see_team_notes
from .file_processing import SCAN_TOPIC, enqueue_file_event
from .media import _storage_backend, sha256_upload
from .notifications import in_app_enabled
from .review_assets import ReviewAttachmentError, validate_attachment
from .subscriptions import enforce_workspace_storage_limit

BODY_MAX = 5000
MAX_ATTACHMENTS = 10
SNIPPET = 160
CHANNELS = (MessageChannel.CLIENT, MessageChannel.TEAM)


class MessageError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


# ----------------------------------------------------------------- access

def _client_membership(user, project):
    if not project.client_team_id:
        return None
    return memberships_with_permission(user=user, workspace=project.workspace, permission_key=PROJECT_READ).filter(
        principal_type=WorkspacePrincipalType.CLIENT_TEAM, client_team_id=project.client_team_id,
    ).first()


def thread_access(*, user, project):
    """What this person may do in the project's thread, or None if they may not see it."""
    if not user or not user.is_authenticated or not has_project_permission(user=user, project=project, permission_key=PROJECT_READ):
        return None
    if can_see_team_notes(user=user, workspace=project.workspace):
        kind, channels = 'team', [MessageChannel.CLIENT.value, MessageChannel.TEAM.value]
    elif _client_membership(user, project) is not None:
        kind, channels = 'client', [MessageChannel.CLIENT.value]
    else:
        return None
    return {
        'kind': kind, 'channels': channels,
        'can_post': has_project_permission(user=user, project=project, permission_key=REVIEW_COMMENT_CREATE),
        'can_link_files': has_project_permission(user=user, project=project, permission_key=PROJECT_FILE_READ),
        'can_link_cuts': has_project_permission(user=user, project=project, permission_key=MEDIA_READ),
        'has_client': bool(project.client_team_id),
    }


def require_channel(access, channel):
    if access is None:
        raise MessageError('Project not found.', status=404)
    if channel not in access['channels']:
        # Same answer as a project that does not exist: a client learns nothing about it.
        raise MessageError('Channel not found.', status=404)


def _roles_with(key):
    return set(RolePermission.objects.filter(permission_key=key, role__status=RoleStatus.ACTIVE).values_list('role_id', flat=True))


def _reaches(membership, project, granted):
    return membership.project_access_mode == ProjectAccessMode.ALL or membership.id in granted


def readers(*, project, channel):
    """``{user_id: (user, is_client)}`` for everyone who can read this channel."""
    readable = _roles_with(PROJECT_READ)
    memberships = list(WorkspaceMembership.objects.filter(
        workspace=project.workspace, status=WorkspaceMembershipStatus.ACTIVE, role_id__in=readable,
    ).select_related('user'))
    granted = set(ResourceAccess.objects.filter(project=project, workspace_membership__in=memberships).values_list('workspace_membership_id', flat=True))
    people = {}
    for membership in memberships:
        if membership.principal_type == WorkspacePrincipalType.USER and membership.user and _reaches(membership, project, granted):
            if membership.user.status == UserStatus.ACTIVE:
                people[membership.user_id] = (membership.user, False)
    if channel == MessageChannel.CLIENT and project.client_team_id:
        team = next((m for m in memberships if m.principal_type == WorkspacePrincipalType.CLIENT_TEAM and m.client_team_id == project.client_team_id), None)
        if team and _reaches(team, project, granted):
            for member in ClientTeamMember.objects.filter(client_team_id=project.client_team_id, status=ClientTeamMemberStatus.ACTIVE).select_related('user'):
                if member.user.status == UserStatus.ACTIVE and member.user_id not in people:
                    people[member.user_id] = (member.user, True)
    return people


def mentionable(*, project, channel):
    rows = [
        {'id': str(user.id), 'name': user.get_full_name() or user.email, 'is_client': is_client}
        for user, is_client in readers(project=project, channel=channel).values()
    ]
    return sorted(rows, key=lambda row: (row['is_client'], row['name'].lower()))


# ------------------------------------------------------------- serialising

def _person_name(user):
    return user.get_full_name() or user.email


def attachment_data(item, *, base, access):
    data = {'id': str(item.id), 'kind': item.kind, 'name': None, 'mime_type': None, 'size_bytes': None, 'href': None, 'status': None}
    if item.kind == 'upload' and item.file_id:
        data.update(name=item.file.original_name, mime_type=item.file.mime_type, size_bytes=item.file.size_bytes, status=item.file.status)
        if item.message_id:
            data['href'] = f'{base}/messages/{item.message_id}/attachments/{item.id}/'
    elif item.kind == 'file' and item.project_file_id:
        record = item.project_file.file
        data.update(name=record.original_name, mime_type=record.mime_type, size_bytes=record.size_bytes, status=record.status)
        if item.message_id:
            data['href'] = f'{base}/messages/{item.message_id}/attachments/{item.id}/'
        data['removed'] = item.project_file.deleted_at is not None
    elif item.kind == 'cut' and item.media_version_id:
        version = item.media_version
        data.update(name=f'{version.title} · V{version.version_number}', mime_type=version.original_file.mime_type)
        # The link only helps someone who can open the review page.
        data['href'] = f'/review?media={version.original_file_id}' if access and access['can_link_cuts'] else None
        data['removed'] = version.status != MediaVersionStatus.ACTIVE
    else:
        data.update(name='Removed attachment', removed=True)
    return data


def message_data(message, *, user, access):
    base = f'/api/workspaces/{message.workspace_id}/projects/{message.project_id}'
    deleted = message.deleted_at is not None
    quote = None
    if message.reply_to_id:
        parent = message.reply_to
        quote = {
            'id': str(parent.id), 'author_name': parent.author_name,
            'snippet': '' if parent.deleted_at else parent.body[:SNIPPET], 'deleted': parent.deleted_at is not None,
        }
    return {
        'id': str(message.id), 'channel': message.channel,
        'author': {'id': str(message.author_user_id) if message.author_user_id else None, 'name': message.author_name, 'is_client': message.author_is_client},
        'body': '' if deleted else message.body,
        'mentions': [] if deleted else message.mentions,
        'reply_to': quote,
        'attachments': [] if deleted else [attachment_data(item, base=base, access=access) for item in message.attachments.all()],
        'mine': message.author_user_id == user.id,
        'can_edit': message.author_user_id == user.id and not deleted and bool(access and access['can_post']),
        'edited_at': message.edited_at, 'deleted': deleted, 'created_at': message.created_at,
    }


def thread_queryset(project, channel):
    return ProjectMessage.objects.filter(project=project, channel=channel).select_related('reply_to').prefetch_related(
        'attachments__file', 'attachments__project_file__file', 'attachments__media_version__original_file',
    )


# ------------------------------------------------------------------ writing

def store_upload(*, project, user, upload):
    """Stores one attachment ahead of its message; scanned like a review attachment."""
    try:
        mime_type = validate_attachment(upload)
    except ReviewAttachmentError as exc:
        raise MessageError(str(exc)) from exc
    enforce_workspace_storage_limit(workspace=project.workspace, additional_bytes=upload.size)
    checksum = sha256_upload(upload)
    clean_name = Path(upload.name).name or 'attachment'
    key = default_storage.save(f'workspaces/{project.workspace_id}/projects/{project.id}/messages/{uuid.uuid4()}/{clean_name}', upload)
    now = timezone.now()
    try:
        with transaction.atomic():
            enforce_workspace_storage_limit(workspace=project.workspace, additional_bytes=upload.size, lock=True)
            record = File.objects.create(
                id=uuid.uuid4(), workspace=project.workspace, storage_backend=_storage_backend(now), object_key=key,
                original_name=clean_name, mime_type=mime_type, size_bytes=upload.size, checksum=checksum,
                checksum_algorithm='sha256', metadata={}, status=FileStatus.PENDING, created_at=now, updated_at=now,
            )
            FileSecurityScan.objects.create(file=record, engine=settings.FILE_SECURITY_SCANNER)
            item = ProjectMessageAttachment.objects.create(
                workspace=project.workspace, project=project, kind='upload', file=record, uploaded_by_user=user,
            )
            enqueue_file_event(file=record, topic=SCAN_TOPIC)
            return item
    except Exception:
        default_storage.delete(key)
        raise


def _clean_mentions(ids, *, project, channel, author):
    if not ids:
        return []
    allowed = {str(user_id) for user_id in readers(project=project, channel=channel)}
    wanted = list(dict.fromkeys(str(value) for value in ids))
    unknown = [value for value in wanted if value not in allowed]
    if unknown:
        raise MessageError('You can only mention people who can read this channel.')
    return [value for value in wanted if value != str(author.id)]


def _attachments(*, project, user, access, upload_ids, file_ids, cut_ids):
    items = []
    if len(upload_ids) + len(file_ids) + len(cut_ids) > MAX_ATTACHMENTS:
        raise MessageError(f'Attach up to {MAX_ATTACHMENTS} items per message.')
    if upload_ids:
        uploads = list(ProjectMessageAttachment.objects.filter(id__in=upload_ids, project=project, uploaded_by_user=user, message__isnull=True, kind='upload'))
        if len(uploads) != len(set(map(str, upload_ids))):
            raise MessageError('One of the uploads is missing or already used. Attach it again.')
        items.extend(uploads)
    if file_ids:
        if not access['can_link_files']:
            raise MessageError('You cannot link project files here.', status=403)
        files = list(ProjectFile.objects.filter(id__in=file_ids, project=project, deleted_at__isnull=True))
        if len(files) != len(set(map(str, file_ids))):
            raise MessageError('One of the linked files is not in this project.')
        items.extend(ProjectMessageAttachment(workspace=project.workspace, project=project, kind='file', project_file=row, uploaded_by_user=user) for row in files)
    if cut_ids:
        if not access['can_link_cuts']:
            raise MessageError('You cannot link cuts here.', status=403)
        cuts = list(MediaVersion.objects.filter(id__in=cut_ids, project=project, status=MediaVersionStatus.ACTIVE))
        if len(cuts) != len(set(map(str, cut_ids))):
            raise MessageError('One of the linked cuts is not in this project.')
        items.extend(ProjectMessageAttachment(workspace=project.workspace, project=project, kind='cut', media_version=row, uploaded_by_user=user) for row in cuts)
    return items


@transaction.atomic
def post_message(*, project, channel, user, access, body='', reply_to_id=None, mention_ids=None, upload_ids=(), file_ids=(), cut_ids=()):
    require_channel(access, channel)
    if not access['can_post']:
        raise MessageError('Your role can read messages but not post them.', status=403)
    body = (body or '').strip()
    if len(body) > BODY_MAX:
        raise MessageError(f'Keep messages under {BODY_MAX} characters.')
    items = _attachments(project=project, user=user, access=access, upload_ids=list(upload_ids or ()), file_ids=list(file_ids or ()), cut_ids=list(cut_ids or ()))
    if not body and not items:
        raise MessageError('Write a message or attach something.')
    reply_to = None
    if reply_to_id:
        reply_to = ProjectMessage.objects.filter(id=reply_to_id, project=project, channel=channel, deleted_at__isnull=True).first()
        if reply_to is None:
            raise MessageError('The message you are replying to is gone.')
    mentions = _clean_mentions(mention_ids, project=project, channel=channel, author=user)
    message = ProjectMessage.objects.create(
        workspace=project.workspace, project=project, channel=channel, author_user=user, author_name=_person_name(user),
        author_is_client=access['kind'] == 'client', body=body, reply_to=reply_to, mentions=mentions,
    )
    for item in items:
        item.message = message
        item.save()
    mark_read(user=user, project=project, channel=channel, at=message.created_at)
    record_user_audit(
        user=user, workspace=project.workspace, action='project.message.posted', entity_type='project_message',
        entity_id=message.id, project=project, team_only=channel == MessageChannel.TEAM,
        metadata={'channel': channel, 'attachments': len(items)},
    )
    notify_message(message=message)
    return message


def edit_message(*, message, user, access, body):
    if message.author_user_id != user.id or message.deleted_at or not access['can_post']:
        raise MessageError('You can only edit your own messages.', status=403)
    body = (body or '').strip()
    if not body and not message.attachments.exists():
        raise MessageError('A message needs some text. Delete it instead.')
    if len(body) > BODY_MAX:
        raise MessageError(f'Keep messages under {BODY_MAX} characters.')
    message.body = body
    message.edited_at = timezone.now()
    message.save(update_fields=['body', 'edited_at'])
    return message


def delete_message(*, message, user, access):
    if message.author_user_id != user.id or not access['can_post']:
        raise MessageError('You can only delete your own messages.', status=403)
    if message.deleted_at is None:
        message.deleted_at = timezone.now()
        message.save(update_fields=['deleted_at'])
        # A deleted message's mention should not keep pinging.
        Notification.objects.filter(kind=NotificationKind.PROJECT_MESSAGE_MENTION, entity_type='project_message', entity_id=str(message.id), read_at__isnull=True).delete()
    return message


# ------------------------------------------------------------------ reading

def mark_read(*, user, project, channel, at=None):
    at = at or timezone.now()
    row, created = ProjectMessageRead.objects.get_or_create(user=user, project=project, channel=channel, defaults={'last_read_at': at})
    if not created and row.last_read_at < at:
        row.last_read_at = at
        row.save(update_fields=['last_read_at'])
    Notification.objects.filter(
        recipient_user=user, kind=NotificationKind.PROJECT_MESSAGE_NEW, entity_type='project_thread',
        entity_id=f'{project.id}:{channel}', read_at__isnull=True,
    ).update(read_at=timezone.now())
    return row


def unread_for(*, user, projects, channels_by_project):
    """``{project_id: {channel: {'unread': n, 'last_at': dt}}}`` in two queries."""
    project_ids = [project.id for project in projects]
    reads = {(row.project_id, row.channel): row.last_read_at for row in ProjectMessageRead.objects.filter(user=user, project_id__in=project_ids)}
    out = {project_id: {} for project_id in project_ids}
    rows = ProjectMessage.objects.filter(project_id__in=project_ids, deleted_at__isnull=True).values('project_id', 'channel').annotate(last=Max('created_at'))
    for row in rows:
        if row['channel'] in channels_by_project.get(row['project_id'], ()):
            out[row['project_id']][row['channel']] = {'unread': 0, 'last_at': row['last']}
    filters = Q()
    for project_id, channels in channels_by_project.items():
        for channel in channels:
            since = reads.get((project_id, channel))
            clause = Q(project_id=project_id, channel=channel)
            if since:
                clause &= Q(created_at__gt=since)
            filters |= clause
    if filters:
        counted = ProjectMessage.objects.filter(filters, deleted_at__isnull=True).exclude(author_user=user).values('project_id', 'channel').annotate(n=Count('id'))
        for row in counted:
            out[row['project_id']].setdefault(row['channel'], {'unread': 0, 'last_at': None})['unread'] = row['n']
    return out


# ------------------------------------------------------------- notifications

def _followers(message):
    """Who hears about a new message, before preferences: owner, project creator, earlier
    posters in the channel, and the client's contacts when the studio writes to them."""
    project = message.project
    can_read = readers(project=project, channel=message.channel)
    wanted = set()
    owner = WorkspaceMembership.objects.filter(workspace=project.workspace, is_primary_owner=True, status=WorkspaceMembershipStatus.ACTIVE).values_list('user_id', flat=True).first()
    if owner:
        wanted.add(owner)
    wanted.add(project.created_by_user_id)
    wanted.update(ProjectMessage.objects.filter(project=project, channel=message.channel, author_user__isnull=False).values_list('author_user_id', flat=True).distinct())
    if message.channel == MessageChannel.CLIENT and not message.author_is_client:
        wanted.update(user_id for user_id, (_, is_client) in can_read.items() if is_client)
    return {user_id: can_read[user_id][0] for user_id in wanted if user_id in can_read}


def _payload(message, **extra):
    project = message.project
    return {
        'project_id': str(project.id), 'project_name': project.name, 'channel': message.channel,
        'message_id': str(message.id), 'actor_name': message.author_name, 'excerpt': message.body[:SNIPPET],
        **extra,
    }


def _link(message, *, for_client):
    project_id = message.project_id
    if for_client:
        return f'/portal/projects/{project_id}#messages'
    return f'/projects?campaign={project_id}&tab=messages&channel={message.channel}'


def notify_message(*, message):
    sender = message.author_user
    workspace = message.workspace
    can_read = readers(project=message.project, channel=message.channel)
    now = timezone.now()
    mentioned = set()
    for user_id in message.mentions:
        entry = next((value for key, value in can_read.items() if str(key) == user_id), None)
        if entry is None:
            continue
        user, is_client = entry
        mentioned.add(user.id)
        if not in_app_enabled(user_id=user.id, workspace_id=workspace.id, kind=NotificationKind.PROJECT_MESSAGE_MENTION):
            continue
        Notification.objects.get_or_create(
            recipient_user=user, kind=NotificationKind.PROJECT_MESSAGE_MENTION, entity_type='project_message', entity_id=str(message.id),
            defaults={'id': uuid.uuid4(), 'workspace': workspace, 'actor_user': sender, 'created_at': now,
                      'payload': _payload(message, link=_link(message, for_client=is_client))},
        )
    for user_id, user in _followers(message).items():
        if sender is not None and user_id == sender.id or user_id in mentioned:
            continue
        if not in_app_enabled(user_id=user_id, workspace_id=workspace.id, kind=NotificationKind.PROJECT_MESSAGE_NEW):
            continue
        is_client = can_read[user_id][1]
        thread = f'{message.project_id}:{message.channel}'
        row = Notification.objects.filter(recipient_user=user, kind=NotificationKind.PROJECT_MESSAGE_NEW, entity_type='project_thread', entity_id=thread).first()
        if row is None:
            Notification.objects.create(
                id=uuid.uuid4(), recipient_user=user, workspace=workspace, actor_user=sender, kind=NotificationKind.PROJECT_MESSAGE_NEW,
                entity_type='project_thread', entity_id=thread, created_at=now,
                payload=_payload(message, message_count=1, link=_link(message, for_client=is_client)),
            )
            continue
        # One bell row per thread: counted up while unread, started again once read.
        count = (row.payload or {}).get('message_count', 0) + 1 if row.read_at is None else 1
        row.payload = _payload(message, message_count=count, link=_link(message, for_client=is_client))
        row.actor_user = sender
        row.read_at = None
        row.created_at = now
        row.save(update_fields=['payload', 'actor_user', 'read_at', 'created_at'])
