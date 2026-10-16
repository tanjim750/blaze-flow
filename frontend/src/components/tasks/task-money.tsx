"use client";
/**
 * The task sheet's Money block (billing demo). What it shows is decided by the API:
 * - client price: only for billing.view (editable with billing.manage);
 * - editor pay: every assignee for billing.manage / rates viewers, otherwise only the
 *   viewer's own line, read-only. Clients and anyone else get nothing, so it renders nothing.
 * Pay freezes once the task reaches Approved; the API refuses edits after that.
 */
import { useEffect, useState } from "react";
import { Coins, Lock } from "lucide-react";
import { getTaskMoney, patchTaskMoney } from "@/components/money/billing-client";
import { formatMoney, parseMoneyInput } from "@/lib/money";
import type { EditorPayLine, TaskMoney as TaskMoneyData } from "@/lib/money-view";

export function TaskMoney({ workspaceId, taskId }: { workspaceId: string | null; taskId: string }) {
  const [data, setData] = useState<TaskMoneyData | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    getTaskMoney(workspaceId, taskId).then((next) => { if (active) setData(next && Array.isArray(next.editor_pay) ? next : null); }).catch(() => { if (active) setData(null); });
    return () => { active = false; };
  }, [workspaceId, taskId]);

  if (!workspaceId || !data) return null;
  const showPrice = "client_price" in data;
  if (!showPrice && data.editor_pay.length === 0) return null;
  const money = (value: string | null | undefined) => formatMoney(value, data.currency);

  async function save(payload: Parameters<typeof patchTaskMoney>[2], label: string) {
    setError(""); setSaved("");
    try { setData(await patchTaskMoney(workspaceId!, taskId, payload)); setSaved(`${label} saved`); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Not saved."); }
  }

  return <section className="tb-money" aria-labelledby="tb-money-title">
    <header><h3 id="tb-money-title"><Coins aria-hidden="true" />Money</h3><span className="tb-money-demo">Demo</span><span className="tb-spacer" /><span className="tb-save" aria-live="polite">{error ? <span className="is-error">{error}</span> : saved}</span></header>
    <dl className="tb-props">
      {showPrice && <>
        <dt><label htmlFor="tb-money-price">Client price</label></dt>
        <dd>{data.can_manage
          ? <MoneyInput id="tb-money-price" currency={data.currency} value={data.client_price ?? null} placeholder="On top of the project fee" onCommit={(amount) => save({ client_price: amount }, "Client price")} onError={setError} />
          : <span className="tb-money-value">{money(data.client_price)}</span>}
        </dd>
      </>}
      {data.editor_pay.map((line) => <PayRow key={line.membership_id} line={line} currency={data.currency} canManage={data.can_manage}
        onCommit={(amount) => save({ editor_pay: { membership_id: line.membership_id, amount } }, `${line.is_me ? "Your" : `${line.name}'s`} pay`)} onError={setError} />)}
    </dl>
  </section>;
}

function PayRow({ line, currency, canManage, onCommit, onError }: { line: EditorPayLine; currency: string; canManage: boolean; onCommit: (amount: string | null) => void; onError: (message: string) => void }) {
  const id = `tb-pay-${line.membership_id}`;
  const label = line.is_me && !canManage ? "Your pay" : `Pay · ${line.name}${line.is_me ? " (you)" : ""}`;
  const status = line.frozen ? <span className="tb-money-chip is-earned"><Lock aria-hidden="true" />Earned · frozen</span>
    : line.amount ? <span className="tb-money-chip">Pending until approved</span> : null;
  return <>
    <dt><label htmlFor={id}>{label}</label></dt>
    <dd className="tb-money-pay">
      {canManage && !line.frozen && line.assigned
        ? <MoneyInput id={id} currency={currency} value={line.amount} placeholder={line.default_rate ? `Default ${formatMoney(line.default_rate, currency)}` : "No pay set"} onCommit={onCommit} onError={onError} />
        : <span className="tb-money-value">{formatMoney(line.amount, currency)}</span>}
      {status}
    </dd>
  </>;
}

function MoneyInput({ id, currency, value, placeholder, onCommit, onError }: { id: string; currency: string; value: string | null; placeholder: string; onCommit: (amount: string | null) => void; onError: (message: string) => void }) {
  const [draft, setDraft] = useState(value ?? "");
  function commit() {
    const parsed = parseMoneyInput(draft);
    if ("error" in parsed) return onError(parsed.error);
    if ((parsed.amount ?? null) === (value ?? null)) return;
    onCommit(parsed.amount);
  }
  return <span className="tb-money-input"><span aria-hidden="true">{currency}</span>
    <input id={id} className="tb-input" inputMode="decimal" value={draft} placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)} onBlur={commit}
      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); (event.target as HTMLInputElement).blur(); } }} />
  </span>;
}
