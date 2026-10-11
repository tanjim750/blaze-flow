"""Staff-only /api/platform/ endpoints plus the customer "Report a problem" endpoint.

Every endpoint here is gated by IsPlatformStaff (the access_platform_admin permission),
except the two /api/support/tickets/ routes, which any signed-in user may call. Every
staff mutation requires a ``reason`` and writes an AuditLog row with actor PLATFORM_STAFF.
"""
from datetime import timedelta

from django.db import transaction
from django.db.models import Max, Q, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from app.models import (
    AIReview, AIReviewStatus, AuditActorType, AuditLog, File, MediaVersion, OAuthIdentity,
    OutboxEvent, OutboxEventStatus, Project, SupportMessageKind, SupportTicket,
    SupportTicketCategory, SupportTicketStatus, User, UserSubscription, Workspace,
    WorkspaceMembership, WorkspaceMembershipStatus,
)
from app.services.operations import workspace_operations_report
from app.services.plan_config import get_plan_limit
from app.services.subscriptions import get_effective_subscription
from app.throttles import SupportTicketThrottle

from . import metrics
from .access import IsPlatformStaff, is_platform_staff, record_platform_audit, require_reason
from .support import add_staff_message, create_ticket

MAX_PAGE = 100


def _page(request, queryset, serialize):
    try:
        limit = min(max(int(request.query_params.get('limit', 25)), 1), MAX_PAGE)
        offset = max(int(request.query_params.get('offset', 0)), 0)
    except (TypeError, ValueError) as exc:
        raise ValidationError({'pagination': 'limit and offset must be integers.'}) from exc
    total = queryset.count()
    return Response({'results': [serialize(row) for row in queryset[offset:offset + limit]], 'total': total, 'limit': limit, 'offset': offset})


def _days(request, default=30):
    try:
        return min(max(int(request.query_params.get('days', default)), 1), 365)
    except (TypeError, ValueError):
        return default


def _user_ref(user):
    if user is None:
        return None
    return {'id': str(user.id), 'email': user.email, 'name': f'{user.first_name} {user.last_name}'.strip() or user.email}


def _subscription(user, now=None):
    now = now or timezone.now()
    sub = get_effective_subscription(user=user)
    trialing = bool(sub.trial_ends_at and sub.trial_ends_at > now and sub.status == 'ACTIVE')
    return {
        'plan': sub.plan, 'status': 'TRIALING' if trialing else sub.status,
        'trial_ends_at': sub.trial_ends_at, 'current_period_end': sub.current_period_end,
        'cancel_at_period_end': sub.cancel_at_period_end,
    }


def _owner(workspace):
    m = WorkspaceMembership.objects.filter(workspace=workspace, is_primary_owner=True).select_related('user').first()
    return m.user if m else None


def _audit_row(row):
    return {
        'id': str(row.id), 'created_at': row.created_at, 'actor_type': row.actor_type,
        'actor': _user_ref(row.actor_user), 'action': row.action, 'entity_type': row.entity_type,
        'entity_id': row.entity_id, 'workspace': {'id': str(row.workspace_id), 'name': row.workspace.name} if row.workspace_id else None,
        'reason': (row.metadata or {}).get('reason'), 'request_id': row.request_id,
    }


# --- Overview ------------------------------------------------------------------------------

@api_view(['GET'])
@permission_classes([IsPlatformStaff])
def platform_overview(request):
    return Response(metrics.overview(days=_days(request)))


# --- Workspaces ----------------------------------------------------------------------------

def _workspace_summary(ws):
    owner = _owner(ws)
    sub = _subscription(owner) if owner else None
    storage = File.objects.filter(workspace=ws, deleted_at__isnull=True).aggregate(t=Sum('size_bytes'))['t'] or 0
    plan = sub['plan'] if sub else 'FREE'
    return {
        'id': str(ws.id), 'name': ws.name, 'slug': ws.slug, 'status': ws.status, 'created_at': ws.created_at,
        'owner': _user_ref(owner), 'subscription': sub,
        'members': WorkspaceMembership.objects.filter(workspace=ws, status=WorkspaceMembershipStatus.ACTIVE, user__isnull=False).count(),
        'projects': Project.objects.filter(workspace=ws).count(),
        'storage_bytes': storage,
        'limits': {'projects': get_plan_limit(plan, 'max_projects_per_workspace'), 'storage_bytes': get_plan_limit(plan, 'max_storage_bytes')},
        'last_active_at': AuditLog.objects.filter(workspace=ws).aggregate(m=Max('created_at'))['m'],
        'is_demo': bool(owner and owner.email.endswith(metrics.DEMO_EMAIL_SUFFIX)),
    }


