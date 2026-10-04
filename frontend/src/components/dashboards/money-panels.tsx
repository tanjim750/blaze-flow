/** Billing demo panels for the role dashboards. Each renders only when its data is present. */
import Link from "next/link";
import { ReceiptText, Wallet } from "lucide-react";
import type { ClientDashboard, EditorDashboard, OwnerDashboard } from "@/lib/role-dashboard-view";

export function OwnerMoneyStrip({ cards }: { cards: NonNullable<OwnerDashboard["money"]> }) {
  return <section className="money-strip" aria-label="Money">
    {cards.map((card) => <Link href="/money" className={`money-strip-card tone-${card.tone}`} key={card.id}>
      <span><Wallet size={13} aria-hidden="true" />{card.label}</span>
      <strong>{card.value}</strong>
      <small>{card.hint}</small>
    </Link>)}
  </section>;
}

export function EarningsPanel({ earnings }: { earnings: NonNullable<EditorDashboard["earnings"]> }) {
  return <section className="panel earnings-panel" aria-labelledby="earnings-title">
    <div className="panel-title"><h2 id="earnings-title"><Wallet size={16} />My earnings</h2><small>Pay is earned when a task is approved</small></div>
    <div className="earnings-figures">
      <div><strong>{earnings.pending}</strong><span>Pending approval</span></div>
      <div><strong>{earnings.earned}</strong><span>Earned</span></div>
      <div><strong>{earnings.paid}</strong><span>Paid out</span></div>
      <div className={earnings.owedMinor > 0 ? "is-owed" : ""}><strong>{earnings.owed}</strong><span>Still owed to you</span></div>
    </div>
    <div className="earnings-track" aria-label={`${earnings.paidShare}% of earned pay paid out`}><i style={{ width: `${earnings.paidShare}%` }} /></div>
    <ul className="earnings-lines">
      {earnings.recent.map((line) => <li key={line.id}>
        <div><strong>{line.task}</strong><small>{line.project ?? "No project"}</small></div>
        <span className={`home-badge ${line.tone}`}>{line.status}</span>
        <b>{line.amount}</b>
      </li>)}
    </ul>
  </section>;
}

export function ClientInvoicesPanel({ invoices }: { invoices: NonNullable<ClientDashboard["invoices"]> }) {
  return <section className="panel client-invoices" aria-labelledby="client-invoices-title">
    <div className="panel-title">
      <h2 id="client-invoices-title"><ReceiptText size={16} />Your invoices</h2>
      <small>{invoices.hasOutstanding ? `${invoices.outstanding} outstanding${invoices.overdueCount ? ` · ${invoices.overdueCount} overdue` : ""}` : "All paid, thank you"}</small>
    </div>
    <div className="client-invoice-list">
      {invoices.rows.map((row) => <Link href={row.href} className="client-invoice-row" key={row.id} aria-label={`Open invoice ${row.number}`}>
        <div><strong>{row.number}</strong><small>{row.project ?? ""}</small></div>
        <span className={`home-badge ${row.badge.tone}`}>{row.badge.label}</span>
        <div className="client-invoice-amount"><b>{row.amount}</b><small>{row.due}</small></div>
      </Link>)}
    </div>
  </section>;
}
