/**
 * ISO 4217 currency metadata from the runtime's Intl (CLDR) data: code, English name,
 * symbol and minor units. The backend validates against the same list (app/currencies.py).
 */

export type CurrencyInfo = { code: string; name: string; symbol: string; digits: number };

/** A few codes older runtimes might lack from supportedValuesOf; never the full list. */
const FALLBACK_CODES = ["GBP", "USD", "EUR", "BDT", "INR", "PHP", "JPY", "AUD", "CAD", "AED", "SGD", "NGN", "PKR", "ZAR"];

const cache = new Map<string, CurrencyInfo>();

function symbolFor(code: string): string {
  try {
    const part = (display: "symbol" | "narrowSymbol") => new Intl.NumberFormat("en", { style: "currency", currency: code, currencyDisplay: display })
      .formatToParts(0).find((p) => p.type === "currency")?.value ?? code;
    // "symbol" keeps CA$ / A$ distinct from $, but some codes (BDT) only have a narrow sign (৳).
    const wide = part("symbol");
    return wide === code ? part("narrowSymbol") : wide;
  } catch { return code; }
}

export function currencyInfo(rawCode: string): CurrencyInfo {
  const code = (rawCode || "").trim().toUpperCase();
  const hit = cache.get(code);
  if (hit) return hit;
  let name = code;
  let digits = 2;
  try { name = new Intl.DisplayNames(["en"], { type: "currency" }).of(code) ?? code; } catch { /* unknown code */ }
  try { digits = new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits ?? 2; } catch { /* keep 2 */ }
  const info = { code, name, symbol: symbolFor(code), digits };
  cache.set(code, info);
  return info;
}

export function currencyCodes(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try { if (intl.supportedValuesOf) return intl.supportedValuesOf("currency"); } catch { /* older runtime */ }
  return [...FALLBACK_CODES].sort();
}

/** "BDT · ৳" for chips; just the code when the symbol is the code. */
export function currencyChip(code: string): string {
  const info = currencyInfo(code);
  return info.symbol && info.symbol !== info.code ? `${info.code} · ${info.symbol}` : info.code;
}

/** Options for the themed Select: label carries code, name and symbol so search matches any of them. */
export function currencyOptions(): { value: string; label: string }[] {
  return currencyCodes().map((code) => {
    const info = currencyInfo(code);
    return { value: code, label: `${code} — ${info.name}${info.symbol !== code ? ` (${info.symbol})` : ""}` };
  });
}
