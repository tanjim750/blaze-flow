"use client";
/**
 * The Money page body: totals, receivables by client, payouts by editor, and invoices.
 * Server data comes in as props; actions call the billing routes and refresh the page.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Banknote, Building2, ChevronRight, CircleDollarSign, FilePlus2, HandCoins, Info, ReceiptText, Users } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { formatMoney, toMinor } from "@/lib/money";
import {
  buildTotals, dueLabel, filterCounts, formatDate, INVOICE_FILTERS, invoiceBadge, matchesFilter,
  type BillingAccess, type InvoiceFilter, type InvoiceSummary, type MoneySummary, type PayoutRow,
} from "@/lib/money-view";
import { createInvoice, recordInvoicePayment, recordPayout } from "./billing-client";
import { PaymentDialog } from "./payment-dialog";

type InvoiceableProject = { id: string; name: string; client: string };

/** "Mark as paid (demo)": records the whole balance as one manual payment, via record_payment. */
export async function markInvoicePaid(workspaceId: string, invoice: Pick<InvoiceSummary, "id" | "number" | "outstanding" | "currency">) {
  await recordInvoicePayment(workspaceId, invoice.id, { method: "other", note: "Marked as paid (demo)" });
  toast(`${invoice.number} marked as paid`, { description: `${formatMoney(invoice.outstanding, invoice.currency)} recorded as a manual payment.` });
}

