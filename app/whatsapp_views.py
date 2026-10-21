"""WhatsApp approval messages: workspace switch, client numbers + consent, delivery log, webhook."""
import json
import logging

from django.conf import settings
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import (
    ClientTeam, ClientTeamMember, ClientTeamMemberStatus, NotificationDelivery, NotificationDeliveryChannel,
    WhatsAppContact, WhatsAppOptInMethod, Workspace,
)
from .permissions import CLIENT_TEAM_MANAGE, CLIENT_TEAM_READ, REVIEW_COMMENT_MANAGE, WORKSPACE_MANAGE, WORKSPACE_READ, has_workspace_permission
from .services.approval_requests import (
    OPT_IN_WORDING, contact_data, delivery_data, process_webhook, set_member_contact, whatsapp_usage,
    workspace_whatsapp_setting,
)
from .services.whatsapp import valid_webhook_signature

logger = logging.getLogger(__name__)


def _require(request, workspace, key):
    if not has_workspace_permission(user=request.user, workspace=workspace, permission_key=key):
        raise PermissionDenied('You do not have permission to perform this action.')


def _settings_data(workspace):
    setting = workspace_whatsapp_setting(workspace)
    return {
        'enabled': setting.enabled, 'link_expiry_hours': setting.link_expiry_hours,
        'test_mode': settings.WHATSAPP_PROVIDER == 'log', 'provider': settings.WHATSAPP_PROVIDER,
        'usage': whatsapp_usage(workspace),
        'opt_in_wording': OPT_IN_WORDING.format(workspace=workspace.name),
    }


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated])
def workspace_whatsapp_settings(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    _require(request, workspace, WORKSPACE_READ if request.method == 'GET' else WORKSPACE_MANAGE)
    if request.method == 'PATCH':
        setting = workspace_whatsapp_setting(workspace)
        data = request.data
        if 'enabled' in data:
            if not isinstance(data['enabled'], bool):
                return Response({'enabled': ['Send true or false.']}, status=400)
            setting.enabled = data['enabled']
        if 'link_expiry_hours' in data:
            try:
                hours = int(data['link_expiry_hours'])
            except (TypeError, ValueError):
                hours = 0
            if not 1 <= hours <= 24 * 30:
                return Response({'link_expiry_hours': ['Choose between 1 hour and 30 days.']}, status=400)
            setting.link_expiry_hours = hours
        setting.save()
    return Response(_settings_data(workspace))


def _parse_contact(data):
    phone = data.get('phone') or ''
    opted_in = data.get('opted_in', False)
    if not isinstance(opted_in, bool) or not isinstance(phone, str):
        return None, None, Response({'detail': 'Send phone as text and opted_in as true or false.'}, status=400)
    return phone, opted_in, None


@api_view(['GET', 'PUT'])
@permission_classes([IsAuthenticated])
def client_team_member_whatsapp(request, workspace_id, client_team_id, member_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    team = get_object_or_404(ClientTeam, id=client_team_id, workspace=workspace)
    member = get_object_or_404(ClientTeamMember.objects.select_related('client_team__workspace'), id=member_id, client_team=team)
    if request.method == 'GET':
        _require(request, workspace, CLIENT_TEAM_READ)
        return Response(contact_data(WhatsAppContact.objects.filter(client_team_member=member).first()))
    _require(request, workspace, CLIENT_TEAM_MANAGE)
    phone, opted_in, error = _parse_contact(request.data)
    if error:
        return error
    if opted_in and request.data.get('consent_confirmed') is not True:
        return Response({'consent_confirmed': ['Confirm the client agreed to get WhatsApp messages.']}, status=400)
    try:
        contact = set_member_contact(member=member, phone=phone, opted_in=opted_in, recorded_by=request.user)
    except ValueError as exc:
        return Response({'phone': [str(exc)]}, status=400)
    return Response(contact_data(contact))


@api_view(['GET', 'PUT'])
@permission_classes([IsAuthenticated])
def my_client_whatsapp(request, workspace_id):
    """A client person managing their own number and consent, from the portal."""
    workspace = get_object_or_404(Workspace, id=workspace_id)
    member = ClientTeamMember.objects.select_related('client_team__workspace').filter(
        user=request.user, client_team__workspace=workspace, status=ClientTeamMemberStatus.ACTIVE,
    ).order_by('joined_at').first()
    if member is None:
        return Response({'detail': 'Only client contacts have WhatsApp settings here.'}, status=404)
    if request.method == 'GET':
        return Response({**contact_data(WhatsAppContact.objects.filter(client_team_member=member).first()),
                         'opt_in_wording': OPT_IN_WORDING.format(workspace=workspace.name)})
    phone, opted_in, error = _parse_contact(request.data)
    if error:
        return error
    try:
        contact = set_member_contact(member=member, phone=phone, opted_in=opted_in, recorded_by=request.user, method=WhatsAppOptInMethod.CLIENT_SELF)
    except ValueError as exc:
        return Response({'phone': [str(exc)]}, status=400)
    return Response(contact_data(contact))


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def notification_deliveries(request, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    _require(request, workspace, REVIEW_COMMENT_MANAGE)
    rows = NotificationDelivery.objects.filter(notification__workspace=workspace).select_related(
        'notification__recipient_user',
    ).order_by('-created_at')
    channel = request.query_params.get('channel')
    if channel:
        if channel not in NotificationDeliveryChannel.values:
            return Response({'channel': ['Unknown channel.']}, status=400)
        rows = rows.filter(channel=channel)
    return Response({'results': [delivery_data(row) for row in rows[:200]]})


@csrf_exempt
def whatsapp_webhook(request):
    """Meta calls GET once to verify the URL, then POSTs statuses and incoming messages."""
    if request.method == 'GET':
        token = settings.WHATSAPP_WEBHOOK_VERIFY_TOKEN
        if token and request.GET.get('hub.mode') == 'subscribe' and request.GET.get('hub.verify_token') == token:
            return HttpResponse(request.GET.get('hub.challenge', ''), content_type='text/plain')
        return HttpResponse(status=403)
    if request.method != 'POST':
        return HttpResponse(status=405)
    if not valid_webhook_signature(body=request.body, signature=request.headers.get('X-Hub-Signature-256')):
        return HttpResponse(status=401)
    try:
        payload = json.loads(request.body or b'{}')
    except ValueError:
        return HttpResponse(status=400)
    result = process_webhook(payload)
    logger.info('WhatsApp webhook processed: %s', result)
    return HttpResponse(status=200)
