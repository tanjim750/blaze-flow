"use client";

import { useAppRouter } from "@/lib/app-router";/**
 * Project "Pricing" tab (billing demo, billing.view only): the client fee, the per-task
 * prices on top, what is invoiced so far, and a shortcut to invoice the rest. Task prices
 * are edited in each task's detail sheet.
 */
import Link from "next/link";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FilePlus2, ReceiptText, Wallet } from "@/components/icons";
import { formatMoney, fromMinor, parseMoneyInput, sumMoney, toMinor } from "@/lib/money";
import { invoiceBadge, type ProjectPricing as Pricing } from "@/lib/money-view";
import { createInvoice, getProjectPricing, setProjectFee } from "./billing-client";
import "./project-pricing.css";

export function ProjectPricing({ workspaceId, projectId }: { workspaceId: string; projectId: string }) {
  const router = useAppRouter();
  const [data, setData] = useState<Pricing | null>(null);
  const [problem, setProblem] = useState("");
  const [fee, setFee] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    getProjectPricing(workspaceId, projectId)
      .then((next) => { if (!active) return; setData(next); setFee(next.fee ?? ""); })
      .catch((reason) => { if (active) setProblem(reason instanceof Error ? reason.message : "Pricing couldn't be loaded."); });
    return () => { active = false; };
  }, [workspaceId, projectId]);

  if (problem) return <div className="pp-shell"><p className="pp-muted" role="alert">{problem}</p></div>;
  if (!data) return <div className="pp-shell"><p className="pp-muted">Loading pricing…</p></div>;
  const money = (value: string | null) => formatMoney(value, data.currency);
  const priced = data.tasks.filter((task) => task.client_price);

  async function saveFee() {
    const parsed = parseMoneyInput(fee);
    if ("error" in parsed) return toast.error(parsed.error);
    if ((parsed.amount ?? null) === (data!.fee ?? null)) return;
    try { const next = await setProjectFee(workspaceId, projectId, parsed.amount); setData(next); setFee(next.fee ?? ""); toast("Project fee saved"); }
    catch (reason) { toast.error(reason instanceof Error ? reason.message : "Not saved."); }
  }
  async function invoice() {
    setBusy(true);
    try { const created = await createInvoice(workspaceId, projectId); toast(`${created.number} created as a draft`); router.push(`/money/invoices/${created.id}`); }
    catch (reason) { toast.error(reason instanceof Error ? reason.message : "The invoice was not created."); setBusy(false); }
  }

  return <div className="pp-shell">
    <section className="pp-card">
      <header><h2><Wallet aria-hidden="true" />Client price</h2><span className="pp-demo">Billing demo · {data.currency}</span></header>
      <div className="pp-sum">
        <label><span>Project fee</span>
          {data.can_manage
            ? <span className="pp-input"><i>{data.currency}</i><input inputMode="decimal" value={fee} placeholder="0.00" aria-label="Project fee" onChange={(event) => setFee(event.target.value)} onBlur={() => void saveFee()} onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }} /></span>
            : <strong>{money(data.fee)}</strong>}
        </label>
        <b aria-hidden="true">+</b>
        <div><span>Task prices ({priced.length})</span><strong>{money(data.tasks_total)}</strong></div>
        <b aria-hidden="true">=</b>
        <div className="is-total"><span>Project total</span><strong>{money(data.total)}</strong></div>
      </div>
      <p className="pp-muted">{invoicedSummary(data, money)} Set per-task prices in each task&rsquo;s detail sheet.</p>
      {priced.length > 0 && <ul className="pp-tasks">{priced.map((task) => <li key={task.id}><span>{task.title}</span><b>{money(task.client_price)}</b></li>)}</ul>}
    </section>

    <section className="pp-card">
      <header><h2><ReceiptText aria-hidden="true" />Invoices for this project</h2>
        {data.can_manage && (data.draft_invoice && toMinor(data.uninvoiced) <= 0
          ? <Link className="money-button is-primary is-sm" href={`/money/invoices/${data.draft_invoice.id}`}><ReceiptText aria-hidden="true" />Open draft {data.draft_invoice.number} · {money(data.draft_invoice.total)}</Link>
          : <button type="button" className="money-button is-primary is-sm" disabled={busy || toMinor(data.uninvoiced) <= 0} onClick={() => void invoice()}><FilePlus2 aria-hidden="true" />Invoice {money(data.uninvoiced)}</button>)}
      </header>
      {data.draft_invoice && <p className="pp-muted">Draft {data.draft_invoice.number} totals {money(data.draft_invoice.total)}: the items already on it{toMinor(data.uninvoiced) > 0 ? `, not the ${money(data.uninvoiced)} priced since` : ""}. Edit its lines, tax and discount on the draft.</p>}
      {data.invoices.length === 0 ? <p className="pp-muted">No invoices yet.</p> : <ul className="pp-invoices">{data.invoices.map((item) => {
        const badge = invoiceBadge(item);
        return <li key={item.id}><Link href={`/money/invoices/${item.id}`}>{item.number}</Link><span className={`money-badge tone-${badge.tone}`}>{badge.label}</span><span>{formatMoney(item.total, item.currency)}</span><small>{toMinor(item.outstanding) > 0 && item.status !== "draft" ? `${formatMoney(item.outstanding, item.currency)} outstanding` : ""}</small></li>;
      })}</ul>}
    </section>
  </div>;
}

/**
 * A draft isn't invoiced until it is sent: "£1,500 invoiced" for an unsent draft
 * contradicted Money ("£0 billed · £1,500 not billed yet").
 */
export function invoicedSummary(data: { invoiced: string; uninvoiced: string; invoices: { status: string; total: string }[] }, money: (value: string) => string): string {
  const drafted = sumMoney(data.invoices.filter((item) => item.status === "draft").map((item) => item.total));
  const sent = fromMinor(Math.max(0, toMinor(data.invoiced) - toMinor(drafted)));
  const parts = [
    toMinor(sent) > 0 ? `${money(sent)} invoiced` : null,
    toMinor(drafted) > 0 ? `${money(drafted)} in draft (not sent)` : null,
    toMinor(data.uninvoiced) > 0 ? `${money(data.uninvoiced)} still to invoice` : null,
  ].filter(Boolean);
  return parts.length ? `${parts.join(", ")}.` : "Nothing invoiced yet.";
}
