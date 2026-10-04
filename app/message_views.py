"""Project message routes. All access decisions live in ``services.messages.thread_access``."""
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
from .models import FileStatus, Project, ProjectMessage, ProjectMessageAttachment, Workspace
from .permissions import PROJECT_READ, accessible_projects, active_memberships_for_user
from .services.audit import record_user_audit
from .services.messages import (
    CHANNELS, MessageError, attachment_data, delete_message, edit_message, mark_read, mentionable, message_data,
    post_message, require_channel, store_upload, thread_access, thread_queryset, unread_for,
)
from .services.subscriptions import SubscriptionError

PAGE = 50


def _error(exc):
    return Response({'detail': str(exc)}, status=getattr(exc, 'status', 400))


def _project(request, workspace_id, project_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    project = get_object_or_404(Project.objects.select_related('workspace'), id=project_id, workspace=workspace)
    access = thread_access(user=request.user, project=project)
    if access is None:
        raise Http404('Project not found.')
    return project, access


def _channel(request, access, *, data=None):
    channel = (data or request.query_params).get('channel') or 'client'
    try:
        require_channel(access, channel)
    except MessageError as exc:
        raise Http404(str(exc)) from exc
    return channel


class PostSerializer(serializers.Serializer):
    channel = serializers.ChoiceField(choices=[value for value in CHANNELS])
    body = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False, max_length=10000)
    reply_to_id = serializers.UUIDField(required=False, allow_null=True)
    mention_user_ids = serializers.ListField(child=serializers.UUIDField(), required=False, max_length=50)
    attachment_ids = serializers.ListField(child=serializers.UUIDField(), required=False, max_length=20)
    project_file_ids = serializers.ListField(child=serializers.UUIDField(), required=False, max_length=20)
    media_version_ids = serializers.ListField(child=serializers.UUIDField(), required=False, max_length=20)


class EditSerializer(serializers.Serializer):
    body = serializers.CharField(allow_blank=True, trim_whitespace=False, max_length=10000)


def _thread(request, project, access, channel):
    queryset = thread_queryset(project, channel)
    after = parse_datetime(request.query_params.get('after') or '')
    before = parse_datetime(request.query_params.get('before') or '')
    if after:
        # Polling: anything new, plus anything edited or deleted since the last look.
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
    unread = unread_for(user=request.user, projects=[project], channels_by_project={project.id: access['channels']})[project.id]
    return {
        'project': {'id': str(project.id), 'name': project.name},
        'channel': channel,
        'viewer': {key: access[key] for key in ('kind', 'channels', 'can_post', 'can_link_files', 'can_link_cuts', 'has_client')},
        'messages': [message_data(row, user=request.user, access=access) for row in rows],
        'changed': [message_data(row, user=request.user, access=access) for row in changed],
        'has_more': has_more,
        'unread': {key: unread.get(key, {}).get('unread', 0) for key in access['channels']},
        'mentionable': mentionable(project=project, channel=channel),
        'server_time': timezone.now(),
    }


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def project_messages(request, workspace_id, project_id):
    project, access = _project(request, workspace_id, project_id)
    if request.method == 'GET':
        return Response(_thread(request, project, access, _channel(request, access)))
    serializer = PostSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    _channel(request, access, data=data)
    try:
        message = post_message(
            project=project, channel=data['channel'], user=request.user, access=access, body=data.get('body', ''),
            reply_to_id=data.get('reply_to_id'), mention_ids=data.get('mention_user_ids'),
            upload_ids=data.get('attachment_ids') or (), file_ids=data.get('project_file_ids') or (),
            cut_ids=data.get('media_version_ids') or (),
        )
    except MessageError as exc:
        return _error(exc)
    message = thread_queryset(project, message.channel).get(id=message.id)
    return Response(message_data(message, user=request.user, access=access), status=status.HTTP_201_CREATED)


