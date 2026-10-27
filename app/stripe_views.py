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
from .services import billing, online_payments, stripe_connect
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
    data['payment_options'] = online_payments.payment_options(invoice)
    data['online_payment'] = online_payments.online_payment(invoice, options=data['payment_options'])
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
    from .billing_views import checkout_response
    provider = request.data.get('provider') if hasattr(request.data, 'get') else None
    return checkout_response(invoice, provider=provider, return_path=f'/pay/{token}')


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



@csrf_exempt
def gateway_webhook(request, provider, connection_id):
    """PayMongo / Safepay webhooks and SSLCOMMERZ IPN. Raw body kept for signature checks."""
    if request.method != 'POST':
        return JsonResponse({'detail': 'Method not allowed.'}, status=405)
    code, body = online_payments.handle_webhook(provider_key=provider, connection_id=connection_id, request=request)
    return JsonResponse(body, status=code)


@csrf_exempt
def gateway_return(request, checkout_id, result):
    """The payer comes back from the hosted page (SSLCOMMERZ POSTs here). Re-checked server side."""
    from django.http import HttpResponseRedirect
    if request.method not in ('GET', 'POST'):
        return JsonResponse({'detail': 'Method not allowed.'}, status=405)
    return HttpResponseRedirect(online_payments.handle_return(checkout_id=checkout_id, result=result, request=request))
