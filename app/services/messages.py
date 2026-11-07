"""Project / client chat: Slack-style channels with a With-client and Team-only side.

A ``ChatChannel`` is either a client's General channel (no project) or one project channel.
Each channel has two sides (``MessageChannel``): ``client`` shared with the client's contacts,
and ``team`` for workspace users only. Clients never see the team side: every read goes
through ``channel_access``, which only offers it to people ``can_see_team_notes``.

Reading needs ``project.read`` (or, for General, the same key on any of that client's
projects); posting needs ``review.comment.create``. Notifications batch per person and
channel while unread; the sender is never notified; preferences are respected.
"""
import uuid
from pathlib import Path

from django.conf import settings
from django.core.files.storage import default_storage
from django.db import transaction
from django.db.models import Count, Max, Q
from django.utils import timezone

from app.models import (
    ChatChannel, ClientTeam, ClientTeamMember, ClientTeamMemberStatus, File, FileSecurityScan, FileStatus,
    MediaVersion, MediaVersionStatus, MessageChannel, Notification, NotificationKind, Project, ProjectAccessMode,
    ProjectFile, ProjectMessage, ProjectMessageAttachment, ProjectMessageMention, ProjectMessageRead, ProjectStatus,
    ResourceAccess, RolePermission, RoleStatus, UserStatus, WorkspaceMembership, WorkspaceMembershipStatus,
    WorkspacePrincipalType,
)
from app.permissions import (
    MEDIA_READ, PROJECT_FILE_READ, PROJECT_READ, REVIEW_COMMENT_CREATE, accessible_projects, has_project_permission,
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
PAST_STATUSES = {ProjectStatus.COMPLETED, ProjectStatus.ARCHIVED, ProjectStatus.PENDING_DELETION}


class MessageError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


# ---------------------------------------------------------------- channel ensure

def ensure_project_channel(project):
    channel, created = ChatChannel.objects.get_or_create(
        workspace_id=project.workspace_id, project_id=project.id,
        defaults={'client_team_id': project.client_team_id},
    )
    if not created and channel.client_team_id != project.client_team_id:
        channel.client_team_id = project.client_team_id
        channel.save(update_fields=['client_team_id'])
    return channel


def ensure_general_channel(*, workspace, client_team):
    channel, _ = ChatChannel.objects.get_or_create(
        workspace=workspace, client_team=client_team, project=None,
    )
    return channel


def ensure_workspace_channels(workspace):
    """Create missing General and project channels so the sidebar is complete."""
    for team in ClientTeam.objects.filter(workspace=workspace):
        ensure_general_channel(workspace=workspace, client_team=team)
    for project in Project.objects.filter(workspace=workspace).exclude(status=ProjectStatus.PENDING_DELETION):
        ensure_project_channel(project)


# ----------------------------------------------------------------- access

def _client_membership_for_team(user, workspace, client_team_id):
    if not client_team_id:
        return None
    return memberships_with_permission(user=user, workspace=workspace, permission_key=PROJECT_READ).filter(
        principal_type=WorkspacePrincipalType.CLIENT_TEAM, client_team_id=client_team_id,
    ).first()


def _client_membership(user, project):
    return _client_membership_for_team(user, project.workspace, project.client_team_id)


def _general_can_read(*, user, workspace, client_team):
    """Team: can see any of this client's projects. Client: on this client team with project.read."""
    if can_see_team_notes(user=user, workspace=workspace):
        return accessible_projects(user=user, workspace=workspace, permission_key=PROJECT_READ).filter(client_team=client_team).exists()
    return _client_membership_for_team(user, workspace, client_team.id) is not None


def _general_can_post(*, user, workspace, client_team):
    if can_see_team_notes(user=user, workspace=workspace):
        # Any project of this client where they can comment.
        for project in accessible_projects(user=user, workspace=workspace, permission_key=REVIEW_COMMENT_CREATE).filter(client_team=client_team)[:1]:
            return True
        return False
    membership = _client_membership_for_team(user, workspace, client_team.id)
    if membership is None:
        return False
    # Client posting on General: need comment.create via their client-team role.
    return RolePermission.objects.filter(role_id=membership.role_id, permission_key=REVIEW_COMMENT_CREATE).exists()


def channel_access(*, user, chat_channel):
    """What this person may do in this chat channel, or None if they may not see it."""
    if not user or not user.is_authenticated:
        return None
    workspace = chat_channel.workspace
    project = chat_channel.project
    if project is not None:
        if not has_project_permission(user=user, project=project, permission_key=PROJECT_READ):
            return None
        if can_see_team_notes(user=user, workspace=workspace):
            kind, channels = 'team', [MessageChannel.CLIENT.value, MessageChannel.TEAM.value]
        elif _client_membership(user, project) is not None:
            kind, channels = 'client', [MessageChannel.CLIENT.value]
        else:
            return None
        # Studio projects (no client): only the team side makes sense for posting to "client",
        # but we still expose the client side for consistency (empty until a client is added).
        return {
            'kind': kind, 'channels': channels,
            'can_post': has_project_permission(user=user, project=project, permission_key=REVIEW_COMMENT_CREATE),
            'can_link_files': has_project_permission(user=user, project=project, permission_key=PROJECT_FILE_READ),
            'can_link_cuts': has_project_permission(user=user, project=project, permission_key=MEDIA_READ),
            'has_client': bool(project.client_team_id),
            'chat_channel': chat_channel, 'project': project,
        }
    # General channel
    client_team = chat_channel.client_team
    if client_team is None or not _general_can_read(user=user, workspace=workspace, client_team=client_team):
        return None
    if can_see_team_notes(user=user, workspace=workspace):
        kind, channels = 'team', [MessageChannel.CLIENT.value, MessageChannel.TEAM.value]
    else:
        kind, channels = 'client', [MessageChannel.CLIENT.value]
    return {
        'kind': kind, 'channels': channels,
        'can_post': _general_can_post(user=user, workspace=workspace, client_team=client_team),
        'can_link_files': False, 'can_link_cuts': False, 'has_client': True,
        'chat_channel': chat_channel, 'project': None,
    }


def thread_access(*, user, project):
    """Back-compat for the project-scoped aliases."""
    return channel_access(user=user, chat_channel=ensure_project_channel(project))


def require_channel(access, channel):
    if access is None:
        raise MessageError('Channel not found.', status=404)
    if channel not in access['channels']:
        raise MessageError('Channel not found.', status=404)


def _roles_with(key):
    return set(RolePermission.objects.filter(permission_key=key, role__status=RoleStatus.ACTIVE).values_list('role_id', flat=True))


def _reaches(membership, project, granted):
    return membership.project_access_mode == ProjectAccessMode.ALL or membership.id in granted


def readers(*, chat_channel=None, project=None, channel):
    """``{user_id: (user, is_client)}`` for everyone who can read this side."""
    if chat_channel is None and project is not None:
        chat_channel = ensure_project_channel(project)
    workspace = chat_channel.workspace
    project = chat_channel.project
    client_team_id = chat_channel.client_team_id or (project.client_team_id if project else None)
    readable = _roles_with(PROJECT_READ)
    memberships = list(WorkspaceMembership.objects.filter(
        workspace=workspace, status=WorkspaceMembershipStatus.ACTIVE, role_id__in=readable,
    ).select_related('user'))
    people = {}

    if project is not None:
        granted = set(ResourceAccess.objects.filter(project=project, workspace_membership__in=memberships).values_list('workspace_membership_id', flat=True))
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

    # General: team users who reach any of this client's projects; client contacts of the team.
    client_projects = list(Project.objects.filter(workspace=workspace, client_team_id=client_team_id))
    if channel == MessageChannel.TEAM or True:
        for membership in memberships:
            if membership.principal_type != WorkspacePrincipalType.USER or not membership.user or membership.user.status != UserStatus.ACTIVE:
                continue
            if membership.project_access_mode == ProjectAccessMode.ALL:
                # Only if they can actually see at least one of this client's projects (all mode sees all).
                if client_projects:
                    people[membership.user_id] = (membership.user, False)
                continue
            granted_ids = set(ResourceAccess.objects.filter(workspace_membership=membership, project__in=client_projects).values_list('project_id', flat=True))
            if granted_ids:
                people[membership.user_id] = (membership.user, False)
    if channel == MessageChannel.CLIENT and client_team_id:
        for member in ClientTeamMember.objects.filter(client_team_id=client_team_id, status=ClientTeamMemberStatus.ACTIVE).select_related('user'):
            if member.user.status == UserStatus.ACTIVE and member.user_id not in people:
                # Only if their client-team membership has project.read (already filtered memberships above).
                if _client_membership_for_team(member.user, workspace, client_team_id):
                    people[member.user_id] = (member.user, True)
    return people


def mentionable(*, chat_channel, channel):
    rows = [
        {'id': str(user.id), 'name': user.get_full_name() or user.email, 'is_client': is_client}
        for user, is_client in readers(chat_channel=chat_channel, channel=channel).values()
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
        data['href'] = f'/review?media={version.original_file_id}' if access and access['can_link_cuts'] else None
        data['removed'] = version.status != MediaVersionStatus.ACTIVE
    else:
        data.update(name='Removed attachment', removed=True)
    return data


def _api_base(chat_channel):
    return f'/api/workspaces/{chat_channel.workspace_id}/chat/channels/{chat_channel.id}'


def message_data(message, *, user, access):
    base = _api_base(message.chat_channel) if message.chat_channel_id else f'/api/workspaces/{message.workspace_id}/projects/{message.project_id}'
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
        'chat_channel_id': str(message.chat_channel_id) if message.chat_channel_id else None,
        'project_id': str(message.project_id) if message.project_id else None,
        'author': {'id': str(message.author_user_id) if message.author_user_id else None, 'name': message.author_name, 'is_client': message.author_is_client},
        'body': '' if deleted else message.body,
        'mentions': [] if deleted else message.mentions,
        'reply_to': quote,
        'attachments': [] if deleted else [attachment_data(item, base=base, access=access) for item in message.attachments.all()],
        'mine': message.author_user_id == user.id,
        'can_edit': message.author_user_id == user.id and not deleted and bool(access and access['can_post']),
        'edited_at': message.edited_at, 'deleted': deleted, 'created_at': message.created_at,
    }


def thread_queryset(chat_channel, channel):
    return ProjectMessage.objects.filter(chat_channel=chat_channel, channel=channel).select_related('reply_to', 'chat_channel').prefetch_related(
        'attachments__file', 'attachments__project_file__file', 'attachments__media_version__original_file',
    )


# ------------------------------------------------------------------ writing

def store_upload(*, chat_channel=None, user, upload, project=None):
    if chat_channel is None:
        if project is None:
            raise MessageError('Channel not found.', status=404)
        chat_channel = ensure_project_channel(project)
    try:
        mime_type = validate_attachment(upload)
    except ReviewAttachmentError as exc:
        raise MessageError(str(exc)) from exc
    workspace = chat_channel.workspace
    project = project or chat_channel.project
    enforce_workspace_storage_limit(workspace=workspace, additional_bytes=upload.size)
    checksum = sha256_upload(upload)
    clean_name = Path(upload.name).name or 'attachment'
    folder = f'workspaces/{workspace.id}/chat/{chat_channel.id}/{uuid.uuid4()}/{clean_name}'
    key = default_storage.save(folder, upload)
    now = timezone.now()
    try:
        with transaction.atomic():
            enforce_workspace_storage_limit(workspace=workspace, additional_bytes=upload.size, lock=True)
            record = File.objects.create(
                id=uuid.uuid4(), workspace=workspace, storage_backend=_storage_backend(now), object_key=key,
                original_name=clean_name, mime_type=mime_type, size_bytes=upload.size, checksum=checksum,
                checksum_algorithm='sha256', metadata={}, status=FileStatus.PENDING, created_at=now, updated_at=now,
            )
            FileSecurityScan.objects.create(file=record, engine=settings.FILE_SECURITY_SCANNER)
            item = ProjectMessageAttachment.objects.create(
                workspace=workspace, chat_channel=chat_channel, project=project, kind='upload', file=record, uploaded_by_user=user,
            )
            enqueue_file_event(file=record, topic=SCAN_TOPIC)
            return item
    except Exception:
        default_storage.delete(key)
        raise


def _clean_mentions(ids, *, chat_channel, channel, author):
    if not ids:
        return []
    allowed = {str(user_id) for user_id in readers(chat_channel=chat_channel, channel=channel)}
    wanted = list(dict.fromkeys(str(value) for value in ids))
    unknown = [value for value in wanted if value not in allowed]
    if unknown:
        raise MessageError('You can only mention people who can read this channel.')
    return [value for value in wanted if value != str(author.id)]


def _attachments(*, chat_channel, user, access, upload_ids, file_ids, cut_ids):
    items = []
    project = chat_channel.project
    if len(upload_ids) + len(file_ids) + len(cut_ids) > MAX_ATTACHMENTS:
        raise MessageError(f'Attach up to {MAX_ATTACHMENTS} items per message.')
    if upload_ids:
        uploads = list(ProjectMessageAttachment.objects.filter(
            id__in=upload_ids, chat_channel=chat_channel, uploaded_by_user=user, message__isnull=True, kind='upload',
        ))
        if len(uploads) != len(set(map(str, upload_ids))):
            raise MessageError('One of the uploads is missing or already used. Attach it again.')
        items.extend(uploads)
    if file_ids:
        if not access['can_link_files'] or project is None:
            raise MessageError('You cannot link project files here.', status=403)
        files = list(ProjectFile.objects.filter(id__in=file_ids, project=project, deleted_at__isnull=True))
        if len(files) != len(set(map(str, file_ids))):
            raise MessageError('One of the linked files is not in this project.')
        items.extend(ProjectMessageAttachment(
            workspace=chat_channel.workspace, chat_channel=chat_channel, project=project, kind='file', project_file=row, uploaded_by_user=user,
        ) for row in files)
    if cut_ids:
        if not access['can_link_cuts'] or project is None:
            raise MessageError('You cannot link cuts here.', status=403)
        cuts = list(MediaVersion.objects.filter(id__in=cut_ids, project=project, status=MediaVersionStatus.ACTIVE))
        if len(cuts) != len(set(map(str, cut_ids))):
            raise MessageError('One of the linked cuts is not in this project.')
        items.extend(ProjectMessageAttachment(
            workspace=chat_channel.workspace, chat_channel=chat_channel, project=project, kind='cut', media_version=row, uploaded_by_user=user,
        ) for row in cuts)
    return items


@transaction.atomic
def post_message(*, chat_channel=None, project=None, channel, user, access=None, body='', reply_to_id=None, mention_ids=None, upload_ids=(), file_ids=(), cut_ids=()):
    if chat_channel is None:
        if project is None:
            raise MessageError('Channel not found.', status=404)
        chat_channel = ensure_project_channel(project)
        access = access or thread_access(user=user, project=project)
    require_channel(access, channel)
    if not access['can_post']:
        raise MessageError('Your role can read messages but not post them.', status=403)
    body = (body or '').strip()
    if len(body) > BODY_MAX:
        raise MessageError(f'Keep messages under {BODY_MAX} characters.')
    items = _attachments(
        chat_channel=chat_channel, user=user, access=access,
        upload_ids=list(upload_ids or ()), file_ids=list(file_ids or ()), cut_ids=list(cut_ids or ()),
    )
    if not body and not items:
        raise MessageError('Write a message or attach something.')
    reply_to = None
    if reply_to_id:
        reply_to = ProjectMessage.objects.filter(id=reply_to_id, chat_channel=chat_channel, channel=channel, deleted_at__isnull=True).first()
        if reply_to is None:
            raise MessageError('The message you are replying to is gone.')
    mentions = _clean_mentions(mention_ids, chat_channel=chat_channel, channel=channel, author=user)
    message = ProjectMessage.objects.create(
        workspace=chat_channel.workspace, chat_channel=chat_channel, project=chat_channel.project,
        channel=channel, author_user=user, author_name=_person_name(user),
        author_is_client=access['kind'] == 'client', body=body, reply_to=reply_to, mentions=mentions,
    )
    for item in items:
        item.message = message
        item.save()
    for user_id in mentions:
        ProjectMessageMention.objects.get_or_create(
            message=message, user_id=user_id,
            defaults={'chat_channel': chat_channel, 'side': channel},
        )
    ChatChannel.objects.filter(id=chat_channel.id).update(last_message_at=message.created_at)
    mark_read(user=user, chat_channel=chat_channel, channel=channel, at=message.created_at)
    record_user_audit(
        user=user, workspace=chat_channel.workspace, action='project.message.posted', entity_type='project_message',
        entity_id=message.id, project=chat_channel.project, team_only=channel == MessageChannel.TEAM,
        metadata={'channel': channel, 'chat_channel_id': str(chat_channel.id), 'attachments': len(items)},
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
        Notification.objects.filter(kind=NotificationKind.PROJECT_MESSAGE_MENTION, entity_type='project_message', entity_id=str(message.id), read_at__isnull=True).delete()
        ProjectMessageMention.objects.filter(message=message).delete()
    return message


# ------------------------------------------------------------------ reading

def mark_read(*, user, chat_channel, channel, at=None, project=None):
    at = at or timezone.now()
    if chat_channel is None and project is not None:
        chat_channel = ensure_project_channel(project)
    row, created = ProjectMessageRead.objects.get_or_create(
        user=user, chat_channel=chat_channel, channel=channel,
        defaults={'last_read_at': at, 'project': chat_channel.project},
    )
    if not created and row.last_read_at < at:
        row.last_read_at = at
        row.save(update_fields=['last_read_at'])
    Notification.objects.filter(
        recipient_user=user, kind=NotificationKind.PROJECT_MESSAGE_NEW, entity_type='chat_thread',
        entity_id=f'{chat_channel.id}:{channel}', read_at__isnull=True,
    ).update(read_at=timezone.now())
    # Also clear legacy project_thread rows for project channels.
    if chat_channel.project_id:
        Notification.objects.filter(
            recipient_user=user, kind=NotificationKind.PROJECT_MESSAGE_NEW, entity_type='project_thread',
            entity_id=f'{chat_channel.project_id}:{channel}', read_at__isnull=True,
        ).update(read_at=timezone.now())
    return row


def unread_for_channels(*, user, channels, sides_by_channel):
    """``{channel_id: {side: {'unread': n, 'mentions': n, 'last_at': dt}}}``."""
    channel_ids = [c.id for c in channels]
    reads = {(row.chat_channel_id, row.channel): row.last_read_at for row in ProjectMessageRead.objects.filter(user=user, chat_channel_id__in=channel_ids)}
    out = {cid: {} for cid in channel_ids}
    rows = ProjectMessage.objects.filter(chat_channel_id__in=channel_ids, deleted_at__isnull=True).values('chat_channel_id', 'channel').annotate(last=Max('created_at'))
    for row in rows:
        if row['channel'] in sides_by_channel.get(row['chat_channel_id'], ()):
            out[row['chat_channel_id']][row['channel']] = {'unread': 0, 'mentions': 0, 'last_at': row['last']}
    filters = Q()
    for channel_id, sides in sides_by_channel.items():
        for side in sides:
            since = reads.get((channel_id, side))
            clause = Q(chat_channel_id=channel_id, channel=side)
            if since:
                clause &= Q(created_at__gt=since)
            filters |= clause
    if filters:
        counted = ProjectMessage.objects.filter(filters, deleted_at__isnull=True).exclude(author_user=user).values('chat_channel_id', 'channel').annotate(n=Count('id'))
        for row in counted:
            out[row['chat_channel_id']].setdefault(row['channel'], {'unread': 0, 'mentions': 0, 'last_at': None})['unread'] = row['n']
        mention_filters = Q()
        for channel_id, sides in sides_by_channel.items():
            for side in sides:
                since = reads.get((channel_id, side))
                clause = Q(chat_channel_id=channel_id, side=side, user=user)
                if since:
                    clause &= Q(created_at__gt=since)
                mention_filters |= clause
        if mention_filters:
            mentioned = ProjectMessageMention.objects.filter(mention_filters).values('chat_channel_id', 'side').annotate(n=Count('id'))
            for row in mentioned:
                out[row['chat_channel_id']].setdefault(row['side'], {'unread': 0, 'mentions': 0, 'last_at': None})['mentions'] = row['n']
    return out


def unread_for(*, user, projects, channels_by_project):
    """Back-compat wrapper used by the project-scoped unread summary."""
    mapping = {}
    chat_channels = []
    sides = {}
    for project in projects:
        channel = ensure_project_channel(project)
        mapping[project.id] = channel
        chat_channels.append(channel)
        sides[channel.id] = channels_by_project.get(project.id, ())
    raw = unread_for_channels(user=user, channels=chat_channels, sides_by_channel=sides)
    return {project_id: raw.get(channel.id, {}) for project_id, channel in mapping.items()}


# ------------------------------------------------------------- notifications

def _followers(message):
    chat_channel = message.chat_channel
    can_read = readers(chat_channel=chat_channel, channel=message.channel)
    wanted = set()
    owner = WorkspaceMembership.objects.filter(
        workspace=chat_channel.workspace, is_primary_owner=True, status=WorkspaceMembershipStatus.ACTIVE,
    ).values_list('user_id', flat=True).first()
    if owner:
        wanted.add(owner)
    if chat_channel.project_id:
        wanted.add(chat_channel.project.created_by_user_id)
    wanted.update(ProjectMessage.objects.filter(
        chat_channel=chat_channel, channel=message.channel, author_user__isnull=False,
    ).values_list('author_user_id', flat=True).distinct())
    if message.channel == MessageChannel.CLIENT and not message.author_is_client:
        wanted.update(user_id for user_id, (_, is_client) in can_read.items() if is_client)
    return {user_id: can_read[user_id][0] for user_id in wanted if user_id in can_read}


def _payload(message, **extra):
    chat_channel = message.chat_channel
    project = chat_channel.project
    client = chat_channel.client_team
    return {
        'chat_channel_id': str(chat_channel.id),
        'project_id': str(project.id) if project else None,
        'project_name': project.name if project else (f'{client.name} · General' if client else 'Chat'),
        'client_team_id': str(client.id) if client else None,
        'client_team_name': client.name if client else None,
        'channel': message.channel, 'message_id': str(message.id),
        'actor_name': message.author_name, 'excerpt': message.body[:SNIPPET],
        **extra,
    }


def _link(message, *, for_client):
    chat_channel = message.chat_channel
    side = message.channel
    if for_client:
        return f'/portal/chat/{chat_channel.id}?side={side}'
    return f'/chat/{chat_channel.id}?side={side}'


def notify_message(*, message):
    sender = message.author_user
    workspace = message.workspace
    chat_channel = message.chat_channel
    can_read = readers(chat_channel=chat_channel, channel=message.channel)
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
        thread = f'{chat_channel.id}:{message.channel}'
        row = Notification.objects.filter(
            recipient_user=user, kind=NotificationKind.PROJECT_MESSAGE_NEW, entity_type='chat_thread', entity_id=thread,
        ).first()
        if row is None:
            Notification.objects.create(
                id=uuid.uuid4(), recipient_user=user, workspace=workspace, actor_user=sender, kind=NotificationKind.PROJECT_MESSAGE_NEW,
                entity_type='chat_thread', entity_id=thread, created_at=now,
                payload=_payload(message, message_count=1, link=_link(message, for_client=is_client)),
            )
            continue
        count = (row.payload or {}).get('message_count', 0) + 1 if row.read_at is None else 1
        row.payload = _payload(message, message_count=count, link=_link(message, for_client=is_client))
        row.actor_user = sender
        row.read_at = None
        row.created_at = now
        row.save(update_fields=['payload', 'actor_user', 'read_at', 'created_at'])


# ------------------------------------------------------------- sidebar / search

def channel_label(chat_channel):
    if chat_channel.project_id:
        return chat_channel.project.name
    if chat_channel.client_team_id:
        return 'General'
    return 'Chat'


def list_channels_for(*, user, workspace):
    """Grouped sidebar payload: client sections + Studio, with unread and mention counts."""
    ensure_workspace_channels(workspace)
    channels = list(ChatChannel.objects.filter(workspace=workspace).select_related('project', 'client_team').order_by('client_team__name', 'project__name'))
    accessible = []
    access_map = {}
    for channel in channels:
        access = channel_access(user=user, chat_channel=channel)
        if access:
            accessible.append(channel)
            access_map[channel.id] = access
    sides = {channel.id: access_map[channel.id]['channels'] for channel in accessible}
    counts = unread_for_channels(user=user, channels=accessible, sides_by_channel=sides)

    # Latest message preview per channel (any visible side).
    latest = {}
    if accessible:
        q = Q()
        for channel in accessible:
            q |= Q(chat_channel_id=channel.id, channel__in=sides[channel.id])
        for message in ProjectMessage.objects.filter(q, deleted_at__isnull=True).order_by('-created_at'):
            if message.chat_channel_id not in latest:
                latest[message.chat_channel_id] = message

    sections = {}
    studio = []
    for channel in accessible:
        per = counts.get(channel.id, {})
        sides_unread = {side: per.get(side, {}).get('unread', 0) for side in sides[channel.id]}
        sides_mentions = {side: per.get(side, {}).get('mentions', 0) for side in sides[channel.id]}
        message = latest.get(channel.id)
        row = {
            'id': str(channel.id),
            'kind': 'general' if channel.project_id is None else 'project',
            'name': channel_label(channel),
            'project_id': str(channel.project_id) if channel.project_id else None,
            'project_status': channel.project.status if channel.project_id else None,
            'client_team_id': str(channel.client_team_id) if channel.client_team_id else None,
            'client_team_name': channel.client_team.name if channel.client_team_id else None,
            'viewer_kind': access_map[channel.id]['kind'],
            'sides': sides[channel.id],
            'unread': sides_unread,
            'mentions': sides_mentions,
            'total_unread': sum(sides_unread.values()),
            'total_mentions': sum(sides_mentions.values()),
            'team_unread': sides_unread.get(MessageChannel.TEAM.value, 0),
            'last_message_at': channel.last_message_at,
            'latest': None if not message else {
                'author_name': message.author_name, 'channel': message.channel,
                'snippet': message.body[:120], 'created_at': message.created_at,
            },
            'is_past': bool(channel.project_id and channel.project.status in PAST_STATUSES),
        }
        if channel.client_team_id:
            key = channel.client_team_id
            sections.setdefault(key, {
                'id': str(channel.client_team_id), 'name': channel.client_team.name, 'channels': [], 'past': [],
            })
            (sections[key]['past'] if row['is_past'] else sections[key]['channels']).append(row)
        else:
            studio.append(row)

    def section_sort_key(section):
        times = [c['last_message_at'] for c in section['channels'] + section['past'] if c['last_message_at']]
        latest_at = max(times) if times else None
        return (latest_at is None, -(latest_at.timestamp() if latest_at else 0), section['name'].lower())

    ordered = sorted(sections.values(), key=section_sort_key)
    for section in ordered:
        section['channels'].sort(key=lambda c: (0 if c['kind'] == 'general' else 1, -(c['last_message_at'].timestamp() if c['last_message_at'] else 0), c['name'].lower()))
        section['past'].sort(key=lambda c: (-(c['last_message_at'].timestamp() if c['last_message_at'] else 0), c['name'].lower()))
        section['total_unread'] = sum(c['total_unread'] for c in section['channels'] + section['past'])
        section['total_mentions'] = sum(c['total_mentions'] for c in section['channels'] + section['past'])

    all_rows = [c for s in ordered for c in s['channels'] + s['past']] + studio
    return {
        'sections': ordered,
        'studio': sorted(studio, key=lambda c: (-(c['last_message_at'].timestamp() if c['last_message_at'] else 0), c['name'].lower())),
        'total_unread': sum(c['total_unread'] for c in all_rows),
        'total_mentions': sum(c['total_mentions'] for c in all_rows),
    }


def search_messages(*, user, workspace, query, client_team_id=None, project_id=None, from_client=None, has_attachment=False, mentions_me=False, limit=40):
    query = (query or '').strip()
    if len(query) < 2:
        raise MessageError('Type at least two characters to search.')
    ensure_workspace_channels(workspace)
    channels = []
    sides = {}
    for channel in ChatChannel.objects.filter(workspace=workspace).select_related('project', 'client_team'):
        access = channel_access(user=user, chat_channel=channel)
        if not access:
            continue
        if client_team_id and str(channel.client_team_id) != str(client_team_id):
            continue
        if project_id and str(channel.project_id) != str(project_id):
            continue
        channels.append(channel)
        sides[channel.id] = access['channels']
    if not channels:
        return {'query': query, 'results': []}
    q = Q()
    for channel in channels:
        q |= Q(chat_channel_id=channel.id, channel__in=sides[channel.id])
    rows = ProjectMessage.objects.filter(q, deleted_at__isnull=True, body__icontains=query).select_related('chat_channel', 'chat_channel__project', 'chat_channel__client_team').order_by('-created_at')
    if from_client is True:
        rows = rows.filter(author_is_client=True)
    elif from_client is False:
        rows = rows.filter(author_is_client=False)
    if has_attachment:
        rows = rows.filter(attachments__isnull=False).distinct()
    if mentions_me:
        rows = rows.filter(mention_rows__user=user)
    results = []
    for message in rows[:limit]:
        results.append({
            'message_id': str(message.id),
            'chat_channel_id': str(message.chat_channel_id),
            'channel': message.channel,
            'channel_name': channel_label(message.chat_channel),
            'client_team_name': message.chat_channel.client_team.name if message.chat_channel.client_team_id else None,
            'project_name': message.chat_channel.project.name if message.chat_channel.project_id else None,
            'author_name': message.author_name,
            'author_is_client': message.author_is_client,
            'snippet': message.body[:SNIPPET],
            'created_at': message.created_at,
            'team_only': message.channel == MessageChannel.TEAM,
        })
    return {'query': query, 'results': results}


# Back-compat wrappers used by the old project views / tests

def post_message_on_project(*, project, channel, user, access, **kwargs):
    return post_message(chat_channel=ensure_project_channel(project), channel=channel, user=user, access=access or thread_access(user=user, project=project), **kwargs)
