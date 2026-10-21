"""Tell a client a cut is waiting for their approval: in-app, email and (opted-in) WhatsApp.

Flow: a cut enters the client review stage -> ``request_client_approval`` writes one in-app
notification per active client contact and queues one outbox event per channel. The outbox
worker calls ``deliver_approval_email`` / ``deliver_approval_whatsapp``; a raised error is
retried with backoff and dead-lettered after ``OUTBOX_MAX_ATTEMPTS``. Every attempt is logged
on ``NotificationDelivery`` (one row per notification and channel).

The link: a client who can sign in and read the project gets the normal review link. Anyone
else gets a fresh no-login guest review link (an expiring ``GuestInvite`` that may approve),
so approving goes through the existing ``guest_decision`` -> ``record_decision`` flow.
"""
import logging
import uuid
from datetime import datetime, timezone as dt_timezone
from urllib.parse import urlencode

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from app.models import (
    ClientTeamMember, ClientTeamMemberStatus, Notification, NotificationDelivery,
    NotificationDeliveryChannel, NotificationDeliveryStatus, NotificationKind, OutboxEvent,
    User, UserStatus, WhatsAppContact, WhatsAppOptInMethod, WhatsAppOptOutMethod,
    WorkspaceMembership, WorkspaceMembershipStatus, WorkspaceWhatsAppSetting,
)
from app.permissions import MEDIA_READ, has_project_permission

from .audit import record_user_audit
from .guest_access import GUEST_DECISION_PERMISSION, create_guest_invite
from .notifications import _media_payload, review_link, stage_outcome
from .plan_config import get_plan_limit
from .whatsapp import WhatsAppError, get_provider, is_stop_message, mask_phone, normalize_phone

logger = logging.getLogger(__name__)

APPROVAL_TOPIC = 'approval.requested.deliver'
CLIENT_REVIEW_SLUGS = frozenset({'approval', 'client-review', 'client-approval', 'waiting-for-approval'})
GUEST_APPROVAL_PERMISSIONS = (
    'media.read', 'review.comment.read', 'review.comment.create', 'annotation.read', GUEST_DECISION_PERMISSION,
)
SENT_STATES = (NotificationDeliveryStatus.SENT, NotificationDeliveryStatus.DELIVERED, NotificationDeliveryStatus.READ)
OPT_IN_WORDING = 'I agree to get WhatsApp messages from {workspace} when work is ready for me to review or approve. Reply STOP to opt out.'


# -- settings and limits -------------------------------------------------------------------
def is_client_review_stage(stage):
    """The stage that means "waiting for the client": the default "Approval" stage, or any
    stage named for the client or for approval (but never the "Approved" stage itself)."""
    if stage is None or stage_outcome(stage) is not None:
        return False
    slug = (stage.slug or '').lower()
    name = (stage.name or '').strip().lower()
    return slug in CLIENT_REVIEW_SLUGS or 'client' in name or ('approv' in name and 'approved' not in name)


def workspace_whatsapp_setting(workspace):
    setting, _ = WorkspaceWhatsAppSetting.objects.get_or_create(workspace=workspace)
    return setting


def whatsapp_enabled(workspace):
    return WorkspaceWhatsAppSetting.objects.filter(workspace=workspace, enabled=True).exists()


def _workspace_plan(workspace):
    from app.models import SubscriptionPlan
    from .subscriptions import _primary_owner_user, get_effective_plan

    owner = _primary_owner_user(workspace=workspace)
    return get_effective_plan(user=owner) if owner else SubscriptionPlan.FREE


def whatsapp_usage(workspace, *, now=None):
    """WhatsApp messages sent this calendar month (UTC) and the plan's monthly cap."""
    now = now or timezone.now()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    used = NotificationDelivery.objects.filter(
        notification__workspace=workspace, channel=NotificationDeliveryChannel.WHATSAPP,
        status__in=SENT_STATES, sent_at__gte=month_start,
    ).count()
    plan = _workspace_plan(workspace)
    return {'plan': plan, 'used': used, 'limit': get_plan_limit(plan, 'whatsapp_messages_per_month')}


