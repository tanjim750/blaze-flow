"""Chat and project-message routes. Access decisions live in ``services.messages.channel_access``."""
from django.core.files.storage import default_storage
from django.db.models import Q
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import serializers, status
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .http_range import is_initial_request, ranged_file_response
from .models import ChatChannel, FileStatus, Project, ProjectMessage, ProjectMessageAttachment, Workspace
from .permissions import PROJECT_READ, accessible_projects, active_memberships_for_user
from .services.audit import record_user_audit
from .services.messages import (
    CHANNELS, MessageError, attachment_data, channel_access, channel_label, delete_message, edit_message,
    ensure_project_channel, list_channels_for, mark_read, mentionable, message_data, post_message, require_channel,
    search_messages, store_upload, thread_access, thread_queryset, unread_for,
)
from .services.subscriptions import SubscriptionError

PAGE = 50


def _error(exc):
    return Response({'detail': str(exc)}, status=getattr(exc, 'status', 400))


def _workspace(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    if not active_memberships_for_user(user=request.user, workspace=workspace).exists():
        raise PermissionDenied('You are not a member of this workspace.')
    return workspace


def _chat(request, workspace_id, channel_id):
    workspace = _workspace(request, workspace_id)
    chat_channel = get_object_or_404(ChatChannel.objects.select_related('project', 'client_team', 'workspace'), id=channel_id, workspace=workspace)
    access = channel_access(user=request.user, chat_channel=chat_channel)
    if access is None:
        raise Http404('Channel not found.')
    return chat_channel, access


def _project(request, workspace_id, project_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    project = get_object_or_404(Project.objects.select_related('workspace'), id=project_id, workspace=workspace)
    access = thread_access(user=request.user, project=project)
    if access is None:
        raise Http404('Project not found.')
    return project, access, ensure_project_channel(project)


def _side(request, access, *, data=None):
    channel = (data or request.query_params).get('channel') or (data or request.query_params).get('side') or 'client'
    try:
        require_channel(access, channel)
    except MessageError as exc:
        raise Http404(str(exc)) from exc
    return channel


class PostSerializer(serializers.Serializer):
    channel = serializers.ChoiceField(choices=[value for value in CHANNELS], required=False)
    side = serializers.ChoiceField(choices=[value for value in CHANNELS], required=False)
    body = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False, max_length=10000)
    reply_to_id = serializers.UUIDField(required=False, allow_null=True)
    mention_user_ids = serializers.ListField(child=serializers.UUIDField(), required=False, max_length=50)
    attachment_ids = serializers.ListField(child=serializers.UUIDField(), required=False, max_length=20)
    project_file_ids = serializers.ListField(child=serializers.UUIDField(), required=False, max_length=20)
    media_version_ids = serializers.ListField(child=serializers.UUIDField(), required=False, max_length=20)

    def validated_side(self):
        data = self.validated_data
        return data.get('channel') or data.get('side') or 'client'


class EditSerializer(serializers.Serializer):
    body = serializers.CharField(allow_blank=True, trim_whitespace=False, max_length=10000)


def _thread(request, chat_channel, access, channel):
    queryset = thread_queryset(chat_channel, channel)
    after = parse_datetime(request.query_params.get('after') or '')
    before = parse_datetime(request.query_params.get('before') or '')
    if after:
        rows = list(queryset.filter(created_at__gt=after).order_by('created_at')[:200])
        changed = list(queryset.filter(Q(edited_at__gt=after) | Q(deleted_at__gt=after), created_at__lte=after).order_by('created_at'))
        has_more = False
    else:
        if before:
            queryset = queryset.filter(created_at__lt=before)
        newest = list(queryset.order_by('-created_at')[:PAGE + 1])
        has_more = len(newest) > PAGE
        rows = list(reversed(newest[:PAGE]))
        changed = []
    from .services.messages import unread_for_channels
    unread = unread_for_channels(
        user=request.user, channels=[chat_channel], sides_by_channel={chat_channel.id: access['channels']},
    )[chat_channel.id]
    return {
        'chat_channel': {
            'id': str(chat_channel.id), 'kind': 'general' if chat_channel.project_id is None else 'project',
            'name': channel_label(chat_channel),
            'project_id': str(chat_channel.project_id) if chat_channel.project_id else None,
            'client_team_id': str(chat_channel.client_team_id) if chat_channel.client_team_id else None,
            'client_team_name': chat_channel.client_team.name if chat_channel.client_team_id else None,
        },
        'project': {'id': str(chat_channel.project_id), 'name': chat_channel.project.name} if chat_channel.project_id else None,
        'channel': channel,
        'viewer': {key: access[key] for key in ('kind', 'channels', 'can_post', 'can_link_files', 'can_link_cuts', 'has_client')},
        'messages': [message_data(row, user=request.user, access=access) for row in rows],
        'changed': [message_data(row, user=request.user, access=access) for row in changed],
        'has_more': has_more,
        'unread': {key: unread.get(key, {}).get('unread', 0) for key in access['channels']},
        'mentions': {key: unread.get(key, {}).get('mentions', 0) for key in access['channels']},
        'mentionable': mentionable(chat_channel=chat_channel, channel=channel),
        'server_time': timezone.now(),
    }


# ---------------------------------------------------------------- chat routes

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def chat_channel_list(request, workspace_id):
    workspace = _workspace(request, workspace_id)
    return Response(list_channels_for(user=request.user, workspace=workspace))


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def chat_search(request, workspace_id):
    workspace = _workspace(request, workspace_id)
    try:
        data = search_messages(
            user=request.user, workspace=workspace, query=request.query_params.get('q', ''),
            client_team_id=request.query_params.get('client_team'),
            project_id=request.query_params.get('project'),
            from_client={'1': True, 'true': True, '0': False, 'false': False}.get((request.query_params.get('from_client') or '').lower()),
            has_attachment=(request.query_params.get('has_attachment') or '').lower() in ('1', 'true'),
            mentions_me=(request.query_params.get('mentions_me') or '').lower() in ('1', 'true'),
        )
    except MessageError as exc:
        return _error(exc)
    return Response(data)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def chat_channel_messages(request, workspace_id, channel_id):
    chat_channel, access = _chat(request, workspace_id, channel_id)
    if request.method == 'GET':
        return Response(_thread(request, chat_channel, access, _side(request, access)))
    serializer = PostSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    side = serializer.validated_side()
    _side(request, access, data={'channel': side})
    try:
        message = post_message(
            chat_channel=chat_channel, channel=side, user=request.user, access=access, body=data.get('body', ''),
            reply_to_id=data.get('reply_to_id'), mention_ids=data.get('mention_user_ids'),
            upload_ids=data.get('attachment_ids') or (), file_ids=data.get('project_file_ids') or (),
            cut_ids=data.get('media_version_ids') or (),
        )
    except MessageError as exc:
        return _error(exc)
    message = thread_queryset(chat_channel, message.channel).get(id=message.id)
    return Response(message_data(message, user=request.user, access=access), status=status.HTTP_201_CREATED)


def _message_on_channel(request, chat_channel, access, message_id):
    message = get_object_or_404(ProjectMessage.objects.select_related('reply_to', 'chat_channel'), id=message_id, chat_channel=chat_channel)
    if message.channel not in access['channels']:
        raise Http404('Message not found.')
    return message


@api_view(['PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def chat_channel_message_detail(request, workspace_id, channel_id, message_id):
    chat_channel, access = _chat(request, workspace_id, channel_id)
    message = _message_on_channel(request, chat_channel, access, message_id)
    try:
        if request.method == 'DELETE':
            delete_message(message=message, user=request.user, access=access)
            return Response(status=status.HTTP_204_NO_CONTENT)
        serializer = EditSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        edit_message(message=message, user=request.user, access=access, body=serializer.validated_data['body'])
    except MessageError as exc:
        return _error(exc)
    message = thread_queryset(chat_channel, message.channel).get(id=message.id)
    return Response(message_data(message, user=request.user, access=access))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def chat_channel_uploads(request, workspace_id, channel_id):
    chat_channel, access = _chat(request, workspace_id, channel_id)
    if not access['can_post']:
        raise PermissionDenied('Your role can read messages but not post them.')
    upload = request.FILES.get('file')
    if upload is None:
        return Response({'detail': 'Choose a file to attach.'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        item = store_upload(chat_channel=chat_channel, user=request.user, upload=upload)
    except (MessageError, SubscriptionError) as exc:
        return _error(exc)
    return Response(attachment_data(item, base=_api_base_path(chat_channel), access=access), status=status.HTTP_201_CREATED)


def _api_base_path(chat_channel):
    return f'/api/workspaces/{chat_channel.workspace_id}/chat/channels/{chat_channel.id}'


@api_view(['GET', 'HEAD'])
@permission_classes([IsAuthenticated])
def chat_channel_attachment(request, workspace_id, channel_id, message_id, attachment_id):
    chat_channel, access = _chat(request, workspace_id, channel_id)
    message = _message_on_channel(request, chat_channel, access, message_id)
    if message.deleted_at:
        raise Http404('Message not found.')
    item = get_object_or_404(ProjectMessageAttachment.objects.select_related('file', 'project_file__file'), id=attachment_id, message=message)
    if item.kind == 'upload':
        record = item.file
    elif item.kind == 'file' and item.project_file and item.project_file.deleted_at is None:
        record = item.project_file.file
    else:
        raise Http404('Attachment not found.')
    if record.status != FileStatus.READY:
        return Response({'detail': 'This attachment is still being scanned or was rejected.'}, status=status.HTTP_409_CONFLICT)
    if not default_storage.exists(record.object_key):
        raise Http404('The stored attachment was not found.')
    if is_initial_request(request):
        record_user_audit(
            user=request.user, workspace=chat_channel.workspace, action='project.message.attachment_downloaded',
            entity_type='project_message', entity_id=message.id, project=chat_channel.project, team_only=message.channel == 'team',
        )
    return ranged_file_response(
        request, record.object_key, as_attachment=True, filename=record.original_name,
        content_type=record.mime_type, checksum=record.checksum,
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def chat_channel_read(request, workspace_id, channel_id):
    chat_channel, access = _chat(request, workspace_id, channel_id)
    side = _side(request, access, data=request.data)
    row = mark_read(user=request.user, chat_channel=chat_channel, channel=side)
    return Response({'channel': side, 'last_read_at': row.last_read_at})


# ---------------------------------------------------------- project aliases

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def project_messages(request, workspace_id, project_id):
    project, access, chat_channel = _project(request, workspace_id, project_id)
    if request.method == 'GET':
        data = _thread(request, chat_channel, access, _side(request, access))
        # Keep the shape the original tests / UI expected.
        data['project'] = {'id': str(project.id), 'name': project.name}
        return Response(data)
    serializer = PostSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    side = serializer.validated_side()
    _side(request, access, data={'channel': side})
    try:
        message = post_message(
            chat_channel=chat_channel, channel=side, user=request.user, access=access, body=data.get('body', ''),
            reply_to_id=data.get('reply_to_id'), mention_ids=data.get('mention_user_ids'),
            upload_ids=data.get('attachment_ids') or (), file_ids=data.get('project_file_ids') or (),
            cut_ids=data.get('media_version_ids') or (),
        )
    except MessageError as exc:
        return _error(exc)
    message = thread_queryset(chat_channel, message.channel).get(id=message.id)
    return Response(message_data(message, user=request.user, access=access), status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def project_message_detail(request, workspace_id, project_id, message_id):
    project, access, chat_channel = _project(request, workspace_id, project_id)
    message = _message_on_channel(request, chat_channel, access, message_id)
    try:
        if request.method == 'DELETE':
            delete_message(message=message, user=request.user, access=access)
            return Response(status=status.HTTP_204_NO_CONTENT)
        serializer = EditSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        edit_message(message=message, user=request.user, access=access, body=serializer.validated_data['body'])
    except MessageError as exc:
        return _error(exc)
    message = thread_queryset(chat_channel, message.channel).get(id=message.id)
    return Response(message_data(message, user=request.user, access=access))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def project_message_uploads(request, workspace_id, project_id):
    project, access, chat_channel = _project(request, workspace_id, project_id)
    if not access['can_post']:
        raise PermissionDenied('Your role can read messages but not post them.')
    upload = request.FILES.get('file')
    if upload is None:
        return Response({'detail': 'Choose a file to attach.'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        item = store_upload(chat_channel=chat_channel, user=request.user, upload=upload, project=project)
    except (MessageError, SubscriptionError) as exc:
        return _error(exc)
    # Keep the old href shape so existing UI keeps working until it switches to /chat.
    base = f'/api/workspaces/{project.workspace_id}/projects/{project.id}'
    data = attachment_data(item, base=base, access=access)
    return Response(data, status=status.HTTP_201_CREATED)


@api_view(['GET', 'HEAD'])
@permission_classes([IsAuthenticated])
def project_message_attachment(request, workspace_id, project_id, message_id, attachment_id):
    project, access, chat_channel = _project(request, workspace_id, project_id)
    message = _message_on_channel(request, chat_channel, access, message_id)
    if message.deleted_at:
        raise Http404('Message not found.')
    item = get_object_or_404(ProjectMessageAttachment.objects.select_related('file', 'project_file__file'), id=attachment_id, message=message)
    if item.kind == 'upload':
        record = item.file
    elif item.kind == 'file' and item.project_file and item.project_file.deleted_at is None:
        record = item.project_file.file
    else:
        raise Http404('Attachment not found.')
    if record.status != FileStatus.READY:
        return Response({'detail': 'This attachment is still being scanned or was rejected.'}, status=status.HTTP_409_CONFLICT)
    if not default_storage.exists(record.object_key):
        raise Http404('The stored attachment was not found.')
    if is_initial_request(request):
        record_user_audit(
            user=request.user, workspace=project.workspace, action='project.message.attachment_downloaded',
            entity_type='project_message', entity_id=message.id, project=project, team_only=message.channel == 'team',
        )
    return ranged_file_response(
        request, record.object_key, as_attachment=True, filename=record.original_name,
        content_type=record.mime_type, checksum=record.checksum,
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def project_messages_read(request, workspace_id, project_id):
    project, access, chat_channel = _project(request, workspace_id, project_id)
    side = _side(request, access, data=request.data)
    row = mark_read(user=request.user, chat_channel=chat_channel, channel=side)
    return Response({'channel': side, 'last_read_at': row.last_read_at})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def workspace_message_unread(request, workspace_id):
    """Unread counts for every project this person can read (legacy nav badge / inbox)."""
    workspace = _workspace(request, workspace_id)
    # Prefer the new grouped payload; also keep a projects[] list for older UI.
    grouped = list_channels_for(user=request.user, workspace=workspace)
    projects = []
    for section in grouped['sections']:
        for row in section['channels'] + section['past']:
            if row['kind'] != 'project':
                continue
            projects.append({
                'project_id': row['project_id'], 'project_name': row['name'],
                'client_name': row['client_team_name'], 'unread': row['unread'],
                'total_unread': row['total_unread'], 'last_message_at': row['last_message_at'],
                'latest': row['latest'], 'viewer_kind': row['viewer_kind'],
                'chat_channel_id': row['id'], 'mentions': row['mentions'],
            })
    for row in grouped['studio']:
        projects.append({
            'project_id': row['project_id'], 'project_name': row['name'], 'client_name': None,
            'unread': row['unread'], 'total_unread': row['total_unread'],
            'last_message_at': row['last_message_at'], 'latest': row['latest'],
            'viewer_kind': row['viewer_kind'], 'chat_channel_id': row['id'], 'mentions': row['mentions'],
        })
    projects.sort(key=lambda row: (row['last_message_at'] is None, -(row['last_message_at'].timestamp() if row['last_message_at'] else 0), row['project_name'].lower()))
    return Response({
        'total_unread': grouped['total_unread'], 'total_mentions': grouped['total_mentions'],
        'projects': projects, 'sections': grouped['sections'], 'studio': grouped['studio'],
    })
