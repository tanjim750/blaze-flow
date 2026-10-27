"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, Info, Loader2, LockKeyhole } from "@/components/icons";
import { formatMoney } from "@/lib/money";
import { formatDate, type InvoiceDetail } from "@/lib/money-view";
import { goTo, onlinePaymentNote, publicCheckout } from "@/lib/stripe-connect";
import { PayChooser, PROVIDER_NAME, useGatewayChoice } from "@/components/money/pay-chooser";
import { ManualPayPanel } from "@/components/money/manual-pay";
import { claimPublicPayment, payHint } from "@/lib/payment-gateways";

export type PublicInvoice = InvoiceDetail & { studio_name: string };

/** The public pay page body: invoice summary, Pay now, and the gateway return states. */
export function PublicPayView({ token, invoice, back, provider = null }: { token: string; invoice: PublicInvoice; back: "success" | "cancel" | "fail" | null; provider?: string | null }) {
  const gateways = useGatewayChoice(invoice.payment_options);
  const via = provider ? PROVIDER_NAME[provider] ?? "the payment provider" : "Stripe";
  const chosen = gateways.list.find((option) => option.provider === gateways.choice);
  const manual = chosen?.kind === "manual" ? chosen : null;
  const hosted = new Set(gateways.list.filter((option) => option.available && option.kind !== "manual").map((option) => option.name));
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const money = (value: string) => formatMoney(value, invoice.currency);
  const paid = invoice.status === "paid" || Number(invoice.outstanding) <= 0;
  const waiting = back === "success" && !paid;
  const note = onlinePaymentNote(invoice.online_payment);

  useEffect(() => {
    if (!waiting) return;
    let tries = 0;
    const timer = window.setInterval(() => { tries += 1; router.refresh(); if (tries >= 5) window.clearInterval(timer); }, 2500);
    return () => window.clearInterval(timer);
  }, [waiting, router]);

  async function pay() {
    setBusy(true); setError(null);
    try { goTo.url((await publicCheckout(token, gateways.choice ?? undefined)).url); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't open the payment page."); setBusy(false); }
  }

  return <main className="pay-shell">
    <header className="pay-studio"><span className="pay-monogram" aria-hidden="true">{invoice.studio_name.slice(0, 1).toUpperCase() || "B"}</span><div><strong>{invoice.studio_name}</strong><small>Invoice {invoice.number}</small></div></header>
    <section className="pay-card" aria-label={`Invoice ${invoice.number}`}>
      {paid && <p className="pay-banner tone-success" role="status"><CircleCheck aria-hidden="true" />{back === "success" ? "Payment received. Thank you!" : "This invoice is paid. Thank you!"}</p>}
      {waiting && <p className="pay-banner tone-info" role="status"><Loader2 aria-hidden="true" className="pay-spin" />Thanks! We&rsquo;re confirming your payment with {via}. This page updates in a moment.</p>}
      {back === "fail" && !paid && <p className="pay-banner tone-warning" role="status"><Info aria-hidden="true" />{via} couldn&rsquo;t complete the payment. Nothing was charged; you can try again.</p>}
      {back === "cancel" && !paid && <p className="pay-banner tone-warning" role="status"><Info aria-hidden="true" />Payment cancelled. Nothing was charged.</p>}
      <div className="pay-amount">
        <small>{paid ? "Total paid" : "Amount due"}</small>
        <strong>{money(paid ? invoice.total : invoice.outstanding)}</strong>
        <span>{invoice.due_date && !paid ? `Due ${formatDate(invoice.due_date)} · ` : ""}Billed to {invoice.bill_to.name}</span>
      </div>
      <table className="pay-lines">
        <tbody>{invoice.lines.map((line) => <tr key={line.id}><td>{line.description || "—"}</td><td>{money(line.amount)}</td></tr>)}</tbody>
        <tfoot>
          <tr><th>Total</th><td>{money(invoice.total)}</td></tr>
          {Number(invoice.paid) > 0 && <tr><th>Paid</th><td>−{money(invoice.paid)}</td></tr>}
          <tr className="is-balance"><th>Balance due</th><td>{money(invoice.outstanding)}</td></tr>
        </tfoot>
      </table>
      {!paid && invoice.online_payment?.available && <p className="pay-hint" role="note"><Info aria-hidden="true" /><span>{payHint(gateways.list.filter((o) => o.available).map((o) => o.kind === "manual"))}</span></p>}
      {!paid && invoice.online_payment?.available && gateways.showChooser && <PayChooser options={gateways.list} value={gateways.choice} onChange={gateways.setChoice} disabled={busy || waiting} />}
      {!paid && manual && <ManualPayPanel key={manual.provider} option={manual} studio={invoice.studio_name} onClaim={(data) => claimPublicPayment(token, data)} />}
      {!paid && invoice.online_payment?.available && !manual && <button type="button" className="pay-button" disabled={busy || waiting} onClick={() => void pay()}>
        {busy ? <Loader2 aria-hidden="true" className="pay-spin" /> : <LockKeyhole aria-hidden="true" />}Pay {money(invoice.outstanding)} now{gateways.showChooser && chosen ? ` with ${chosen.name}` : ""}</button>}
      {error && <p className="pay-error" role="alert">{error}</p>}
      {!paid && note && <p className="pay-muted">{note}</p>}
      {!paid && !invoice.online_payment?.available && !note && <p className="pay-muted">Online payment isn&rsquo;t available for this invoice right now. Please contact {invoice.studio_name}.</p>}
      {hosted.size > 0 && !manual && <p className="pay-muted pay-secure"><LockKeyhole aria-hidden="true" />Payment details are entered on {hosted.size > 1 ? "the provider" : [...hosted][0] ?? "Stripe"}&rsquo;s secure page; {invoice.studio_name} and Blaze Flow never see them.</p>}
    </section>
    <footer className="pay-foot">Powered by <strong>Blaze Flow</strong> · Payments by {gateways.list.some((o) => o.available) ? gateways.list.filter((o) => o.available).map((o) => o.name).join(", ") : "Stripe"}</footer>
  </main>;
}