# -- contacts and consent --------------------------------------------------------------------
def _consent_fields(*, opted_in, method, recorded_by, workspace, contact=None):
    now = timezone.now()
    if opted_in:
        if contact is not None and contact.can_message:
            return {}
        return {
            'opted_in_at': now, 'opt_in_method': method, 'opt_in_recorded_by': recorded_by,
            'opt_in_wording': OPT_IN_WORDING.format(workspace=workspace.name),
            'opted_out_at': None, 'opt_out_method': None,
        }
    if contact is not None and contact.can_message:
        out = WhatsAppOptOutMethod.CLIENT_SELF if method == WhatsAppOptInMethod.CLIENT_SELF else WhatsAppOptOutMethod.AGENCY
        return {'opted_out_at': now, 'opt_out_method': out}
    return {}


@transaction.atomic
def set_member_contact(*, member, phone, opted_in, recorded_by, method=WhatsAppOptInMethod.AGENCY_RECORDED):
    """Saves (or clears, with an empty phone) one client person's WhatsApp number and consent."""
    workspace = member.client_team.workspace
    contact = WhatsAppContact.objects.select_for_update().filter(client_team_member=member).first()
    if not (phone or '').strip():
        if contact is not None:
            contact.delete()
        return None
    phone = normalize_phone(phone)
    if contact is None:
        contact = WhatsAppContact(workspace=workspace, client_team_member=member, phone_e164=phone)
    elif contact.phone_e164 != phone:
        # A new number needs fresh consent: the old consent belonged to the old number.
        contact.phone_e164 = phone
        contact.opted_in_at = contact.opt_in_method = contact.opted_out_at = contact.opt_out_method = None
        contact.opt_in_recorded_by = None
    for field, value in _consent_fields(opted_in=opted_in, method=method, recorded_by=recorded_by, workspace=workspace, contact=contact).items():
        setattr(contact, field, value)
    contact.save()
    return contact


def set_invite_contact(*, invite, phone, opted_in, recorded_by):
    workspace = invite.client_team.workspace
    if not (phone or '').strip():
        return None
    return WhatsAppContact.objects.create(
        workspace=workspace, client_team_invite=invite, phone_e164=normalize_phone(phone),
        **_consent_fields(opted_in=opted_in, method=WhatsAppOptInMethod.AGENCY_RECORDED, recorded_by=recorded_by, workspace=workspace),
    )


def attach_invite_contact(*, invite, member):
    """On acceptance, the number typed on an email invite becomes the new member's number."""
    contact = WhatsAppContact.objects.filter(client_team_invite=invite).first()
    if contact is None or WhatsAppContact.objects.filter(client_team_member=member).exists():
        return None
    # A link invite can be used by many people, so only a one-person email invite moves.
    if invite.invite_type != 'EMAIL':
        return None
    contact.client_team_member = member
    contact.client_team_invite = None
    contact.save(update_fields=['client_team_member', 'client_team_invite', 'updated_at'])
    return contact


def opt_out_phone(phone, *, method=WhatsAppOptOutMethod.STOP_REPLY):
    """STOP from a number opts it out everywhere it is stored (one person, many agencies)."""
    try:
        phone = normalize_phone(phone if str(phone).startswith('+') else f'+{phone}')
    except ValueError:
        return 0
    return WhatsAppContact.objects.filter(phone_e164=phone, opted_out_at__isnull=True).exclude(
        opted_in_at__isnull=True,
    ).update(opted_out_at=timezone.now(), opt_out_method=method, updated_at=timezone.now())


def contact_data(contact):
    if contact is None:
        return {'phone': '', 'opted_in': False, 'opted_in_at': None, 'opt_in_method': None, 'opted_out_at': None, 'opt_out_method': None}
    return {
        'phone': contact.phone_e164, 'opted_in': contact.can_message,
        'opted_in_at': contact.opted_in_at, 'opt_in_method': contact.opt_in_method,
        'opt_in_recorded_by': (contact.opt_in_recorded_by.get_full_name() or contact.opt_in_recorded_by.email) if contact.opt_in_recorded_by_id else None,
        'opted_out_at': contact.opted_out_at, 'opt_out_method': contact.opt_out_method,
    }


