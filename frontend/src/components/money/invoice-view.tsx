"use client";
import "@/app/(app)/tasks/tasks.css";

import { useAppRouter } from "@/lib/app-router";/**
 * One invoice as a printable page: studio and client addresses, the priced items, payments
 * received and the balance. On a draft, managers get an editor (lines, discount, tax, due
 * date, notes) with the page below as its live preview, plus "Preview as client". Sending
 * asks first and shows the due date it will set; a sent invoice with no payment can go back
 * to draft. A client sees the same page read-only. Print uses the browser (print-to-PDF),
 * with the app chrome hidden by `@media print` in money.css.
 */
import Link from "next/link";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Banknote, CircleDollarSign, Eye, PencilLine, Plus, Printer, Save, Send, Trash2, Undo2, X } from "@/components/icons";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { formatMoney, fromMinor, parseMoneyInput, toMinor } from "@/lib/money";
import { addressLines, dueLabel, formatDate, invoiceBadge, invoiceTotals, LINE_KIND, methodLabel, settleLabel, type InvoiceDetail, type InvoiceLine } from "@/lib/money-view";
import { deleteInvoice, recordInvoicePayment, revertInvoice, sendInvoice, updateInvoice, type InvoiceEdit } from "./billing-client";
import { markInvoicePaid } from "./money-board";
import { PaymentDialog } from "./payment-dialog";
import { sentMessage } from "@/lib/invoice-send";

type DraftLine = { key: string; id?: string; kind: InvoiceLine["kind"]; description: string; amount: string };
type Draft = { lines: DraftLine[]; discount: string; taxRate: string; dueDate: string; notes: string };

function draftOf(invoice: InvoiceDetail): Draft {
  return {
    lines: invoice.lines.map((line) => ({ key: line.id, id: line.id, kind: line.kind, description: line.description, amount: line.amount })),
    discount: toMinor(invoice.discount_amount) > 0 ? invoice.discount_amount ?? "" : "",
    taxRate: Number(invoice.tax_rate) > 0 ? String(Number(invoice.tax_rate)) : "",
    dueDate: invoice.due_date ?? "", notes: invoice.notes ?? "",
  };
}

