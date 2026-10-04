"use client";
/**
 * One invoice as a printable page: studio and client addresses, the priced items, payments
 * received and the balance. Managers get Send / Record payment / Mark as paid (demo); a
 * client sees the same page read-only. Print uses the browser (print-to-PDF), with the app
 * chrome hidden by `@media print` in money.css.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Banknote, CircleDollarSign, Printer, Send, Trash2 } from "lucide-react";
import { formatMoney, toMinor } from "@/lib/money";
import { addressLines, dueLabel, formatDate, invoiceBadge, methodLabel, type InvoiceDetail } from "@/lib/money-view";
import { deleteInvoice, recordInvoicePayment, sendInvoice } from "./billing-client";
import { markInvoicePaid } from "./money-board";
import { PaymentDialog } from "./payment-dialog";

export function InvoiceView({ workspaceId, invoice, canManage, backHref, now }: { workspaceId: string; invoice: InvoiceDetail; canManage: boolean; backHref: string; now: string }) {
  const router = useRouter();
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const badge = invoiceBadge(invoice);
  const money = (value: string) => formatMoney(value, invoice.currency);

  async function run(action: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try { await action(); if (done) toast(done); router.refresh(); }
    catch (reason) { toast.error(reason instanceof Error ? reason.message : "That didn't work."); }
    finally { setBusy(false); }
  }

  return <div className="money-page invoice-page">
    <div className="invoice-toolbar">
      <Link href={backHref} className="money-button is-ghost"><ArrowLeft aria-hidden="true" />{backHref === "/money" ? "Money" : "Dashboard"}</Link>
      <span className="money-badges"><span className={`money-badge tone-${badge.tone}`}>{badge.label}</span>{badge.partial && <span className="money-badge tone-warning">Part-paid</span>}</span>
      <span className="invoice-due">{dueLabel(invoice, new Date(now))}</span>
      <span className="money-spacer" />
      {canManage && invoice.status === "draft" && <>
        <button type="button" className="money-button is-ghost" disabled={busy} onClick={() => { if (confirm(`Delete draft ${invoice.number}?`)) void run(async () => { await deleteInvoice(workspaceId, invoice.id); router.push("/money"); }, `${invoice.number} deleted`); }}><Trash2 aria-hidden="true" />Delete draft</button>
        <button type="button" className="money-button is-primary" disabled={busy} onClick={() => void run(() => sendInvoice(workspaceId, invoice.id), `${invoice.number} marked as sent`)}><Send aria-hidden="true" />Mark as sent</button>
      </>}
      {canManage && invoice.status === "sent" && <>
        <button type="button" className="money-button" disabled={busy} onClick={() => setPaying(true)}><Banknote aria-hidden="true" />Record payment</button>
        <button type="button" className="money-button is-primary" disabled={busy} onClick={() => void run(() => markInvoicePaid(workspaceId, invoice))}><CircleDollarSign aria-hidden="true" />Mark as paid (demo)</button>
      </>}
      <button type="button" className="money-button" onClick={() => window.print()}><Printer aria-hidden="true" />Print</button>
    </div>

    <article className="invoice-paper" aria-label={`Invoice ${invoice.number}`}>
      <header className="invoice-head">
        <div><strong className="invoice-from">{invoice.from.name}</strong>{addressLines(invoice.from).map((line) => <span key={line}>{line}</span>)}</div>
        <div className="invoice-title"><h1>Invoice</h1><span>{invoice.number}</span></div>
      </header>
      <section className="invoice-meta">
        <div><small>Bill to</small><strong>{invoice.bill_to.name}</strong>{addressLines(invoice.bill_to).map((line) => <span key={line}>{line}</span>)}</div>
        <dl>
          <div><dt>Issued</dt><dd>{invoice.issue_date ? formatDate(invoice.issue_date) : "Not sent yet"}</dd></div>
          <div><dt>Due</dt><dd>{formatDate(invoice.due_date)}</dd></div>
          {invoice.project && <div><dt>Project</dt><dd>{invoice.project.name}</dd></div>}
          <div><dt>Currency</dt><dd>{invoice.currency}</dd></div>
        </dl>
      </section>
      <table className="invoice-lines">
        <thead><tr><th>Description</th><th>Amount</th></tr></thead>
        <tbody>{invoice.lines.map((line) => <tr key={line.id}><td>{line.description}<small>{line.kind === "project_fee" ? "Project fee" : "Deliverable"}</small></td><td>{money(line.amount)}</td></tr>)}</tbody>
        <tfoot>
          <tr><th>Total</th><td>{money(invoice.total)}</td></tr>
          {toMinor(invoice.paid) > 0 && <tr><th>Paid</th><td>−{money(invoice.paid)}</td></tr>}
          <tr className="is-balance"><th>Balance due</th><td>{money(invoice.outstanding)}</td></tr>
        </tfoot>
      </table>
      {invoice.payments.length > 0 && <section className="invoice-payments">
        <h2>Payments received</h2>
        <ul>{invoice.payments.map((payment) => <li key={payment.id}>
          <span>{formatDate(payment.paid_on)}</span><span>{methodLabel(payment.method)}{payment.note ? ` · ${payment.note}` : ""}</span><b>{formatMoney(payment.amount, payment.currency)}</b>
        </li>)}</ul>
      </section>}
      {invoice.notes && <p className="invoice-notes">{invoice.notes}</p>}
    </article>

    {paying && <PaymentDialog title={`Record a payment on ${invoice.number}`} description={`${invoice.bill_to.name} · ${money(invoice.outstanding)} outstanding`}
      maxAmount={invoice.outstanding} currency={invoice.currency} onClose={() => setPaying(false)}
      onSubmit={async (payment) => { await recordInvoicePayment(workspaceId, invoice.id, payment); toast(`Payment recorded on ${invoice.number}`); setPaying(false); router.refresh(); }} />}
  </div>;
}
