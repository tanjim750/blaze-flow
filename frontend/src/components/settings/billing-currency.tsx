"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Globe, Loader2, Save, Sparkles, Wallet } from "@/components/icons";
import { Select } from "@/components/ui/select";
import { api } from "@/components/tasks/tasks-api";
import { currencyInfo, currencyOptions } from "@/lib/currencies";
import { formatMoney } from "@/lib/money";
import type { InvoiceSettings, PaymentGatewayInfo } from "@/lib/studio-settings";
import type { StripeStatus } from "@/lib/stripe-connect";
import { countryName, countryOptions, isLocalGateway, recommendationLine } from "@/lib/payment-gateways";
import { StripeConnectCard } from "./stripe-connect-card";
import { LocalGatewayCard } from "./local-gateway-card";

const PREVIEW_AMOUNTS = ["1250.5", "99", "0"];

/** Workspace currency: a searchable picker (code, name, symbol) and a live formatting preview. */
export function CurrencySettingsForm({ workspaceId, initial, canEdit }: { workspaceId: string; initial: InvoiceSettings; canEdit: boolean }) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial.currency);
  const [code, setCode] = useState(initial.currency);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = useMemo(() => currencyOptions(), []);
  const info = currencyInfo(code);

  async function save() {
    setBusy(true); setError(null);
    try {
      const next = await api<InvoiceSettings>(`workspaces/${workspaceId}/billing/settings/`, "PATCH", { currency: code });
      setSaved(next.currency); setCode(next.currency);
      toast(`Workspace currency set to ${next.currency}`, { description: "Sent and paid invoices keep their original currency." });
      router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "That didn't save."); } finally { setBusy(false); }
  }

  return <div className="settings-form billing-currency" aria-label="Workspace currency">
    <div className="billing-currency-row">
      <label className="billing-currency-picker"><span>Workspace currency</span>
        <Select options={options} value={code} onValueChange={setCode} searchable disabled={!canEdit || busy} aria-label="Workspace currency" placeholder="Choose a currency" />
        <small className="settings-hint">{canEdit ? "Used for prices, pay and new invoices. Search by code, name or symbol." : "Only workspace owners and admins can change this."}</small>
      </label>
      <div className="billing-currency-preview" aria-live="polite">
        <span className="billing-currency-badge" aria-hidden="true">{info.symbol}</span>
        <div><strong>{info.code} · {info.name}</strong><small>{info.digits === 0 ? "No decimal places" : `${info.digits} decimal places`}</small></div>
        <ul aria-label="Formatting preview">{PREVIEW_AMOUNTS.map((amount) => <li key={amount}>{formatMoney(amount, code)}</li>)}</ul>
      </div>
    </div>
    {code !== saved && <p className="settings-hint billing-currency-note">Amounts are not converted. Prices, rates and unsent drafts switch to {code}; sent and paid invoices stay in {saved}.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {canEdit && <button type="button" className="settings-button" disabled={busy || code === saved} onClick={() => void save()}>
      {busy ? <Loader2 size={15} className="spin" /> : <Save size={15} />}{busy ? "Saving…" : "Save currency"}
    </button>}
  </div>;
}

/** Workspace country: drives which gateway Blaze Flow recommends (it never limits the choice). */
export function CountrySettingsForm({ workspaceId, initial, canEdit }: { workspaceId: string; initial: InvoiceSettings; canEdit: boolean }) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial.country ?? "");
  const [code, setCode] = useState(initial.country || initial.effective_country || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = useMemo(() => countryOptions(), []);
  const reco = initial.effective_country && initial.recommended_gateways?.length ? recommendationLine(initial.effective_country, initial.recommended_gateways) : "";

  async function save() {
    setBusy(true); setError(null);
    try {
      const next = await api<InvoiceSettings>(`workspaces/${workspaceId}/billing/settings/`, "PATCH", { country: code });
      setSaved(next.country ?? ""); toast(`Billing country set to ${countryName(code)}`);
      router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "That didn't save."); } finally { setBusy(false); }
  }

  return <div className="settings-form billing-country" aria-label="Billing country">
    <label className="billing-currency-picker"><span><Globe size={14} aria-hidden="true" />Business country</span>
      <Select options={options} value={code} onValueChange={setCode} searchable disabled={!canEdit || busy} aria-label="Business country" placeholder="Choose a country" />
      <small className="settings-hint">{canEdit ? "We recommend the payment gateway that works best there." : "Only workspace owners and admins can change this."}</small>
    </label>
    {reco && <p className="billing-reco" role="note"><Sparkles size={14} aria-hidden="true" />{reco}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {canEdit && code !== saved && code && <button type="button" className="settings-button" disabled={busy} onClick={() => void save()}>
      {busy ? <Loader2 size={15} className="spin" /> : <Save size={15} />}{busy ? "Saving…" : "Save country"}
    </button>}
  </div>;
}

/**
 * Payment gateways: Stripe Connect, the local merchant-key gateways (PayMongo, Safepay,
 * SSLCOMMERZ) and the "Coming soon" ones. The server sorts recommended gateways first.
 */
export function PaymentGatewaysCard({ gateways, workspaceId, stripe, canManage = false, workspaceCurrency = "USD" }: {
  gateways: PaymentGatewayInfo[]; workspaceId?: string; stripe?: StripeStatus | null; canManage?: boolean; workspaceCurrency?: string;
}) {
  const stripeReco = gateways.find((gateway) => gateway.key === "stripe")?.recommended;
  const rest = gateways.filter((gateway) => !(stripe && workspaceId && gateway.key === "stripe"));
  const local = workspaceId ? rest.filter(isLocalGateway) : [];
  const others = rest.filter((gateway) => !local.includes(gateway as never));
  const stripeCard = stripe && workspaceId ? <div className={stripeReco ? "gateway-stripe is-recommended" : "gateway-stripe"}>
    {stripeReco && <span className="gateway-reco is-floating"><Sparkles aria-hidden="true" />Recommended</span>}
    <StripeConnectCard workspaceId={workspaceId} initial={stripe} /></div> : null;
  return <div className="billing-gateways">
    <div className="billing-gateways-head"><Wallet aria-hidden="true" /><div><h3>Payment gateways</h3><p>Let clients pay invoices online. Payments taken by a gateway mark invoices paid automatically. Turn on more than one and clients choose when they pay.</p></div></div>
    {stripeReco !== false && stripeCard}
    {local.filter((gateway) => gateway.recommended).map((gateway) => <LocalGatewayCard key={gateway.key} workspaceId={workspaceId!} initial={gateway} canManage={canManage} workspaceCurrency={workspaceCurrency} />)}
    {stripeReco === false && stripeCard}
    {local.filter((gateway) => !gateway.recommended).map((gateway) => <LocalGatewayCard key={gateway.key} workspaceId={workspaceId!} initial={gateway} canManage={canManage} workspaceCurrency={workspaceCurrency} />)}
    {others.length > 0 && <ul>
      {others.map((gateway) => <li key={gateway.key}>
        <span className="billing-gateway-logo" aria-hidden="true">{gateway.name.slice(0, 1)}</span>
        <span><strong>{gateway.name}</strong><small>{gateway.description}</small></span>
        <button type="button" className="settings-button is-ghost" disabled title="Coming soon">{gateway.status === "not_configured" ? "Not configured" : "Coming soon"}</button>
      </li>)}
    </ul>}
  </div>;
}