def _message(request, project, access, message_id):
    message = get_object_or_404(ProjectMessage.objects.select_related('reply_to'), id=message_id, project=project)
    if message.channel not in access['channels']:
        raise Http404('Message not found.')
    return message


@api_view(['PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def project_message_detail(request, workspace_id, project_id, message_id):
    project, access = _project(request, workspace_id, project_id)
    message = _message(request, project, access, message_id)
    try:
        if request.method == 'DELETE':
            delete_message(message=message, user=request.user, access=access)
            return Response(status=status.HTTP_204_NO_CONTENT)
        serializer = EditSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        edit_message(message=message, user=request.user, access=access, body=serializer.validated_data['body'])
    except MessageError as exc:
        return _error(exc)
    message = thread_queryset(project, message.channel).get(id=message.id)
    return Response(message_data(message, user=request.user, access=access))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def project_message_uploads(request, workspace_id, project_id):
    project, access = _project(request, workspace_id, project_id)
    if not access['can_post']:
        raise PermissionDenied('Your role can read messages but not post them.')
    upload = request.FILES.get('file')
    if upload is None:
        return Response({'detail': 'Choose a file to attach.'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        item = store_upload(project=project, user=request.user, upload=upload)
    except (MessageError, SubscriptionError) as exc:
        return _error(exc)
    base = f'/api/workspaces/{project.workspace_id}/projects/{project.id}'
    return Response(attachment_data(item, base=base, access=access), status=status.HTTP_201_CREATED)


@api_view(['GET', 'HEAD'])
@permission_classes([IsAuthenticated])
def project_message_attachment(request, workspace_id, project_id, message_id, attachment_id):
    project, access = _project(request, workspace_id, project_id)
    message = _message(request, project, access, message_id)
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
    project, access = _project(request, workspace_id, project_id)
    channel = _channel(request, access, data=request.data)
    row = mark_read(user=request.user, project=project, channel=channel)
    return Response({'channel': channel, 'last_read_at': row.last_read_at})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def workspace_message_unread(request, workspace_id):
    """Unread counts for every project this person can read, for the nav badge and inbox."""
    workspace = get_object_or_404(Workspace, id=workspace_id)
    if not active_memberships_for_user(user=request.user, workspace=workspace).exists():
        raise PermissionDenied('You are not a member of this workspace.')
    projects = list(accessible_projects(user=request.user, workspace=workspace, permission_key=PROJECT_READ).select_related('workspace', 'client_team').order_by('name'))
    channels = {}
    viewers = {}
    for project in projects:
        access = thread_access(user=request.user, project=project)
        if access:
            channels[project.id] = access['channels']
            viewers[project.id] = access
    projects = [project for project in projects if project.id in channels]
    counts = unread_for(user=request.user, projects=projects, channels_by_project=channels)
    rows = []
    for project in projects:
        per = counts[project.id]
        last = max((value['last_at'] for value in per.values() if value.get('last_at')), default=None)
        latest = None
        if last:
            message = ProjectMessage.objects.filter(project=project, channel__in=channels[project.id], deleted_at__isnull=True).order_by('-created_at').first()
            if message:
                latest = {'author_name': message.author_name, 'channel': message.channel, 'snippet': message.body[:120], 'created_at': message.created_at}
        rows.append({
            'project_id': str(project.id), 'project_name': project.name,
            'client_name': project.client_team.name if project.client_team_id else None,
            'unread': {key: per.get(key, {}).get('unread', 0) for key in channels[project.id]},
            'total_unread': sum(per.get(key, {}).get('unread', 0) for key in channels[project.id]),
            'last_message_at': last, 'latest': latest,
            'viewer_kind': viewers[project.id]['kind'],
        })
    rows.sort(key=lambda row: (row['last_message_at'] is None, -(row['last_message_at'].timestamp() if row['last_message_at'] else 0), row['project_name'].lower()))
    return Response({'total_unread': sum(row['total_unread'] for row in rows), 'projects': rows})