# -- the trigger ----------------------------------------------------------------------------
def _link_creator_membership(workspace, actor):
    memberships = WorkspaceMembership.objects.filter(workspace=workspace, status=WorkspaceMembershipStatus.ACTIVE)
    if actor is not None:
        mine = memberships.filter(user=actor).first()
        if mine:
            return mine
    return memberships.filter(is_primary_owner=True).first()


def _absolute(path):
    return f'{settings.APP_BASE_URL}{path}'


def request_client_approval(*, media_version, entry, stage, actor=None):
    """Queues approval messages to every active contact of the project's client. Returns the
    notifications created. Runs inside the workflow transaction, so nothing is queued if the
    move rolls back; the outbox worker picks the events up after commit."""
    if not is_client_review_stage(stage):
        return []
    project = media_version.project
    if not project.client_team_id:
        return []
    workspace = project.workspace
    members = ClientTeamMember.objects.filter(
        client_team_id=project.client_team_id, status=ClientTeamMemberStatus.ACTIVE, user__status=UserStatus.ACTIVE,
    ).select_related('user')
    whatsapp_on = whatsapp_enabled(workspace)
    expiry_hours = workspace_whatsapp_setting(workspace).link_expiry_hours if whatsapp_on else 168
    now = timezone.now()
    created = []
    for member in members:
        user = member.user
        if actor is not None and user.id == actor.id:
            continue
        if has_project_permission(user=user, project=project, permission_key=MEDIA_READ):
            link, link_kind, expires_at = _absolute(review_link(media_version=media_version)), 'portal', None
        else:
            creator = _link_creator_membership(workspace, actor)
            if creator is None:
                continue
            invite, token = create_guest_invite(
                project=project, membership=creator, label=f'Approval request · {user.get_full_name() or user.email}',
                permissions=GUEST_APPROVAL_PERMISSIONS, expires_in_hours=expiry_hours, actor=actor,
            )
            query = urlencode({'token': token, 'media': str(media_version.id)})
            link, link_kind, expires_at = _absolute(f'/guest-review?{query}'), 'guest', invite.expires_at
        notification, was_created = Notification.objects.get_or_create(
            recipient_user=user, kind=NotificationKind.CLIENT_APPROVAL_REQUESTED,
            entity_type='media_stage_entry', entity_id=str(entry.id),
            defaults={
                'id': uuid.uuid4(), 'workspace': workspace, 'actor_user': actor, 'created_at': now,
                'payload': {
                    **_media_payload(media_version), 'stage_name': stage.name, 'link_kind': link_kind,
                    # The in-app bell only ever shows the signed-in link; guest tokens stay out of it.
                    'link': review_link(media_version=media_version) if link_kind == 'portal' else None,
                    'expires_at': expires_at.isoformat() if expires_at else None,
                },
            },
        )
        if not was_created:
            continue
        channels = [NotificationDeliveryChannel.EMAIL]
        contact = WhatsAppContact.objects.filter(client_team_member=member).first()
        if whatsapp_on and contact is not None and contact.can_message:
            channels.append(NotificationDeliveryChannel.WHATSAPP)
        for channel in channels:
            OutboxEvent.objects.create(
                id=uuid.uuid4(), topic=APPROVAL_TOPIC, aggregate_type='notification', aggregate_id=str(notification.id),
                deduplication_key=f'notification:{notification.id}:{channel.lower()}',
                payload={'notification_id': str(notification.id), 'channel': channel, 'link': link},
                available_at=now, created_at=now, updated_at=now,
            )
        record_user_audit(
            user=None, workspace=workspace, action='approval_request.sent', entity_type='notification',
            entity_id=notification.id, project=project, team_only=True,
            metadata={
                **_media_payload(media_version), 'recipient_name': user.get_full_name() or user.email,
                'requested_by_user_id': str(actor.id) if actor else None,
                'channels': list(channels), 'link_kind': link_kind,
            },
        )
        created.append(notification)
    return created


