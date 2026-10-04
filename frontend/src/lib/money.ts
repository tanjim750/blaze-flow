/**
 * Money helpers for the billing demo. Amounts travel as decimal strings ("1250.00") with an
 * ISO 4217 currency code beside them; arithmetic is done in integer minor units (pence) so
 * 0.1 + 0.2 never shows up on an invoice.
 */

export type Money = { amount: string | number | null | undefined; currency: string };

/** "1250.5" -> 125050. Null, blank or unparseable -> 0. Rounds half away from zero. */
export function toMinor(amount: string | number | null | undefined): number {
  if (amount === null || amount === undefined || amount === "") return 0;
  const value = typeof amount === "number" ? amount : Number(String(amount).replace(/[,\s]/g, ""));
  if (!Number.isFinite(value)) return 0;
  return Math.sign(value) * Math.round(Math.abs(value) * 100);
}

/** 125050 -> "1250.50", the shape the API takes and returns. */
export function fromMinor(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minor));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function sumMoney(amounts: (string | number | null | undefined)[]): string {
  return fromMinor(amounts.reduce<number>((total, amount) => total + toMinor(amount), 0));
}

export function subtractMoney(a: string | number | null | undefined, b: string | number | null | undefined): string {
  return fromMinor(toMinor(a) - toMinor(b));
}

const formatters = new Map<string, Intl.NumberFormat>();
function formatter(currency: string, locale: string, whole: boolean): Intl.NumberFormat {
  const key = `${locale}|${currency}|${whole}`;
  let found = formatters.get(key);
  if (!found) {
    try {
      found = new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
    } catch {
      // An unknown code still renders, as "XYZ 1,250.00", rather than throwing in a page.
      found = new Intl.NumberFormat(locale, { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
    }
    formatters.set(key, found);
  }
  return found;
}

/**
 * Format with Intl: `formatMoney("1250.5", "GBP")` -> "£1,250.50". `whole` drops the pence
 * when they are zero (for big dashboard numbers); `null` amounts render as an em dash.
 */
export function formatMoney(amount: string | number | null | undefined, currency = "GBP", options: { locale?: string; whole?: boolean } = {}): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const minor = toMinor(amount);
  const locale = options.locale ?? "en-GB";
  const whole = Boolean(options.whole) && minor % 100 === 0;
  const text = formatter(currency, locale, whole).format(minor / 100);
  const known = formatter(currency, locale, whole).resolvedOptions().currency;
  return known ? text : `${currency} ${text}`;
}

/**
 * What someone typed into a price box, as an API amount. "" -> null (clears the price),
 * "£1,250" -> "1250.00". Returns `{ error }` for anything that is not a non-negative amount.
 */
export function parseMoneyInput(raw: string): { amount: string | null } | { error: string } {
  const cleaned = raw.replace(/[£$€,\s]/g, "");
  if (cleaned === "") return { amount: null };
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return { error: "Enter an amount like 1250 or 1250.50." };
  return { amount: fromMinor(toMinor(cleaned)) };
}

/** Percent of `part` in `whole`, one decimal, or null when there is no whole. */
export function percentOf(part: string | number | null | undefined, whole: string | number | null | undefined): number | null {
  const base = toMinor(whole);
  if (!base) return null;
  return Math.round((toMinor(part) / base) * 1000) / 10;
}
