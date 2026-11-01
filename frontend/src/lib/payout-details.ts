/**
 * Editor payout details: how each team member wants the agency to pay them. Krewsys never
 * holds or moves the money; owners read these and pay the editor directly.
 */
export type PayoutMethodId = "bank_transfer" | "wise" | "payoneer" | "paypal" | "bkash_nagad" | "upi" | "gcash" | "other";
export type PayoutField = { name: string; label: string; required: boolean; kind: "text" | "email" | "phone" | "upi" | "textarea"; placeholder?: string };
export type PayoutMethodDef = { id: PayoutMethodId; label: string; fields: PayoutField[] };

export const PAYOUT_METHODS: PayoutMethodDef[] = [
  { id: "bank_transfer", label: "Bank transfer", fields: [
    { name: "account_name", label: "Account name", required: true, kind: "text" },
    { name: "bank_name", label: "Bank", required: true, kind: "text" },
    { name: "account_number", label: "Account number / IBAN", required: true, kind: "text" },
    { name: "swift", label: "SWIFT / routing", required: false, kind: "text" },
    { name: "country", label: "Country", required: false, kind: "text" },
  ] },
  { id: "wise", label: "Wise", fields: [{ name: "email", label: "Wise email", required: true, kind: "email", placeholder: "you@example.com" }] },
  { id: "payoneer", label: "Payoneer", fields: [{ name: "email", label: "Payoneer email", required: true, kind: "email", placeholder: "you@example.com" }] },
  { id: "paypal", label: "PayPal", fields: [{ name: "email", label: "PayPal email", required: true, kind: "email", placeholder: "you@example.com" }] },
  { id: "bkash_nagad", label: "bKash / Nagad", fields: [{ name: "phone", label: "bKash / Nagad number", required: true, kind: "phone", placeholder: "+8801…" }] },
  { id: "upi", label: "UPI", fields: [{ name: "upi_id", label: "UPI ID", required: true, kind: "upi", placeholder: "name@bank" }] },
  { id: "gcash", label: "GCash", fields: [{ name: "phone", label: "GCash number", required: true, kind: "phone", placeholder: "09…" }] },
  { id: "other", label: "Other", fields: [{ name: "details", label: "How to pay you", required: true, kind: "textarea" }] },
];

export type SavedPayoutMethod = {
  id?: string; method: PayoutMethodId; label?: string; is_preferred: boolean; details: Record<string, string>;
  fields?: { name: string; label: string; value: string }[]; unreadable?: boolean;
};
export type PayoutDetails = { membership_id: string; name?: string; methods: SavedPayoutMethod[]; preferred: SavedPayoutMethod | null; encryption_configured: boolean };

export const payoutMethod = (id: string) => PAYOUT_METHODS.find((item) => item.id === id);
export const payoutLabel = (id: string) => payoutMethod(id)?.label ?? id;

/** The record-payout dialog uses the same ids for these rails; anything else is "other". */
export function paymentMethodFor(id: string | null | undefined): string {
  if (!id) return "bank_transfer";
  return payoutMethod(id) ? id : "other";
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE = /^\+?[0-9][0-9 -]{6,18}$/;
const UPI = /^[A-Za-z0-9._-]{2,}@[A-Za-z]{2,}$/;

/** First problem in a method's details, or null. Mirrors the server's checks. */
export function payoutMethodError(item: Pick<SavedPayoutMethod, "method" | "details">): string | null {
  const def = payoutMethod(item.method);
  if (!def) return "Choose a payout method.";
  for (const field of def.fields) {
    const value = (item.details[field.name] ?? "").trim();
    if (!value) { if (field.required) return `${field.label} is required.`; continue; }
    if (field.kind === "email" && !EMAIL.test(value)) return `${field.label} doesn’t look like an email.`;
    if (field.kind === "phone" && !PHONE.test(value)) return `${field.label} doesn’t look like a phone number.`;
    if (field.kind === "upi" && !UPI.test(value)) return "UPI ID looks like name@bank.";
  }
  return null;
}

/** A short, safe one-liner for a method: "Wise · maya@…", "Bank transfer · ••••1234". */
export function payoutSummary(item: Pick<SavedPayoutMethod, "method" | "details">): string {
  const d = item.details;
  const tail = (value?: string) => (value && value.length > 4 ? `••••${value.slice(-4)}` : value ?? "");
  const hint = item.method === "bank_transfer" ? [d.bank_name, tail(d.account_number)].filter(Boolean).join(" ")
    : item.method === "other" ? (d.details ?? "").slice(0, 40)
      : d.email ?? d.phone ?? d.upi_id ?? "";
  return hint ? `${payoutLabel(item.method)} · ${hint}` : payoutLabel(item.method);
}