@api_view(['GET'])
@permission_classes([IsPlatformStaff])
def platform_workspaces(request):
    qs = Workspace.objects.order_by('-created_at')
    q = request.query_params.get('q', '').strip()
    if q:
        owner_ws = WorkspaceMembership.objects.filter(is_primary_owner=True, user__email__icontains=q).values('workspace_id')
        qs = qs.filter(Q(name__icontains=q) | Q(slug__icontains=q) | Q(id__in=owner_ws))
    if request.query_params.get('status'):
        qs = qs.filter(status=request.query_params['status'])
    return _page(request, qs, _workspace_summary)


@api_view(['GET'])
@permission_classes([IsPlatformStaff])
def platform_workspace_detail(request, workspace_id):
    ws = get_object_or_404(Workspace, id=workspace_id)
    data = _workspace_summary(ws)
    month = timezone.now() - timedelta(days=30)
    reviews = list(AIReview.objects.filter(workspace=ws, created_at__gte=month).values('status', 'usage'))
    data.update({
        'members_list': [
            {'id': str(m.id), 'user': _user_ref(m.user), 'role': m.role.name if m.role_id else None,
             'is_primary_owner': m.is_primary_owner, 'status': m.status, 'joined_at': m.joined_at}
            for m in WorkspaceMembership.objects.filter(workspace=ws, user__isnull=False).select_related('user', 'role').order_by('-is_primary_owner', 'joined_at')[:100]
        ],
        'health': workspace_operations_report(workspace=ws),
        'ai_qa_30d': {
            'runs': len(reviews), 'failed': sum(1 for r in reviews if r['status'] == AIReviewStatus.FAILED),
            'minutes': round(sum(metrics.media_minutes(r['usage']) for r in reviews), 1),
        },
        'recent_audit': [_audit_row(r) for r in AuditLog.objects.filter(workspace=ws).select_related('actor_user', 'workspace').order_by('-created_at')[:20]],
        'tickets': [_ticket_summary(t) for t in SupportTicket.objects.filter(workspace=ws).select_related('user', 'assignee', 'workspace')[:20]],
    })
    return Response(data)


# --- Users ---------------------------------------------------------------------------------

def _user_summary(user):
    return {
        **_user_ref(user), 'status': user.status, 'email_verified_at': user.email_verified_at,
        'created_at': user.created_at, 'last_login': user.last_login, 'subscription': _subscription(user),
        'is_platform_staff': is_platform_staff(user), 'is_demo': user.email.endswith(metrics.DEMO_EMAIL_SUFFIX),
    }


@api_view(['GET'])
@permission_classes([IsPlatformStaff])
def platform_users(request):
    qs = User.objects.order_by('-created_at')
    q = request.query_params.get('q', '').strip()
    if q:
        cond = Q(email__icontains=q) | Q(first_name__icontains=q) | Q(last_name__icontains=q)
        try:
            import uuid
            cond |= Q(id=uuid.UUID(q))
        except ValueError:
            pass
        qs = qs.filter(cond)
    return _page(request, qs, _user_summary)


@api_view(['GET'])
@permission_classes([IsPlatformStaff])
def platform_user_detail(request, user_id):
    user = get_object_or_404(User, id=user_id)
    data = _user_summary(user)
    data.update({
        'oauth_providers': sorted(set(OAuthIdentity.objects.filter(user=user).values_list('provider', flat=True))),
        'workspaces': [
            {'id': str(m.workspace_id), 'name': m.workspace.name, 'role': m.role.name if m.role_id else None,
             'is_primary_owner': m.is_primary_owner, 'status': m.status}
            for m in WorkspaceMembership.objects.filter(user=user).select_related('workspace', 'role')
        ],
        'subscription_history': [
            {'id': str(s.id), 'plan': s.plan, 'status': s.status, 'started_at': s.started_at,
             'current_period_end': s.current_period_end, 'cancelled_at': s.cancelled_at, 'trial_ends_at': s.trial_ends_at}
            for s in UserSubscription.objects.filter(user=user).order_by('-started_at')
        ],
        'tickets': [_ticket_summary(t) for t in SupportTicket.objects.filter(user=user).select_related('user', 'assignee', 'workspace')[:20]],
        'recent_audit': [_audit_row(r) for r in AuditLog.objects.filter(Q(actor_user=user) | Q(entity_type='user', entity_id=str(user.id))).select_related('actor_user', 'workspace').order_by('-created_at')[:20]],
    })
    return Response(data)


