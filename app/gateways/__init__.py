"""Local payment gateways: each agency connects its own merchant account with its own keys.

Stripe (Connect, platform keys) lives in ``app/services/stripe_connect.py``; these providers
share the invoice Pay now / pay link, the checkout record, the webhook/IPN route and the single
payment-recording path in ``app/services/online_payments.py``.
"""
from .base import GatewayError, GatewayProvider, PaymentEvent, WebhookRejected  # noqa: F401
from .paymongo import PayMongo
from .safepay import Safepay
from .sslcommerz import SSLCommerz
from .paypal import PayPal
from .manual import MANUAL_PROVIDERS, ManualProvider, get_manual  # noqa: F401

PROVIDERS: dict[str, GatewayProvider] = {p.key: p for p in (PayPal(), PayMongo(), Safepay(), SSLCommerz())}


def get_provider(key: str) -> GatewayProvider | None:
    return PROVIDERS.get(str(key or '').lower())
