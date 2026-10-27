/** Stripe Connect: types, labels and browser-side calls (through the Next `/api` proxy). */
import { api } from "@/components/tasks/tasks-api";

export type StripeConnectState = "not_connected" | "onboarding" | "needs_info" | "pending" | "active" | "disabled";
export type StripeStatus = {
  configured: boolean; not_configured_message: string | null; connected: boolean; can_manage: boolean;
  platform_fee_percent: string; status: StripeConnectState; charges_enabled: boolean; payouts_enabled: boolean;
  details_submitted: boolean; requirements_due: string[]; disabled_reason: string; account_id: string | null;
  country: string; default_currency: string; last_synced_at: string | null;
};
export type OnlinePaymentReason = "not_configured" | "not_connected" | "account_not_active" | "draft" | "nothing_due" | "currency_unsupported";
export type OnlinePayment = { provider: "stripe"; available: boolean; reason: OnlinePaymentReason | null; message?: string };

export type Tone = "neutral" | "warning" | "success" | "danger" | "info";
export const STRIPE_STATUS: Record<StripeConnectState, { label: string; tone: Tone; help: string }> = {
  not_connected: { label: "Not connected", tone: "neutral", help: "Connect your Stripe account so clients can pay invoices by card. Money goes straight to your Stripe account, then to your bank." },
  onboarding: { label: "Onboarding pending", tone: "warning", help: "Stripe still needs your business details, ID and bank account. It takes about 10 minutes." },
  needs_info: { label: "Needs info", tone: "warning", help: "Stripe needs a few more details before it can keep paying out. Add them to avoid interruptions." },
  pending: { label: "Pending review", tone: "info", help: "Your details are in. Stripe is checking them; this is usually quick." },
  active: { label: "Active", tone: "success", help: "Clients can pay invoices online. Payments mark invoices paid automatically." },
  disabled: { label: "Disabled by Stripe", tone: "danger", help: "Stripe has turned off payments on this account. Open the Stripe dashboard to see why." },
};

/** A friendly line for why Pay now isn't offered (null when it is, or when there's nothing to say). */
export function onlinePaymentNote(payment: OnlinePayment | undefined, { manager = false } = {}): string | null {
  if (!payment || payment.available) return null;
  switch (payment.reason) {
    case "currency_unsupported": return payment.message ?? "Stripe can't take payments in this currency.";
    case "not_configured": return manager ? "Stripe not configured on this server." : null;
    case "not_connected": return manager ? "Connect Stripe in Settings → Billing & currency to add a Pay now button." : null;
    case "account_not_active": return manager ? "Pay now appears once your Stripe account is active." : null;
    default: return null;
  }
}

/** Humanise Stripe requirement keys such as `individual.verification.document`. */
export const requirementLabel = (key: string) => key.split(".").slice(-2).join(" ").replaceAll("_", " ");

const base = (workspaceId: string) => `workspaces/${workspaceId}/billing/stripe`;
export const getStripeStatus = (workspaceId: string, refresh = false) => api<StripeStatus>(`${base(workspaceId)}/${refresh ? "?refresh=1" : ""}`);
export const connectStripe = (workspaceId: string) => api<StripeStatus & { url: string }>(`${base(workspaceId)}/connect/`, "POST");
export const stripeDashboard = (workspaceId: string) => api<{ url: string }>(`${base(workspaceId)}/dashboard/`, "POST");
export const disconnectStripe = (workspaceId: string) => api<StripeStatus>(`${base(workspaceId)}/disconnect/`, "POST");
export const invoiceCheckout = (workspaceId: string, invoiceId: string) => api<{ url: string }>(`workspaces/${workspaceId}/billing/invoices/${invoiceId}/checkout/`, "POST");
export const publicCheckout = (token: string) => api<{ url: string }>(`public/pay/${encodeURIComponent(token)}/checkout/`, "POST");

/** Leaves the app for a Stripe-hosted page. A seam so tests can watch it. */
export const goTo = { url: (url: string) => { window.location.assign(url); } };