@api_view(['POST'])
@permission_classes([IsPlatformStaff])
def platform_user_action(request, user_id, action):
    from app.services.email_verification import request_email_verification
    from app.services.passwords import request_password_reset

    user = get_object_or_404(User, id=user_id)
    reason = require_reason(request.data)
    if action == 'resend-verification':
        if user.email_verified_at is not None:
            return Response({'detail': 'This email address is already verified.', 'code': 'already_verified'}, status=status.HTTP_409_CONFLICT)
        sent = request_email_verification(email=user.email)
        audit_action = 'platform.user.verification_resent'
    elif action == 'password-reset':
        sent = request_password_reset(email=user.email)
        audit_action = 'platform.user.password_reset_sent'
    else:
        return Response({'detail': 'Unknown action.'}, status=status.HTTP_404_NOT_FOUND)
    if sent is None:
        return Response({'detail': 'Nothing was sent: the account is not active.', 'code': 'not_sent'}, status=status.HTTP_409_CONFLICT)
    record_platform_audit(request=request, action=audit_action, entity_type='user', entity_id=user.id, reason=reason, metadata={'email': user.email})
    return Response({'ok': True, 'detail': f'Email sent to {user.email}.'})


# --- Jobs ----------------------------------------------------------------------------------

def _outbox_row(e):
    return {
        'kind': 'outbox', 'id': str(e.id), 'topic': e.topic, 'status': e.status, 'attempts': e.attempts,
        'aggregate': f'{e.aggregate_type}:{e.aggregate_id}', 'last_error': (e.last_error or '')[:1000],
        'payload': {k: (str(v)[:120] if not isinstance(v, (int, float, bool)) else v) for k, v in (e.payload or {}).items()},
        'created_at': e.created_at, 'updated_at': e.updated_at, 'workspace': None,
    }


def _ai_row(r, titles):
    return {
        'kind': 'ai_qa', 'id': str(r.id), 'topic': 'ai_visual_qa.run', 'status': r.status, 'attempts': r.attempts,
        'aggregate': titles.get(r.media_version_id, 'media version'),
        'last_error': f'{r.error_code}: {r.error_message}'.strip(': '),
        'payload': {'mode': r.mode, 'language': r.language, 'requested_by': r.requested_by.email if r.requested_by_id else None},
        'created_at': r.created_at, 'updated_at': r.updated_at,
        'workspace': {'id': str(r.workspace_id), 'name': r.workspace.name},
    }


@api_view(['GET'])
@permission_classes([IsPlatformStaff])
def platform_jobs(request):
    kind = request.query_params.get('kind', 'outbox')
    if kind == 'ai_qa':
        qs = AIReview.objects.filter(status=AIReviewStatus.FAILED).select_related('workspace', 'requested_by').order_by('-created_at')
        if request.query_params.get('workspace_id'):
            qs = qs.filter(workspace_id=request.query_params['workspace_id'])
        response = _page(request, qs, lambda r: r)
        rows = response.data['results']
        titles = dict(MediaVersion.objects.filter(id__in=[r.media_version_id for r in rows]).values_list('id', 'title'))
        response.data['results'] = [_ai_row(r, titles) for r in rows]
        return response
    wanted = request.query_params.get('status')
    statuses = [wanted] if wanted in (OutboxEventStatus.FAILED, OutboxEventStatus.DEAD_LETTER) else [OutboxEventStatus.FAILED, OutboxEventStatus.DEAD_LETTER]
    qs = OutboxEvent.objects.filter(status__in=statuses).order_by('-updated_at')
    if request.query_params.get('topic'):
        qs = qs.filter(topic__startswith=request.query_params['topic'])
    return _page(request, qs, _outbox_row)


class _RetryItem(serializers.Serializer):
    kind = serializers.ChoiceField(choices=['outbox', 'ai_qa'])
    id = serializers.UUIDField()


class _RetrySerializer(serializers.Serializer):
    items = _RetryItem(many=True, allow_empty=False, max_length=MAX_PAGE)
    reason = serializers.CharField(max_length=500)


