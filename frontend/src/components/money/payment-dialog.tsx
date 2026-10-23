"use client";
/**
 * Record a payment entry: a client paying an invoice, or a payout to an editor. Partial
 * amounts are fine. The server records it through `billing.record_payment`, the one path
 * a payment gateway will also use later.
 */
import { useState } from "react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { formatMoney, parseMoneyInput, toMinor } from "@/lib/money";
import { PAYMENT_METHODS } from "@/lib/money-view";
import type { PaymentInput } from "./billing-client";

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function PaymentDialog({ title, description, maxAmount, currency, submitLabel = "Record payment", onClose, onSubmit }: {
  title: string; description: string; maxAmount: string; currency: string; submitLabel?: string;
  onClose: () => void; onSubmit: (payment: PaymentInput) => Promise<void>;
}) {
  const [amount, setAmount] = useState(maxAmount);
  const [paidOn, setPaidOn] = useState(todayIso);
  const [method, setMethod] = useState("bank_transfer");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = parseMoneyInput(amount);
    if ("error" in parsed) return setError(parsed.error);
    if (!parsed.amount || toMinor(parsed.amount) <= 0) return setError("Enter an amount above zero.");
    if (toMinor(parsed.amount) > toMinor(maxAmount)) return setError(`That is more than the ${formatMoney(maxAmount, currency)} left.`);
    setBusy(true); setError("");
    try { await onSubmit({ amount: parsed.amount, paid_on: paidOn, method, note }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The payment was not recorded."); }
    finally { setBusy(false); }
  }

  return <Dialog open onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
    <DialogContent className="money-dialog">
      <form onSubmit={submit} className="money-form">
        <header className="money-dialog-head"><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription><DialogClose /></header>
        <label><span>Amount ({currency})</span><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} autoFocus aria-describedby="money-max" />
          <small id="money-max">Up to {formatMoney(maxAmount, currency)}. Less records a part payment.</small></label>
        <label><span>Date paid</span><input type="date" value={paidOn} max={todayIso()} onChange={(event) => setPaidOn(event.target.value)} required /></label>
        <label><span>Method</span><select value={method} onChange={(event) => setMethod(event.target.value)}>{PAYMENT_METHODS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label><span>Note</span><input value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} placeholder="Reference, cheque number…" /></label>
        {error && <p className="money-error is-wide" role="alert">{error}</p>}
        <footer className="is-wide">
          <span className="money-demo-chip">Manual entry (demo)</span>
          <button type="button" className="money-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="money-button is-primary" disabled={busy}>{busy ? "Saving…" : submitLabel}</button>
        </footer>
      </form>
    </DialogContent>
  </Dialog>;
}
