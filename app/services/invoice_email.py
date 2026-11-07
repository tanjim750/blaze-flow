"""Email a sent invoice to the client, with a link to view it in the client portal."""
import logging

from django.conf import settings

from app.models import ClientTeamMember, ClientTeamMemberStatus

from .mailer import send_templated_email

logger = logging.getLogger(__name__)


def invoice_recipients(invoice) -> list[str]:
    """The client team's billing address plus its active members, de-duplicated, in order."""
    seen, out = set(), []
    candidates = [invoice.client_team.email] + list(
        ClientTeamMember.objects.filter(client_team_id=invoice.client_team_id, status=ClientTeamMemberStatus.ACTIVE)
        .select_related('user').order_by('joined_at').values_list('user__email', flat=True)
    )
    for email in candidates:
        email = (email or '').strip()
        if email and '@' in email and email.lower() not in seen:
            seen.add(email.lower())
            out.append(email)
    return out


def portal_url(invoice) -> str:
    return f"{settings.APP_BASE_URL.rstrip('/')}/money/invoices/{invoice.id}"


def email_invoice(*, invoice, total, sender_name='') -> list[str]:
    """Send the invoice email to every recipient. Returns who it went to; never raises."""
    recipients = invoice_recipients(invoice)
    if not recipients:
        return []
    context = {
        'number': invoice.number, 'workspace_name': invoice.workspace.name, 'client_name': invoice.client_team.name,
        'project_name': invoice.project.name if invoice.project_id else '', 'total': total, 'currency': invoice.currency,
        'due_date': invoice.due_date, 'issue_date': invoice.issue_date, 'action_url': portal_url(invoice),
        'sender_name': sender_name, 'notes': invoice.notes,
    }
    sent = []
    for email in recipients:
        try:
            send_templated_email(template='invoice', to=email, context=context)
            sent.append(email)
        except Exception:  # delivery problems must not undo the send
            logger.exception('Invoice email to %s failed for invoice %s', email, invoice.id)
    return sent
