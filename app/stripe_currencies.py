"""Which currencies Stripe can charge in, and how to turn an amount into Stripe's minor units.

Source: https://docs.stripe.com/currencies (checked 27 Oct 2026). Stripe's list of presentment
currencies is long; a currency outside it (e.g. BHD, KWD) cannot be charged through Stripe, so
the invoice shows a clear note instead of a Pay now button. Availability also depends on the
connected account's country; Stripe has the final word when the Checkout Session is created.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

STRIPE_CURRENCIES = frozenset('''
AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BIF BMD BND BOB BRL BSD BWP BYN BZD CAD CDF
CHF CLP CNY COP CRC CVE CZK DJF DKK DOP DZD EGP ETB EUR FJD FKP GBP GEL GIP GMD GNF GTQ GYD HKD
HNL HTG HUF IDR ILS INR ISK JMD JPY KES KGS KHR KMF KRW KYD KZT LAK LBP LKR LRD LSL MAD MDL MGA
MKD MMK MNT MOP MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD PAB PEN PGK PHP PKR PLN PYG QAR
RON RSD RUB RWF SAR SBD SCR SEK SGD SHP SLE SOS SRD STD SZL THB TJS TOP TRY TTD TWD TZS UAH UGX
USD UYU UZS VND VUV WST XAF XCD XCG XOF XPF YER ZAR ZMW
'''.split())

# Amount is sent as-is (500 JPY -> 500).
ZERO_DECIMAL = frozenset('BIF CLP DJF GNF JPY KMF KRW MGA PYG RWF VND VUV XAF XOF XPF'.split())
# Whole units only, but still sent as a two-decimal value ending in 00 (5 ISK -> 500).
WHOLE_UNITS_TWO_DECIMAL = frozenset({'ISK', 'UGX'})


class UnsupportedCurrency(ValueError):
    pass


def stripe_supports(currency: str | None) -> bool:
    return bool(currency) and currency.upper() in STRIPE_CURRENCIES


def is_zero_decimal(currency: str) -> bool:
    return currency.upper() in ZERO_DECIMAL


def to_minor_units(amount, currency: str) -> int:
    """Decimal amount -> the integer Stripe expects. Rounds half-up to what the currency allows."""
    code = currency.upper()
    if code not in STRIPE_CURRENCIES:
        raise UnsupportedCurrency(f'Stripe does not support {code}.')
    value = Decimal(str(amount))
    if code in ZERO_DECIMAL:
        return int(value.quantize(Decimal('1'), rounding=ROUND_HALF_UP))
    if code in WHOLE_UNITS_TWO_DECIMAL:
        return int(value.quantize(Decimal('1'), rounding=ROUND_HALF_UP)) * 100
    return int((value * 100).quantize(Decimal('1'), rounding=ROUND_HALF_UP))


def from_minor_units(minor: int, currency: str) -> Decimal:
    code = currency.upper()
    if code in ZERO_DECIMAL:
        return Decimal(int(minor)).quantize(Decimal('0.01'))
    return (Decimal(int(minor)) / 100).quantize(Decimal('0.01'))
