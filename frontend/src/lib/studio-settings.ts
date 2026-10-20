/** Studio settings: invoicing defaults, editors' default rates and the AI QA glossary. */

export type InvoiceSettings = { currency: string; payment_terms_days: number; invoice_prefix: string };
export type RateRow = { membership_id: string; name: string; email: string | null; active: boolean; role?: string | null; default_rate: string | null };
export type GlossaryKind = "brand" | "product" | "name" | "acronym" | "stylisation" | "other";
export type GlossaryTerm = { id: string; project_id: string | null; term: string; normalized: string; kind: GlossaryKind; enabled: boolean; created_at: string };

export const GLOSSARY_KINDS: { value: GlossaryKind; label: string }[] = [
  { value: "brand", label: "Brand" }, { value: "product", label: "Product" }, { value: "name", label: "Name" },
  { value: "acronym", label: "Acronym" }, { value: "stylisation", label: "Stylisation" }, { value: "other", label: "Other" },
];


/** Client-side checks that mirror the backend, so mistakes show before saving. */
export function invoiceSettingsError(value: { currency: string; payment_terms_days: string; invoice_prefix: string }): string | null {
  if (!/^[A-Za-z]{3}$/.test(value.currency.trim())) return "Use a three-letter currency code such as GBP, USD or EUR.";
  const days = Number(value.payment_terms_days);
  if (!Number.isInteger(days) || days < 0 || days > 365) return "Payment terms must be a whole number of days, 0–365.";
  if (!value.invoice_prefix.trim() || value.invoice_prefix.trim().length > 20) return "The invoice prefix needs 1–20 characters.";
  return null;
}

/** "INV" + 7 → "INV-0007": the preview of the next number, matching the backend format. */
export const invoiceNumberPreview = (prefix: string) => `${prefix.trim() || "INV"}-0001`;
