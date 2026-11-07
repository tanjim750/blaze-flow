"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { send } from "@/lib/platform-client";

const PLANS = [{ value: "FREE", label: "Free" }, { value: "SOLO", label: "Solo" }, { value: "PRO", label: "Pro" }];
type Warning = { code: string; detail: string };
type Result = { old_plan: string; new_plan: string; billing_changed: false; warnings: Warning[] };

/** Staff-only plan override. Changes the in-app plan only; never touches billing or the payment provider. */
export function ChangePlan({ workspaceId, currentPlan }: { workspaceId: string; currentPlan: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState(currentPlan);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (plan === currentPlan) { setError("Pick a different plan."); return; }
    setBusy(true);
    const result = await send<Result>(`/platform/workspaces/${workspaceId}/plan/`, "POST", { plan, reason: reason.trim() });
    setBusy(false);
    if (!result.ok) { setError(result.detail); return; }
    setWarnings(result.data.warnings);
    toast.success(`Plan changed from ${result.data.old_plan} to ${result.data.new_plan}. Billing unchanged.`);
    if (!result.data.warnings.length) setOpen(false);
    router.refresh();
  }
  return <>
    <button type="button" className="pf-btn" onClick={() => { setPlan(currentPlan); setReason(""); setError(null); setWarnings([]); setOpen(true); }}>Change plan</button>
    <Dialog open={open} onOpenChange={setOpen}>
      {open && <DialogContent className="pf-dialog">
        <DialogClose />
        <DialogTitle>Change plan</DialogTitle>
        <DialogDescription>Currently <b>{currentPlan}</b>. The new plan&apos;s limits apply immediately to every workspace this owner has.</DialogDescription>
        {warnings.length ? <>
          <div className="pf-plan-warn" role="alert"><b>Plan changed. This workspace is over the new limits:</b><ul>{warnings.map((w) => <li key={w.code}>{w.detail}</li>)}</ul>No data was deleted.</div>
          <div className="pf-form-actions"><button type="button" className="pf-btn is-primary" onClick={() => setOpen(false)}>Done</button></div>
        </> : <form onSubmit={submit} className="pf-form">
          <label>New plan
            <select value={plan} onChange={(e) => setPlan(e.target.value)}>{PLANS.map((p) => <option key={p.value} value={p.value}>{p.label}{p.value === currentPlan ? " (current)" : ""}</option>)}</select>
          </label>
          <label>Reason (optional, saved in the audit log)
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Ticket #14 — comped upgrade" />
          </label>
          <p className="pf-plan-warn">This only changes the plan inside Krewsys. Billing is not changed: no charge, refund or change to the customer&apos;s payment-provider subscription. Downgrades over the limits delete nothing.</p>
          {error && <p className="pf-form-error" role="alert">{error}</p>}
          <div className="pf-form-actions">
            <button type="button" className="pf-btn" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="pf-btn is-primary" disabled={busy || plan === currentPlan}>{busy ? "Changing…" : `Change to ${plan}`}</button>
          </div>
        </form>}
      </DialogContent>}
    </Dialog>
  </>;
}
