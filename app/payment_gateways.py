"""Payment gateway registry.

Stripe is live (Stripe Connect, see ``app/services/stripe_connect.py``) whenever the server has
``STRIPE_SECRET_KEY``; the other providers are still ``coming_soon``.

A gateway (Stripe, PayPal, Razorpay, ...) will subclass ``PaymentGateway``, implement
``create_checkout`` and ``handle_webhook``, and record money through
``billing.record_payment(provider=<key>, provider_reference=<event id>)`` - the single path
that marks anything paid. Credentials will live in per-workspace encrypted storage, never in
this module and never in API responses. Today every provider is ``coming_soon`` and nothing
here makes a network call.
"""
from __future__ import annotations

from dataclasses import dataclass, field


class GatewayNotAvailable(Exception):
    pass


@dataclass(frozen=True)
class PaymentGateway:
    key: str
    name: str
    description: str
    # None = every currency the provider supports (checked by the provider when connected).
    currencies: tuple[str, ...] | None = None
    status: str = 'coming_soon'  # coming_soon | available
    features: tuple[str, ...] = field(default_factory=tuple)

    def create_checkout(self, *, invoice):  # pragma: no cover - interface
        raise GatewayNotAvailable(f'{self.name} is not available yet.')

    def handle_webhook(self, *, request):  # pragma: no cover - interface
        raise GatewayNotAvailable(f'{self.name} is not available yet.')

    def as_dict(self, *, workspace_currency: str | None = None) -> dict:
        supports = self.currencies is None or (workspace_currency or '') in self.currencies
        return {
            'key': self.key, 'name': self.name, 'description': self.description, 'status': self.status,
            'connected': False, 'features': list(self.features), 'supports_workspace_currency': supports,
        }


REGISTRY: dict[str, PaymentGateway] = {}


def register(gateway: PaymentGateway) -> PaymentGateway:
    REGISTRY[gateway.key] = gateway
    return gateway


register(PaymentGateway('stripe', 'Stripe', 'Cards, wallets and bank debits with a hosted pay link on every invoice.',
                        features=('Pay links on invoices', 'Automatic payment matching')))
register(PaymentGateway('paypal', 'PayPal', 'Let clients pay invoices with PayPal or card.',
                        features=('Pay links on invoices',)))
register(PaymentGateway('razorpay', 'Razorpay', 'UPI, cards and net banking for India.', currencies=('INR',),
                        features=('UPI', 'Net banking')))
register(PaymentGateway('sslcommerz', 'SSLCOMMERZ', 'bKash, Nagad, cards and banks for Bangladesh.', currencies=('BDT',),
                        features=('bKash', 'Nagad')))


def list_gateways(*, workspace_currency: str | None = None, workspace=None) -> list[dict]:
    out = [gateway.as_dict(workspace_currency=workspace_currency) for gateway in REGISTRY.values()]
    from .services import stripe_connect
    from .stripe_currencies import stripe_supports
    for item in out:
        if item['key'] == 'stripe':
            account = stripe_connect.account_for(workspace) if workspace is not None else None
            item['status'] = 'available' if stripe_connect.is_configured() else 'not_configured'
            item['connected'] = account is not None
            item['connect_status'] = account.status if account is not None else 'not_connected'
            item['supports_workspace_currency'] = stripe_supports(workspace_currency or '')
    return out
