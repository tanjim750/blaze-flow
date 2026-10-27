/** Local payment gateways (PayMongo, Safepay, SSLCOMMERZ) and the Pay now chooser. */
import { api } from "@/components/tasks/tasks-api";

export type GatewayField = { name: string; label: string; secret: boolean; required: boolean; help: string; placeholder: string };
export type GatewayMode = "sandbox" | "live";
export type ConnectionStatus = "not_connected" | "untested" | "connected" | "failed" | "unreadable";

/** A local gateway card in Settings → Billing. Secrets only ever arrive masked ("••••1234"). */
export type LocalGateway = {
  key: string; name: string; description: string; status: "available"; kind: "merchant_keys"; recommended: boolean;
  countries: string[]; currencies: string[]; methods: string[]; features: string[]; fields: GatewayField[];
  docs_url: string; signup_url: string; keys_help: string; webhook_help: string; webhook_in_dashboard: boolean;
  min_amount: string | null; max_amount: string | null; supports_workspace_currency: boolean; encryption_configured: boolean;
  connected: boolean; enabled: boolean; mode: GatewayMode; connection_status: ConnectionStatus; status_message: string;
  last_tested_at: string | null; credentials: Record<string, string>; webhook_url: string | null; details?: { payment_methods?: string[] };
};

export type PaymentOptionReason = "not_configured" | "not_connected" | "account_not_active" | "not_enabled" | "draft" | "nothing_due"
  | "currency_unsupported" | "amount_out_of_range";
export type PaymentOption = { provider: string; name: string; available: boolean; reason: PaymentOptionReason | null; message?: string; methods?: string[]; sandbox?: boolean };

export const CONNECTION_STATUS: Record<ConnectionStatus, { label: string; tone: "neutral" | "warning" | "success" | "danger" | "info" }> = {
  not_connected: { label: "Not set up", tone: "neutral" },
  untested: { label: "Keys saved · not tested", tone: "warning" },
  connected: { label: "Connected", tone: "success" },
  failed: { label: "Test failed", tone: "danger" },
  unreadable: { label: "Keys unreadable", tone: "danger" },
};

export const isLocalGateway = (gateway: { kind?: string }): gateway is LocalGateway => gateway.kind === "merchant_keys";

/** The gateway's state in a word, combining connection and on/off. */
export function gatewayBadge(gateway: LocalGateway): { label: string; tone: "neutral" | "warning" | "success" | "danger" | "info" } {
  if (gateway.connection_status === "connected" && gateway.enabled) return { label: gateway.mode === "live" ? "Live" : "Sandbox · on", tone: gateway.mode === "live" ? "success" : "info" };
  if (gateway.connection_status === "connected") return { label: "Connected · off", tone: "neutral" };
  return CONNECTION_STATUS[gateway.connection_status] ?? CONNECTION_STATUS.not_connected;
}

/** Why this gateway doesn't fit the workspace currency (null when it does). */
export function currencyNote(gateway: Pick<LocalGateway, "name" | "currencies" | "supports_workspace_currency">, workspaceCurrency: string): string | null {
  if (gateway.supports_workspace_currency) return null;
  return `${gateway.name} only takes ${gateway.currencies.join("/")}. Invoices in ${workspaceCurrency} won't offer it; switch the workspace currency to ${gateway.currencies[0]} to use it.`;
}

/** A friendly reason a payer can't use one option, or null. */
export function optionNote(option: PaymentOption): string | null {
  if (option.available) return null;
  if (option.message) return option.message;
  switch (option.reason) {
    case "currency_unsupported": return `${option.name} can't take this invoice's currency.`;
    case "amount_out_of_range": return `${option.name} can't take this amount.`;
    default: return null;
  }
}

/** ?payment=success|cancel|fail from a local gateway, or ?stripe=success|cancel from Stripe. */
export function paymentReturn(query: Record<string, string | string[] | undefined>): "success" | "cancel" | "fail" | null {
  const raw = query.payment ?? query.stripe;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "success" || value === "cancel" || value === "fail" ? value : null;
}

const base = (workspaceId: string, provider: string) => `workspaces/${workspaceId}/billing/gateways/${provider}`;
export const saveGatewayKeys = (workspaceId: string, provider: string, mode: GatewayMode, credentials: Record<string, string>) =>
  api<LocalGateway>(`${base(workspaceId, provider)}/`, "PUT", { mode, credentials });
export const testGateway = (workspaceId: string, provider: string) => api<LocalGateway>(`${base(workspaceId, provider)}/test/`, "POST");
export const enableGateway = (workspaceId: string, provider: string, enabled: boolean) => api<LocalGateway>(`${base(workspaceId, provider)}/enable/`, "POST", { enabled });
export const disconnectGateway = (workspaceId: string, provider: string) => api<LocalGateway>(`${base(workspaceId, provider)}/`, "DELETE");

/** ISO 3166-1 alpha-2 codes for the workspace country picker (names come from Intl). */
export const COUNTRY_CODES = ("AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ "
  + "DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN "
  + "KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MO MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM PA PE PG PH PK PL "
  + "PR PS PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE "
  + "VN VU WS XK YE ZA ZM ZW").split(" ");

export function countryName(code: string): string {
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code; } catch { return code; }
}

export function countryOptions() {
  return COUNTRY_CODES.map((code) => ({ value: code, label: `${countryName(code)} (${code})` })).sort((a, b) => a.label.localeCompare(b.label));
}

const RECOMMEND_LABEL: Record<string, string> = { stripe: "Stripe", paymongo: "PayMongo", safepay: "Safepay", sslcommerz: "SSLCOMMERZ" };
export const recommendationLine = (country: string, keys: string[]) =>
  keys.length ? `Recommended for ${countryName(country)}: ${keys.map((k) => RECOMMEND_LABEL[k] ?? k).join(", ")}. You can still turn on any gateway.` : "";
