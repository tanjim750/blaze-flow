"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, ExternalLink, Loader2, RefreshCw, Unlink, X } from "@/components/icons";
import {
  connectStripe, disconnectStripe, getStripeStatus, goTo, requirementLabel, STRIPE_STATUS, stripeDashboard, type StripeStatus,
} from "@/lib/stripe-connect";

type Busy = null | "connect" | "dashboard" | "refresh" | "disconnect";

/**
 * Settings → Billing & currency → Stripe. Owners/admins connect the workspace's own Stripe
 * account (Stripe-hosted onboarding), check its status, open the Stripe dashboard or unlink it.
 * Coming back from Stripe (`?stripe=return`) refreshes the status; an expired onboarding link
 * (`?stripe=refresh`) asks Stripe for a new one straight away.
 */
export function StripeConnectCard({ workspaceId, initial }: { workspaceId: string; initial: StripeStatus }) {
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);
  const info = STRIPE_STATUS[status.status] ?? STRIPE_STATUS.not_connected;
  const manage = status.can_manage && status.configured;

  async function run(kind: Busy, action: () => Promise<void>) {
    setBusy(kind); setError(null);
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Stripe didn't respond. Try again."); }
    finally { setBusy(null); }
  }
  const onboard = () => run("connect", async () => { const next = await connectStripe(workspaceId); setStatus(next); goTo.url(next.url); });
  const refresh = (announce = false) => run("refresh", async () => {
    const next = await getStripeStatus(workspaceId, true); setStatus(next);
    if (announce) toast(next.status === "active" ? "Stripe is connected and active" : `Stripe: ${STRIPE_STATUS[next.status]?.label ?? next.status}`);
  });

  useEffect(() => {
    if (handled.current || typeof window === "undefined") return;
    handled.current = true;
    const url = new URL(window.location.href);
    const back = url.searchParams.get("stripe");
    if (!back) return;
    url.searchParams.delete("stripe");
    window.history.replaceState(null, "", url.toString());
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-off reaction to returning from Stripe
    if (back === "return" && status.connected) void refresh(true);
    else if (back === "refresh" && manage) void onboard();
  });

  const due = status.requirements_due ?? [];
  return <div className={`stripe-card tone-${info.tone}`} aria-label="Stripe">
    <div className="stripe-card-head">
      <span className="stripe-logo" aria-hidden="true">S</span>
      <div className="stripe-card-title">
        <strong>Stripe</strong>
        <small>Cards, Apple Pay and Google Pay. Clients pay you directly; Stripe pays out to your bank.</small>
      </div>
      {status.configured && <span className={`stripe-status tone-${info.tone}`} role="status">{info.label}</span>}
    </div>

    {!status.configured ? <p className="stripe-note is-muted">{status.not_configured_message ?? "Stripe not configured on this server."}</p> : <>
      <p className="stripe-note">{info.help}</p>
      {status.connected && <ul className="stripe-flags" aria-label="Stripe capabilities">
        <li className={status.charges_enabled ? "is-on" : ""}>{status.charges_enabled ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}Payments {status.charges_enabled ? "enabled" : "not enabled yet"}</li>
        <li className={status.payouts_enabled ? "is-on" : ""}>{status.payouts_enabled ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}Payouts {status.payouts_enabled ? "enabled" : "not enabled yet"}</li>
        {status.account_id && <li className="is-id">Account {status.account_id}{status.country ? ` · ${status.country}` : ""}{status.default_currency ? ` · ${status.default_currency}` : ""}</li>}
      </ul>}
      {due.length > 0 && <p className="stripe-note is-warn">Stripe needs: {due.slice(0, 4).map(requirementLabel).join(", ")}{due.length > 4 ? ` and ${due.length - 4} more` : ""}.</p>}
      {Number(status.platform_fee_percent) > 0 && <p className="stripe-note is-muted">Blaze Flow adds a {status.platform_fee_percent}% platform fee to each online payment, on top of Stripe&rsquo;s own fees.</p>}
      {!status.can_manage && <p className="stripe-note is-muted">Only workspace owners and admins can connect or change Stripe.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {manage && <div className="stripe-actions">
        {status.status === "not_connected" && <button type="button" className="settings-button stripe-primary" disabled={busy !== null} onClick={() => void onboard()}>
          {busy === "connect" ? <Loader2 size={15} className="spin" /> : <ExternalLink size={15} />}Connect Stripe</button>}
        {(status.status === "onboarding" || status.status === "needs_info") && <button type="button" className="settings-button stripe-primary" disabled={busy !== null} onClick={() => void onboard()}>
          {busy === "connect" ? <Loader2 size={15} className="spin" /> : <ExternalLink size={15} />}{status.status === "onboarding" ? "Continue onboarding" : "Add missing details"}</button>}
        {status.details_submitted && <button type="button" className="settings-button" disabled={busy !== null} onClick={() => void run("dashboard", async () => goTo.url((await stripeDashboard(workspaceId)).url))}>
          {busy === "dashboard" ? <Loader2 size={15} className="spin" /> : <ExternalLink size={15} />}Open Stripe dashboard</button>}
        {status.connected && <button type="button" className="settings-button is-quiet" disabled={busy !== null} onClick={() => void refresh(true)}>
          {busy === "refresh" ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}Check status</button>}
        {status.connected && <button type="button" className="settings-button is-quiet is-danger" disabled={busy !== null} onClick={() => {
          if (!confirm("Disconnect Stripe from this workspace? Clients won't see Pay now any more. Your Stripe account, balance and payouts are not affected.")) return;
          void run("disconnect", async () => { setStatus(await disconnectStripe(workspaceId)); toast("Stripe disconnected"); });
        }}>{busy === "disconnect" ? <Loader2 size={15} className="spin" /> : <Unlink size={15} />}Disconnect</button>}
      </div>}
    </>}
  </div>;
}
