"""Public Stripe routes: the shareable invoice pay link and the Connect webhook."""
import logging

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import Invoice, InvoiceStatus, WorkspaceProfile
from .services import billing, stripe_connect
from .throttles import UploadLinkThrottle

logger = logging.getLogger(__name__)


def _invoice_for_token(token):
    if not token or len(token) > 64:
        return None
    invoice = Invoice.objects.select_related('client_team', 'project', 'workspace').filter(pay_token=token).first()
    if invoice is None or invoice.status == InvoiceStatus.DRAFT:
        return None
    return invoice


def public_invoice_out(invoice):
    profile = WorkspaceProfile.objects.filter(workspace=invoice.workspace).first()
    data = billing.invoice_out(invoice, detail=True, workspace_profile=profile)
    # The payer sees the invoice, not the studio's internal ledger notes.
    data['payments'] = [{'amount': p['amount'], 'currency': p['currency'], 'paid_on': p['paid_on'], 'provider': p['provider']}
                        for p in data['payments']]
    data.pop('can_revert', None)
    data.pop('default_due_date', None)
    data['online_payment'] = stripe_connect.online_payment(invoice)
    data['studio_name'] = data['from']['name']
    return data


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([UploadLinkThrottle])
def public_pay(request, token):
    invoice = _invoice_for_token(token)
    if invoice is None:
        return Response({'detail': 'This payment link is not valid.'}, status=status.HTTP_404_NOT_FOUND)
    return Response(public_invoice_out(invoice))


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([UploadLinkThrottle])
def public_pay_checkout(request, token):
    invoice = _invoice_for_token(token)
    if invoice is None:
        return Response({'detail': 'This payment link is not valid.'}, status=status.HTTP_404_NOT_FOUND)
    back = stripe_connect.connect_url(f'/pay/{token}')
    try:
        url = stripe_connect.create_checkout(invoice=invoice, success_url=f'{back}?stripe=success', cancel_url=f'{back}?stripe=cancel')
    except stripe_connect.StripeNotConfigured as exc:
        return Response({'detail': str(exc), 'code': 'stripe_not_configured'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    except stripe_connect.StripeConnectError as exc:
        return Response({'detail': str(exc)}, status=exc.status)
    return Response({'url': url})


@csrf_exempt
@require_POST
def stripe_webhook(request):
    """Stripe Connect events. Plain Django view: the signature is over the exact raw body."""
    try:
        outcome = stripe_connect.handle_webhook(request.body, request.META.get('HTTP_STRIPE_SIGNATURE'))
    except stripe_connect.StripeNotConfigured as exc:
        return JsonResponse({'detail': str(exc)}, status=503)
    except stripe_connect.WebhookSignatureError:
        return JsonResponse({'detail': 'Invalid signature.'}, status=400)
    return JsonResponse({'received': True, 'outcome': outcome})