# -- delivery -------------------------------------------------------------------------------
def _delivery(notification, channel):
    now = timezone.now()
    delivery, _ = NotificationDelivery.objects.get_or_create(
        notification=notification, channel=channel,
        defaults={'id': uuid.uuid4(), 'created_at': now, 'updated_at': now},
    )
    return delivery


def _finish(delivery, status, *, error=None, attempt=True, **fields):
    delivery.status = status
    if attempt:
        delivery.attempts += 1
    delivery.last_error = (error or '')[:4000] or None
    delivery.updated_at = timezone.now()
    if status == NotificationDeliveryStatus.SENT:
        delivery.sent_at = delivery.updated_at
    for key, value in fields.items():
        setattr(delivery, key, value)
    delivery.save()
    return delivery


def _message_context(notification):
    payload = notification.payload
    recipient = notification.recipient_user
    expires_at = payload.get('expires_at')
    expires_label = ''
    if expires_at:
        from django.utils.dateparse import parse_datetime
        parsed = parse_datetime(expires_at)
        expires_label = parsed.strftime('%-d %b %Y') if parsed else ''
    return {
        'client_name': recipient.first_name or recipient.get_full_name() or 'there',
        'media_title': f"{payload.get('media_title') or 'A new cut'} (V{payload.get('version_number')})",
        'project_name': payload.get('project_name') or '',
        'studio_name': notification.workspace.name,
        'expires_label': expires_label,
    }


def deliver_approval(event):
    payload = event.payload
    notification = Notification.objects.select_related('recipient_user', 'workspace').get(id=payload['notification_id'])
    if payload['channel'] == NotificationDeliveryChannel.WHATSAPP:
        return deliver_approval_whatsapp(notification=notification, link=payload['link'])
    return deliver_approval_email(notification=notification, link=payload['link'])


def deliver_approval_email(*, notification, link):
    from .mailer import send_templated_email

    delivery = _delivery(notification, NotificationDeliveryChannel.EMAIL)
    if delivery.status in (*SENT_STATES, NotificationDeliveryStatus.SKIPPED):
        return delivery
    try:
        sent = send_templated_email(
            template='approval_request', to=notification.recipient_user.email,
            context={**_message_context(notification), 'action_url': link},
        )
        if sent != 1:
            raise RuntimeError('The email backend did not confirm delivery acceptance.')
    except Exception as exc:
        _finish(delivery, NotificationDeliveryStatus.FAILED, error=str(exc))
        raise
    return _finish(delivery, NotificationDeliveryStatus.SENT, provider='email', recipient_masked=notification.recipient_user.email)


def deliver_approval_whatsapp(*, notification, link):
    delivery = _delivery(notification, NotificationDeliveryChannel.WHATSAPP)
    if delivery.status in (*SENT_STATES, NotificationDeliveryStatus.SKIPPED):
        return delivery
    workspace = notification.workspace
    contact = WhatsAppContact.objects.filter(
        client_team_member__user=notification.recipient_user, workspace=workspace,
    ).first()
    # Re-check at send time: consent, the switch or the cap may have changed since queueing.
    if contact is None or not contact.can_message:
        return _finish(delivery, NotificationDeliveryStatus.SKIPPED, error='No WhatsApp opt-in for this person.', attempt=False)
    if not whatsapp_enabled(workspace):
        return _finish(delivery, NotificationDeliveryStatus.SKIPPED, error='WhatsApp is switched off for this workspace.', attempt=False)
    usage = whatsapp_usage(workspace)
    if usage['used'] >= usage['limit']:
        return _finish(
            delivery, NotificationDeliveryStatus.SKIPPED, attempt=False,
            error=f"Monthly WhatsApp limit reached ({usage['used']}/{usage['limit']} on the {usage['plan']} plan).",
        )
    context = _message_context(notification)
    base = f'{settings.APP_BASE_URL}/'
    provider = get_provider()
    try:
        message_id = provider.send_template(
            to=contact.phone_e164, template=settings.WHATSAPP_TEMPLATE_APPROVAL, language=settings.WHATSAPP_TEMPLATE_LANGUAGE,
            body_params=[context['client_name'], context['media_title'], context['project_name'], context['studio_name']],
            # The template's button URL is "{APP_BASE_URL}/{{1}}"; only the path varies.
            button_param=link[len(base):] if link.startswith(base) else link,
        )
    except WhatsAppError as exc:
        _finish(delivery, NotificationDeliveryStatus.FAILED, error=str(exc), provider=provider.name, recipient_masked=mask_phone(contact.phone_e164))
        if exc.retryable:
            raise
        logger.warning('WhatsApp send failed permanently for notification %s: %s', notification.id, exc)
        return delivery
    return _finish(
        delivery, NotificationDeliveryStatus.SENT, provider=provider.name,
        provider_message_id=message_id, recipient_masked=mask_phone(contact.phone_e164),
    )