def _retry_one(request, item, reason):
    from app.ai_qa.service import AIQAError, retry_review

    if item['kind'] == 'outbox':
        with transaction.atomic():
            event = OutboxEvent.objects.select_for_update().filter(id=item['id']).first()
            if event is None:
                return {'id': str(item['id']), 'ok': False, 'detail': 'Not found.'}
            if event.status not in (OutboxEventStatus.FAILED, OutboxEventStatus.DEAD_LETTER):
                return {'id': str(event.id), 'ok': False, 'detail': f'Not retryable ({event.status}).'}
            previous = event.status
            now = timezone.now()
            fields = {'status': OutboxEventStatus.PENDING, 'available_at': now, 'locked_at': None, 'updated_at': now}
            if previous == OutboxEventStatus.DEAD_LETTER:
                fields['attempts'] = 0  # same reset as requeue_dead_letters
            OutboxEvent.objects.filter(id=event.id).update(**fields)
            record_platform_audit(request=request, action='platform.job.retried', entity_type='outbox_event', entity_id=event.id,
                                  reason=reason, metadata={'topic': event.topic, 'previous_status': previous, 'attempts': event.attempts})
        return {'id': str(event.id), 'ok': True}
    review = AIReview.objects.filter(id=item['id']).select_related('workspace').first()
    if review is None:
        return {'id': str(item['id']), 'ok': False, 'detail': 'Not found.'}
    try:
        with transaction.atomic():
            retry_review(review=review, user=request.user)
            record_platform_audit(request=request, action='platform.ai_qa.retried', entity_type='ai_review', entity_id=review.id,
                                  reason=reason, workspace=review.workspace, metadata={'previous_status': review.status, 'error_code': review.error_code})
    except AIQAError as exc:
        return {'id': str(review.id), 'ok': False, 'detail': exc.message}
    return {'id': str(review.id), 'ok': True}


@api_view(['POST'])
@permission_classes([IsPlatformStaff])
def platform_jobs_retry(request):
    reason = require_reason(request.data)
    serializer = _RetrySerializer(data={**request.data, 'reason': reason})
    serializer.is_valid(raise_exception=True)
    results = [_retry_one(request, item, reason) for item in serializer.validated_data['items']]
    return Response({'results': results, 'retried': sum(1 for r in results if r['ok'])})


# --- Support -------------------------------------------------------------------------------

def _ticket_summary(t):
    return {
        'id': str(t.id), 'number': t.number, 'subject': t.subject, 'category': t.category, 'status': t.status,
        'user': _user_ref(t.user), 'assignee': _user_ref(t.assignee),
        'workspace': {'id': str(t.workspace_id), 'name': t.workspace.name} if t.workspace_id else None,
        'plan': (t.context or {}).get('plan'), 'is_demo': t.is_demo, 'created_at': t.created_at, 'updated_at': t.updated_at,
    }


def _ticket_detail(t, *, staff):
    messages = t.messages.select_related('author')
    if not staff:
        messages = messages.exclude(kind=SupportMessageKind.NOTE)
    data = _ticket_summary(t)
    data['messages'] = [
        {'id': str(m.id), 'kind': m.kind, 'author': _user_ref(m.author), 'body': m.body, 'created_at': m.created_at, 'email_sent_at': m.email_sent_at}
        for m in messages
    ]
    if staff:
        data['context'] = t.context
    return data


@api_view(['GET'])
@permission_classes([IsPlatformStaff])
def platform_tickets(request):
    qs = SupportTicket.objects.select_related('user', 'assignee', 'workspace')
    st = request.query_params.get('status')
    if st:
        qs = qs.filter(status=st)
    if request.query_params.get('assignee') == 'me':
        qs = qs.filter(assignee=request.user)
    q = request.query_params.get('q', '').strip()
    if q:
        cond = Q(subject__icontains=q) | Q(user__email__icontains=q)
        if q.lstrip('#').isdigit():
            cond |= Q(number=int(q.lstrip('#')))
        qs = qs.filter(cond)
    response = _page(request, qs, _ticket_summary)
    base = SupportTicket.objects.all()
    response.data['counts'] = {s: base.filter(status=s).count() for s in SupportTicketStatus.values}
    return response


class _TicketUpdateSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=SupportTicketStatus.choices, required=False)
    assignee = serializers.ChoiceField(choices=['me', 'none'], required=False)