export function MoneyBoard({ workspaceId, workspaceName, summary, access, projects, now }: {
  workspaceId: string; workspaceName: string; summary: MoneySummary; access: BillingAccess; projects: InvoiceableProject[]; now: string;
}) {
  const router = useRouter();
  const today = useMemo(() => new Date(now), [now]);
  const [filter, setFilter] = useState<InvoiceFilter>("all");
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<InvoiceSummary | null>(null);
  const [payout, setPayout] = useState<PayoutRow | null>(null);
  const { currency } = summary;
  const cards = buildTotals(summary);
  const counts = filterCounts(summary.invoices);
  const invoices = summary.invoices.filter((invoice) => matchesFilter(invoice, filter));
  const money = (value: string) => formatMoney(value, currency);

  async function markPaid(invoice: InvoiceSummary) {
    try { await markInvoicePaid(workspaceId, invoice); router.refresh(); }
    catch (reason) { toast.error(reason instanceof Error ? reason.message : "Could not mark it paid."); }
  }

  return <div className="money-page">
    <header className="money-heading">
      <div>
        <p className="money-eyebrow">Billing demo · {currency}</p>
        <h1>Money</h1>
        <p>What clients owe {workspaceName}, what {workspaceName} owes editors, and the margin in between.</p>
      </div>
      {access.manage && <button type="button" className="money-button is-primary" onClick={() => setCreating(true)} disabled={!projects.length}><FilePlus2 aria-hidden="true" />New invoice</button>}
    </header>

    <section className="money-totals" aria-label="Totals">
      {cards.map((card) => <article key={card.id} className={`money-total tone-${card.tone}`}>
        <span>{card.label}</span><strong>{card.value}</strong><small>{card.hint}</small>
      </article>)}
    </section>

    <div className={summary.payouts ? "money-columns" : "money-columns is-single"}>
      <section className="money-panel" aria-labelledby="receivables-title">
        <header><h2 id="receivables-title"><Building2 aria-hidden="true" />Receivables by client</h2><small>Sent and paid invoices</small></header>
        {summary.receivables.length === 0 ? <p className="money-muted">No client work is priced yet. Set a fee on a project to start.</p>
          : <table className="money-table">
            <thead><tr><th>Client</th><th>Billed</th><th>Paid</th><th>Outstanding</th></tr></thead>
            <tbody>{summary.receivables.map((row) => <tr key={row.client.id}>
              <td><strong>{row.client.name}</strong><small>{row.invoice_count} {row.invoice_count === 1 ? "invoice" : "invoices"}{toMinor(row.unbilled) > 0 ? ` · ${money(row.unbilled)} not billed` : ""}</small></td>
              <td>{money(row.billed)}</td><td>{money(row.paid)}</td>
              <td><b className={toMinor(row.outstanding) > 0 ? "is-due" : ""}>{money(row.outstanding)}</b>{toMinor(row.overdue) > 0 && <span className="money-badge tone-danger">{money(row.overdue)} overdue</span>}</td>
            </tr>)}</tbody>
          </table>}
      </section>

      {summary.payouts && <section className="money-panel" aria-labelledby="payouts-title">
        <header><h2 id="payouts-title"><Users aria-hidden="true" />Payouts by editor</h2><small>Earned when a task is approved</small></header>
        {summary.payouts.length === 0 ? <p className="money-muted">No editor pay yet. Set pay on a task in its detail sheet.</p>
          : <table className="money-table">
            <thead><tr><th>Editor</th><th>Earned</th><th>Paid</th><th>Owed</th>{access.manage && <th><span className="sr-only">Actions</span></th>}</tr></thead>
            <tbody>{summary.payouts.map((row) => <tr key={row.membership_id}>
              <td><strong>{row.name}</strong><small>{toMinor(row.pending) > 0 ? `${money(row.pending)} pending approval` : "Nothing pending"}{row.default_rate ? ` · ${money(row.default_rate)}/task` : ""}</small></td>
              <td>{money(row.earned)}</td><td>{money(row.paid)}</td>
              <td><b className={toMinor(row.owed) > 0 ? "is-owed" : ""}>{money(row.owed)}</b></td>
              {access.manage && <td className="money-row-action">{toMinor(row.owed) > 0 && <button type="button" className="money-button is-sm" onClick={() => setPayout(row)}><HandCoins aria-hidden="true" />Pay out</button>}</td>}
            </tr>)}</tbody>
          </table>}
      </section>}
    </div>

    <section className="money-panel" aria-labelledby="invoices-title">
      <header>
        <h2 id="invoices-title"><ReceiptText aria-hidden="true" />Invoices <span className="money-count">{summary.invoices.length}</span></h2>
        <div className="money-tabs" role="tablist" aria-label="Filter invoices">
          {INVOICE_FILTERS.map((item) => <button key={item.id} type="button" role="tab" aria-selected={filter === item.id} className={filter === item.id ? "selected" : ""} onClick={() => setFilter(item.id)}>
            {item.label}<span>{counts[item.id]}</span>
          </button>)}
        </div>
      </header>
      {invoices.length === 0 ? <p className="money-muted">{summary.invoices.length ? "No invoices match this filter." : "No invoices yet. Create one from a priced project."}</p>
        : <table className="money-table is-invoices">
          <thead><tr><th>Invoice</th><th>Client · project</th><th>Status</th><th>Total</th><th>Outstanding</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{invoices.map((invoice) => {
            const badge = invoiceBadge(invoice);
            return <tr key={invoice.id}>
              <td><Link href={`/money/invoices/${invoice.id}`} className="money-invoice-link">{invoice.number}<ChevronRight aria-hidden="true" /></Link><small>{invoice.issue_date ? `Issued ${formatDate(invoice.issue_date)}` : "Draft"}</small></td>
              <td><strong>{invoice.client.name}</strong><small>{invoice.project?.name ?? "—"}</small></td>
              <td><span className="money-badges"><span className={`money-badge tone-${badge.tone}`}>{badge.label}</span>{badge.partial && <span className="money-badge tone-warning">Part-paid</span>}</span><small>{dueLabel(invoice, today)}</small></td>
              <td>{formatMoney(invoice.total, invoice.currency)}</td>
              <td><b className={toMinor(invoice.outstanding) > 0 && invoice.status !== "draft" ? "is-due" : ""}>{invoice.status === "draft" ? "—" : formatMoney(invoice.outstanding, invoice.currency)}</b></td>
              <td className="money-row-action">{access.manage && invoice.status === "sent" && <>
                <button type="button" className="money-button is-sm" onClick={() => setPaying(invoice)}><Banknote aria-hidden="true" />Record payment</button>
                <button type="button" className="money-button is-sm is-ghost" onClick={() => void markPaid(invoice)}><CircleDollarSign aria-hidden="true" />Mark as paid (demo)</button>
              </>}</td>
            </tr>;
          })}</tbody>
        </table>}
    </section>

    <p className="money-footnote"><Info aria-hidden="true" />Demo: payments are recorded by hand (provider &ldquo;manual&rdquo;). No money moves and no email is sent. Card payments will plug into the same recording step later.</p>

    {creating && <NewInvoiceDialog workspaceId={workspaceId} projects={projects} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); router.push(`/money/invoices/${id}`); }} />}
    {paying && <PaymentDialog title={`Record a payment on ${paying.number}`} description={`${paying.client.name} · ${formatMoney(paying.outstanding, paying.currency)} outstanding`}
      maxAmount={paying.outstanding} currency={paying.currency} onClose={() => setPaying(null)}
      onSubmit={async (payment) => { await recordInvoicePayment(workspaceId, paying.id, payment); toast(`Payment recorded on ${paying.number}`); setPaying(null); router.refresh(); }} />}
    {payout && <PaymentDialog title={`Pay out ${payout.name}`} description={`${money(payout.owed)} earned and not yet paid`} submitLabel="Record payout"
      maxAmount={payout.owed} currency={currency} onClose={() => setPayout(null)}
      onSubmit={async (payment) => { await recordPayout(workspaceId, payout.membership_id, payment); toast(`Payout recorded for ${payout.name}`); setPayout(null); router.refresh(); }} />}
  </div>;
}

function NewInvoiceDialog({ workspaceId, projects, onClose, onCreated }: { workspaceId: string; projects: InvoiceableProject[]; onClose: () => void; onCreated: (id: string) => void }) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try { const invoice = await createInvoice(workspaceId, projectId, due || undefined); toast(`${invoice.number} created as a draft`); onCreated(invoice.id); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The invoice was not created."); }
    finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
    <DialogContent className="money-dialog">
      <form onSubmit={submit} className="money-form">
        <header className="money-dialog-head"><DialogTitle>New invoice</DialogTitle><DialogDescription>Lists the project fee and every priced task not already invoiced. It starts as a draft.</DialogDescription><DialogClose /></header>
        <label className="is-wide"><span>Project</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)} required autoFocus>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.client} · {project.name}</option>)}
        </select></label>
        <label className="is-wide"><span>Due date (optional)</span><input type="date" value={due} onChange={(event) => setDue(event.target.value)} /><small>Blank uses the workspace payment terms when it is sent.</small></label>
        {error && <p className="money-error is-wide" role="alert">{error}</p>}
        <footer className="is-wide">
          <button type="button" className="money-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="money-button is-primary" disabled={busy || !projectId}>{busy ? "Creating…" : "Create draft"}</button>
        </footer>
      </form>
    </DialogContent>
  </Dialog>;
}