# -- webhook --------------------------------------------------------------------------------
STATUS_MAP = {'sent': NotificationDeliveryStatus.SENT, 'delivered': NotificationDeliveryStatus.DELIVERED,
              'read': NotificationDeliveryStatus.READ, 'failed': NotificationDeliveryStatus.FAILED}
STATUS_RANK = {NotificationDeliveryStatus.SENT: 1, NotificationDeliveryStatus.DELIVERED: 2, NotificationDeliveryStatus.READ: 3}


def process_webhook(payload):
    """Applies Meta status updates to delivery logs and STOP replies to consent."""
    updated = opted_out = 0
    for entry in (payload or {}).get('entry', []) or []:
        for change in entry.get('changes', []) or []:
            value = change.get('value') or {}
            for item in value.get('statuses', []) or []:
                updated += _apply_status(item)
            for message in value.get('messages', []) or []:
                text = (message.get('text') or {}).get('body') or (message.get('button') or {}).get('text') or ''
                if is_stop_message(text):
                    opted_out += opt_out_phone(message.get('from', ''))
    return {'statuses': updated, 'opted_out': opted_out}


def _apply_status(item):
    status = STATUS_MAP.get(item.get('status'))
    message_id = item.get('id')
    if status is None or not message_id:
        return 0
    delivery = NotificationDelivery.objects.filter(provider_message_id=message_id).first()
    if delivery is None:
        return 0
    try:
        at = datetime.fromtimestamp(int(item.get('timestamp')), tz=dt_timezone.utc)
    except (TypeError, ValueError, OverflowError):
        at = timezone.now()
    fields = ['status', 'updated_at']
    if status == NotificationDeliveryStatus.FAILED:
        errors = item.get('errors') or [{}]
        delivery.last_error = f"WhatsApp error {errors[0].get('code')}: {errors[0].get('title') or errors[0].get('message') or 'failed'}"[:4000]
        fields.append('last_error')
    elif STATUS_RANK.get(status, 0) < STATUS_RANK.get(delivery.status, 0):
        return 0  # Webhooks can arrive out of order; never step back from read to delivered.
    if status == NotificationDeliveryStatus.DELIVERED:
        delivery.delivered_at = at
        fields.append('delivered_at')
    if status == NotificationDeliveryStatus.READ:
        delivery.read_at = at
        delivery.delivered_at = delivery.delivered_at or at
        fields += ['read_at', 'delivered_at']
    delivery.status = status
    delivery.updated_at = timezone.now()
    delivery.save(update_fields=fields)
    return 1


def delivery_data(delivery):
    notification = delivery.notification
    payload = notification.payload or {}
    return {
        'id': str(delivery.id), 'channel': delivery.channel, 'status': delivery.status,
        'attempts': delivery.attempts, 'last_error': delivery.last_error,
        'provider': delivery.provider or None, 'recipient': delivery.recipient_masked or None,
        'recipient_name': notification.recipient_user.get_full_name() or notification.recipient_user.email,
        'kind': notification.kind, 'project_id': payload.get('project_id'), 'project_name': payload.get('project_name'),
        'media_title': payload.get('media_title'), 'version_number': payload.get('version_number'),
        'sent_at': delivery.sent_at, 'delivered_at': delivery.delivered_at, 'read_at': delivery.read_at,
        'created_at': delivery.created_at, 'updated_at': delivery.updated_at,
    }
