"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, CircleCheck, Clock, Copy, ExternalLink, Info, Loader2, X } from "@/components/icons";
import { formatMoney } from "@/lib/money";
import type { ClaimInput, PaymentClaim, PaymentOption } from "@/lib/payment-gateways";
import "./pay-chooser.css";

function copy(text: string, what: string) {
  void navigator.clipboard?.writeText(text).then(() => toast(`${what} copied`), () => toast.error(`Couldn't copy. Select the ${what.toLowerCase()} and copy it.`));
}

/**
 * Pay by Wise / Payoneer: the studio's receiving details for this invoice's currency, the invoice
 * number to use as reference, an optional payment link, and "I've paid". Nothing is charged here;
 * the studio confirms the payment when it arrives.
 */
export function ManualPayPanel({ option, studio, onClaim }: { option: PaymentOption; studio: string; onClaim: (data: ClaimInput) => Promise<PaymentClaim> }) {
  const info = option.instructions;
  const [claim, setClaim] = useState<PaymentClaim | null>(info?.pending_claim ?? null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!info) return null;
  const amount = formatMoney(info.amount, info.currency);

  async function submit() {
    setBusy(true); setError(null);
    try { setClaim(await onClaim({ provider: option.provider, payer_name: name.trim(), payer_reference: reference.trim() })); setOpen(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "That didn't go through. Try again."); }
    finally { setBusy(false); }
  }

  return <section className="manual-pay" aria-label={`Pay by ${option.name}`}>
    <header><strong>Pay {amount} by {option.name}</strong><small>Send the payment from your bank or {option.name} account, then let {studio} know.</small></header>
    <dl className="manual-pay-facts">
      <div><dt>Amount</dt><dd>{amount}<button type="button" className="manual-copy" aria-label="Copy amount" onClick={() => copy(info.amount, "Amount")}><Copy aria-hidden="true" /></button></dd></div>
      <div><dt>Reference</dt><dd><code>{info.reference}</code><button type="button" className="manual-copy" aria-label="Copy reference" onClick={() => copy(info.reference, "Reference")}><Copy aria-hidden="true" /></button></dd></div>
    </dl>
    {info.account_details && <div className="manual-pay-details">
      <span>{info.currency} account details</span>
      <pre>{info.account_details}</pre>
      <button type="button" className="manual-copy is-text" onClick={() => copy(info.account_details, "Account details")}><Copy aria-hidden="true" />Copy details</button>
    </div>}
    {info.payment_link && <a className="manual-pay-link" href={info.payment_link} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" />{info.account_details ? `Or pay with the ${info.link_label}` : `Open the ${info.link_label}`}</a>}
    {info.note && <p className="manual-pay-note"><Info aria-hidden="true" />{info.note}</p>}
    {claim ? <p className="manual-pay-status" role="status"><Clock aria-hidden="true" />Thanks! {studio} has been told you paid{claim.payer_reference ? ` (ref ${claim.payer_reference})` : ""}. The invoice is marked paid once they confirm the money arrived.</p>
      : open ? <form className="manual-claim" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <label><span>Your name or company <em>optional</em></span><input value={name} maxLength={150} onChange={(event) => setName(event.target.value)} disabled={busy} /></label>
        <label><span>Transfer reference or ID <em>optional</em></span><input value={reference} maxLength={200} placeholder={`e.g. ${option.name} transfer #`} onChange={(event) => setReference(event.target.value)} disabled={busy} /></label>
        <div className="manual-claim-actions">
          <button type="submit" className="pay-button is-compact" disabled={busy}>{busy ? <Loader2 aria-hidden="true" className="pay-spin" /> : <Check aria-hidden="true" />}Confirm I&rsquo;ve paid</button>
          <button type="button" className="manual-cancel" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
        </div>
      </form>
      : <button type="button" className="pay-button" onClick={() => setOpen(true)}><CircleCheck aria-hidden="true" />I&rsquo;ve paid</button>}
    {error && <p className="pay-error" role="alert">{error}</p>}
    <p className="manual-pay-fine">Not processed by Krewsys. {option.name} fees, if any, are set by {option.name}.</p>
  </section>;
}

/** Team view: clients' "I've paid" claims waiting for a check. Confirm records the payment. */
export function PendingClaims({ claims, onResolve }: { claims: PaymentClaim[]; onResolve: (claim: PaymentClaim, action: "confirm" | "reject") => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!claims.length) return null;
  const name = (provider: string) => provider === "wise" ? "Wise" : provider === "payoneer" ? "Payoneer" : provider;
  return <section className="manual-claims" aria-label="Payments to confirm">
    <header><Clock aria-hidden="true" /><div><strong>Payment to confirm</strong><small>The client says they paid. Check your {claims.map((c) => name(c.provider)).filter((v, i, a) => a.indexOf(v) === i).join(" / ")} account before confirming.</small></div></header>
    <ul>{claims.map((claim) => <li key={claim.id}>
      <span><strong>{formatMoney(claim.amount, claim.currency)} by {name(claim.provider)}</strong>
        <small>{[claim.payer_name, claim.payer_reference && `ref ${claim.payer_reference}`, claim.created_at && new Date(claim.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })].filter(Boolean).join(" · ")}</small></span>
      <button type="button" className="money-button is-primary" disabled={busy !== null} onClick={() => { setBusy(claim.id); void onResolve(claim, "confirm").finally(() => setBusy(null)); }}>{busy === claim.id ? <Loader2 aria-hidden="true" className="spin" /> : <Check aria-hidden="true" />}Confirm received</button>
      <button type="button" className="money-button is-ghost" disabled={busy !== null} onClick={() => { if (confirm("Reject this claim? The invoice stays unpaid.")) { setBusy(claim.id); void onResolve(claim, "reject").finally(() => setBusy(null)); } }}><X aria-hidden="true" />Not received</button>
    </li>)}</ul>
  </section>;
}