@api_view(['GET', 'PATCH'])
@permission_classes([IsPlatformStaff])
def platform_ticket_detail(request, ticket_id):
    ticket = get_object_or_404(SupportTicket.objects.select_related('user', 'assignee', 'workspace'), id=ticket_id)
    if request.method == 'GET':
        return Response(_ticket_detail(ticket, staff=True))
    reason = require_reason(request.data)
    serializer = _TicketUpdateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    changes = {}
    if 'status' in serializer.validated_data and serializer.validated_data['status'] != ticket.status:
        changes['status'] = [ticket.status, serializer.validated_data['status']]
        ticket.status = serializer.validated_data['status']
    if 'assignee' in serializer.validated_data:
        new = request.user if serializer.validated_data['assignee'] == 'me' else None
        if (new.id if new else None) != ticket.assignee_id:
            changes['assignee'] = [ticket.assignee.email if ticket.assignee_id else None, new.email if new else None]
            ticket.assignee = new
    if changes:
        ticket.save(update_fields=['status', 'assignee', 'updated_at'])
        record_platform_audit(request=request, action='platform.ticket.updated', entity_type='support_ticket', entity_id=ticket.id,
                              reason=reason, workspace=ticket.workspace, metadata={'number': ticket.number, 'changes': changes})
    ticket.refresh_from_db()
    return Response(_ticket_detail(ticket, staff=True))


class _StaffMessageSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=[SupportMessageKind.REPLY, SupportMessageKind.NOTE])
    body = serializers.CharField(max_length=10000)


@api_view(['POST'])
@permission_classes([IsPlatformStaff])
def platform_ticket_messages(request, ticket_id):
    ticket = get_object_or_404(SupportTicket.objects.select_related('user', 'workspace'), id=ticket_id)
    reason = require_reason(request.data)
    serializer = _StaffMessageSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    kind = serializer.validated_data['kind']
    with transaction.atomic():
        message = add_staff_message(ticket=ticket, staff=request.user, kind=kind, body=serializer.validated_data['body'])
        record_platform_audit(
            request=request, action='platform.ticket.replied' if kind == SupportMessageKind.REPLY else 'platform.ticket.noted',
            entity_type='support_ticket', entity_id=ticket.id, reason=reason, workspace=ticket.workspace,
            metadata={'number': ticket.number, 'message_id': str(message.id), 'emailed_to': ticket.user.email if kind == SupportMessageKind.REPLY else None},
        )
    ticket = SupportTicket.objects.select_related('user', 'assignee', 'workspace').get(id=ticket.id)
    return Response(_ticket_detail(ticket, staff=True), status=status.HTTP_201_CREATED)


class _TicketCreateSerializer(serializers.Serializer):
    category = serializers.ChoiceField(choices=SupportTicketCategory.choices, default=SupportTicketCategory.BUG)
    subject = serializers.CharField(max_length=200)
    body = serializers.CharField(max_length=10000)
    workspace_id = serializers.UUIDField(required=False, allow_null=True)
    context = serializers.DictField(required=False)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
@throttle_classes([SupportTicketThrottle])
def support_tickets(request):
    if request.method == 'GET':
        tickets = SupportTicket.objects.filter(user=request.user).select_related('user', 'assignee', 'workspace')[:50]
        return Response([_ticket_detail(t, staff=False) for t in tickets])
    serializer = _TicketCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    workspace = None
    if data.get('workspace_id'):
        # Only attach a workspace the reporter actually belongs to.
        membership = WorkspaceMembership.objects.filter(workspace_id=data['workspace_id'], user=request.user).select_related('workspace').first()
        workspace = membership.workspace if membership else None
    ticket = create_ticket(
        user=request.user, workspace=workspace, category=data['category'], subject=data['subject'],
        body=data['body'], context=data.get('context'), request_id=getattr(request, 'request_id', None),
    )
    return Response({'id': str(ticket.id), 'number': ticket.number, 'status': ticket.status}, status=status.HTTP_201_CREATED)


# --- Audit ---------------------------------------------------------------------------------

@api_view(['GET'])
@permission_classes([IsPlatformStaff])
def platform_audit(request):
    qs = AuditLog.objects.select_related('actor_user', 'workspace').order_by('-created_at')
    qs = qs.filter(created_at__gte=timezone.now() - timedelta(days=_days(request, 30)))
    p = request.query_params
    if p.get('actor_type') in AuditActorType.values:
        qs = qs.filter(actor_type=p['actor_type'])
    if p.get('workspace_id'):
        qs = qs.filter(workspace_id=p['workspace_id'])
    if p.get('action'):
        qs = qs.filter(action__icontains=p['action'])
    if p.get('actor'):
        qs = qs.filter(actor_user__email__icontains=p['actor'])
    return _page(request, qs, _audit_row)