/** The edit as the API wants it, or the first problem to show. */
export function editPayload(draft: Draft): { edit: InvoiceEdit } | { error: string } {
  const lines: NonNullable<InvoiceEdit["lines"]> = [];
  for (const line of draft.lines) {
    if (!line.description.trim()) return { error: "Every line needs a description." };
    const amount = parseMoneyInput(line.amount);
    if ("error" in amount) return { error: `${line.description.trim()}: ${amount.error}` };
    lines.push({ ...(line.id ? { id: line.id } : {}), description: line.description.trim(), amount: amount.amount ?? "0.00" });
  }
  const discount = parseMoneyInput(draft.discount);
  if ("error" in discount) return { error: `Discount: ${discount.error}` };
  const rate = draft.taxRate.trim() === "" ? 0 : Number(draft.taxRate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return { error: "Tax rate is a percentage between 0 and 100." };
  return { edit: { lines, discount_amount: discount.amount ?? "0", tax_rate: String(rate), due_date: draft.dueDate || null, notes: draft.notes } };
}

export function InvoiceView({ workspaceId, invoice, canManage, backHref, now }: { workspaceId: string; invoice: InvoiceDetail; canManage: boolean; backHref: string; now: string }) {
  const router = useAppRouter();
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOf(invoice));
  const [seen, setSeen] = useState(invoice);
  if (seen !== invoice) { setSeen(invoice); setDraft(draftOf(invoice)); }
  const editable = canManage && invoice.status === "draft";
  const editing = editable && !previewing;
  const dirty = editable && JSON.stringify(draftOf(invoice)) !== JSON.stringify(draft);
  const [emailClient, setEmailClient] = useState(true);
  const recipients = invoice.client_recipients ?? [];
  const willEmail = emailClient && recipients.length > 0;
  const badge = invoiceBadge(invoice);
  const money = (value: string | number) => formatMoney(value, invoice.currency);
  // The page shows the draft as edited (a live preview); saved values otherwise.
  const totals = useMemo(() => editable ? invoiceTotals(draft.lines, draft.discount, draft.taxRate) : invoiceTotals(invoice.lines, invoice.discount_amount ?? "0", invoice.tax_rate ?? "0"), [editable, draft, invoice]);
  const shownLines = editable ? draft.lines : invoice.lines.map((line) => ({ ...line, key: line.id }));
  const shownNotes = editable ? draft.notes : invoice.notes;
  const shownDue = editable ? draft.dueDate || null : invoice.due_date;
  const dueOnSend = draft.dueDate || invoice.default_due_date || null;

  async function run(action: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try { await action(); if (done) toast(done); router.refresh(); return true; }
    catch (reason) { toast.error(reason instanceof Error ? reason.message : "That didn't work."); return false; }
    finally { setBusy(false); }
  }
  async function save() {
    const payload = editPayload(draft);
    if ("error" in payload) { toast.error(payload.error); return false; }
    return run(() => updateInvoice(workspaceId, invoice.id, payload.edit), `${invoice.number} saved`);
  }
  const patchLine = (key: string, change: Partial<DraftLine>) => setDraft((current) => ({ ...current, lines: current.lines.map((line) => line.key === key ? { ...line, ...change } : line) }));

  return <div className="money-page invoice-page">
    <div className="invoice-toolbar">
      <Link href={backHref} className="money-button is-ghost"><ArrowLeft aria-hidden="true" />{backHref === "/money" ? "Money" : "Dashboard"}</Link>
      <span className="money-badges"><span className={`money-badge tone-${badge.tone}`}>{badge.label}</span>{badge.partial && <span className="money-badge tone-warning">Part-paid</span>}</span>
      <span className="invoice-due">{dueLabel(invoice, new Date(now))}</span>
      <span className="money-spacer" />
      {editable && <>
        <button type="button" className="money-button is-ghost" disabled={busy} onClick={() => { if (confirm(`Delete draft ${invoice.number}?`)) void run(async () => { await deleteInvoice(workspaceId, invoice.id); router.push("/money"); }, `${invoice.number} deleted`); }}><Trash2 aria-hidden="true" />Delete draft</button>
        <button type="button" className="money-button" aria-pressed={previewing} onClick={() => setPreviewing((value) => !value)}>{previewing ? <><PencilLine aria-hidden="true" />Back to editing</> : <><Eye aria-hidden="true" />Preview as client</>}</button>
        <button type="button" className="money-button is-primary" disabled={busy} onClick={() => setConfirmSend(true)}><Send aria-hidden="true" />{recipients.length ? "Send to client" : "Mark as sent"}</button>
      </>}
      {canManage && invoice.status === "sent" && <>
        {invoice.can_revert && <button type="button" className="money-button is-ghost" disabled={busy} onClick={() => { if (confirm(`Move ${invoice.number} back to draft? The client stops seeing it until you send it again.`)) void run(() => revertInvoice(workspaceId, invoice.id), `${invoice.number} is a draft again`); }}><Undo2 aria-hidden="true" />Revert to draft</button>}
        <button type="button" className="money-button" disabled={busy} onClick={() => setPaying(true)}><Banknote aria-hidden="true" />Record payment</button>
        <button type="button" className="money-button is-primary" disabled={busy} onClick={() => void run(() => markInvoicePaid(workspaceId, invoice))}><CircleDollarSign aria-hidden="true" />{settleLabel(invoice, formatMoney)}</button>
      </>}
      <button type="button" className="money-button" onClick={() => window.print()}><Printer aria-hidden="true" />Print</button>
    </div>

    {editable && previewing && <p className="invoice-preview-note" role="status"><Eye aria-hidden="true" />Preview: this is what {invoice.bill_to.name} sees once it&rsquo;s sent.{dirty ? " Includes unsaved changes." : ""}</p>}

    {editing && <section className="invoice-editor" aria-label="Edit draft">
      <header><h2><PencilLine aria-hidden="true" />Edit draft</h2><small>The invoice below updates as you type.</small></header>
      <ul className="invoice-editor-lines">
        {draft.lines.map((line, index) => <li key={line.key}>
          <label className="invoice-field is-grow"><span>{LINE_KIND[line.kind]}</span><input value={line.description} maxLength={255} aria-label={`Line ${index + 1} description`} onChange={(event) => patchLine(line.key, { description: event.target.value })} /></label>
          <label className="invoice-field is-amount"><span>Amount</span><span className="pp-input"><i>{invoice.currency}</i><input inputMode="decimal" value={line.amount} aria-label={`Line ${index + 1} amount`} onChange={(event) => patchLine(line.key, { amount: event.target.value })} /></span></label>
          <button type="button" className="money-button is-ghost is-icon" aria-label={`Remove ${line.description || `line ${index + 1}`}`} onClick={() => setDraft((current) => ({ ...current, lines: current.lines.filter((item) => item.key !== line.key) }))}><X aria-hidden="true" /></button>
        </li>)}
      </ul>
      <button type="button" className="money-button is-sm" onClick={() => setDraft((current) => ({ ...current, lines: [...current.lines, { key: `new-${Date.now()}`, kind: "manual", description: "", amount: "" }] }))}><Plus aria-hidden="true" />Add line</button>
      <div className="invoice-editor-grid">
        <label className="invoice-field"><span>Discount</span><span className="pp-input"><i>{invoice.currency}</i><input inputMode="decimal" placeholder="0.00" value={draft.discount} onChange={(event) => setDraft({ ...draft, discount: event.target.value })} /></span></label>
        <label className="invoice-field"><span>Tax rate (%)</span><input inputMode="decimal" placeholder="0" value={draft.taxRate} onChange={(event) => setDraft({ ...draft, taxRate: event.target.value })} /></label>
        <label className="invoice-field"><span>Due date</span><input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label>
        <label className="invoice-field is-wide"><span>Notes for the client</span><textarea rows={2} maxLength={2000} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
      </div>
      <footer>
        {dirty && <button type="button" className="money-button is-ghost" disabled={busy} onClick={() => setDraft(draftOf(invoice))}>Discard changes</button>}
        <button type="button" className="money-button is-primary" disabled={busy || !dirty} onClick={() => void save()}><Save aria-hidden="true" />{dirty ? "Save changes" : "Saved"}</button>
      </footer>
    </section>}

    <article className="invoice-paper" aria-label={`Invoice ${invoice.number}`}>
      <header className="invoice-head">
        <div><strong className="invoice-from">{invoice.from.name}</strong>{addressLines(invoice.from).map((line) => <span key={line}>{line}</span>)}</div>
        <div className="invoice-title"><h1>Invoice</h1><span>{invoice.number}</span></div>
      </header>
      <section className="invoice-meta">
        <div><small>Bill to</small><strong>{invoice.bill_to.name}</strong>{addressLines(invoice.bill_to).map((line) => <span key={line}>{line}</span>)}</div>
        <dl>
          <div><dt>Issued</dt><dd>{invoice.issue_date ? formatDate(invoice.issue_date) : "Not sent yet"}</dd></div>
          <div><dt>Due</dt><dd>{formatDate(shownDue)}</dd></div>
          {invoice.project && <div><dt>Project</dt><dd>{invoice.project.name}</dd></div>}
          <div><dt>Currency</dt><dd>{invoice.currency}</dd></div>
        </dl>
      </section>
      <table className="invoice-lines">
        <thead><tr><th>Description</th><th>Amount</th></tr></thead>
        <tbody>{shownLines.map((line) => <tr key={line.key}><td>{line.description || "—"}<small>{LINE_KIND[line.kind]}</small></td><td>{money(fromMinor(toMinor(line.amount)))}</td></tr>)}</tbody>
        <tfoot>
          {(totals.discount > 0 || totals.tax > 0) && <tr><th>Subtotal</th><td>{money(fromMinor(totals.subtotal))}</td></tr>}
          {totals.discount > 0 && <tr><th>Discount</th><td>−{money(fromMinor(totals.discount))}</td></tr>}
          {totals.tax > 0 && <tr><th>Tax ({Number(editable ? draft.taxRate : invoice.tax_rate)}%)</th><td>{money(fromMinor(totals.tax))}</td></tr>}
          <tr><th>Total</th><td>{money(fromMinor(totals.total))}</td></tr>
          {toMinor(invoice.paid) > 0 && <tr><th>Paid</th><td>−{money(invoice.paid)}</td></tr>}
          <tr className="is-balance"><th>Balance due</th><td>{money(fromMinor(Math.max(totals.total - toMinor(invoice.paid), 0)))}</td></tr>
        </tfoot>
      </table>
      {invoice.payments.length > 0 && <section className="invoice-payments">
        <h2>Payments received</h2>
        <ul>{invoice.payments.map((payment) => <li key={payment.id}>
          <span>{formatDate(payment.paid_on)}</span><span>{methodLabel(payment.method)}{payment.note ? ` · ${payment.note}` : ""}</span><b>{formatMoney(payment.amount, payment.currency)}</b>
        </li>)}</ul>
      </section>}
      {shownNotes && <p className="invoice-notes">{shownNotes}</p>}
    </article>

    {confirmSend && <Dialog open onOpenChange={(next) => { if (!next && !busy) setConfirmSend(false); }}>
      <DialogContent className="money-dialog">
        <div className="money-form">
          <header className="money-dialog-head"><DialogTitle>{recipients.length ? `Send ${invoice.number}?` : `Mark ${invoice.number} as sent?`}</DialogTitle><DialogDescription>{recipients.length ? "The client gets an email with the amount, due date and a link to view the invoice in their portal." : "This client has no email address or portal contacts yet, so nothing will be emailed. The invoice is still marked as sent."}</DialogDescription><DialogClose /></header>
          <dl className="invoice-confirm is-wide">
            <div><dt>Total</dt><dd>{money(fromMinor(totals.total))}</dd></div>
            <div><dt>Due date</dt><dd>{dueOnSend ? formatDate(dueOnSend) : "—"}{!draft.dueDate && dueOnSend ? " (from your payment terms)" : ""}</dd></div>
          </dl>
          {recipients.length > 0 && <div className="invoice-send is-wide">
            <label className="invoice-send-toggle"><input type="checkbox" checked={emailClient} onChange={(event) => setEmailClient(event.target.checked)} />Email the invoice to the client</label>
            {emailClient && <ul aria-label="Recipients">{recipients.map((email) => <li key={email}>{email}</li>)}</ul>}
          </div>}
          {dirty && <p className="pp-muted is-wide">Your unsaved changes are saved first.</p>}
          <p className="pp-muted is-wide">You can revert it to a draft until a payment is recorded.</p>
          <footer className="is-wide">
            <button type="button" className="money-button" onClick={() => setConfirmSend(false)}>Cancel</button>
            <button type="button" className="money-button is-primary" disabled={busy} onClick={async () => {
              if (dirty && !(await save())) return;
              if (await run(async () => { const sent = await sendInvoice(workspaceId, invoice.id, willEmail); toast(sentMessage(invoice.number, sent.emailed_to ?? [])); })) setConfirmSend(false);
            }}><Send aria-hidden="true" />{willEmail ? "Send invoice" : "Mark as sent"}</button>
          </footer>
        </div>
      </DialogContent>
    </Dialog>}

    {paying && <PaymentDialog title={`Record a payment on ${invoice.number}`} description={`${invoice.bill_to.name} · ${money(invoice.outstanding)} outstanding`}
      maxAmount={invoice.outstanding} currency={invoice.currency} onClose={() => setPaying(false)}
      onSubmit={async (payment) => { await recordInvoicePayment(workspaceId, invoice.id, payment); toast(`Payment recorded on ${invoice.number}`); setPaying(false); router.refresh(); }} />}
  </div>;
}
