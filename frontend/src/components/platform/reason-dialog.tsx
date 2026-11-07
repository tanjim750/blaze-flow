"use client";

import { useState } from "react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

/**
 * Every staff action asks why before it runs; the answer is stored in the audit log.
 * `onConfirm` returns an error message to keep the dialog open, or null to close it.
 */
export function ReasonDialog({ open, onOpenChange, title, description, confirmLabel, defaultReason = "", onConfirm }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; confirmLabel: string;
  defaultReason?: string; onConfirm: (reason: string) => Promise<string | null>;
}) {
  const [reason, setReason] = useState(defaultReason);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (reason.trim().length < 3) { setError("Write a short reason (at least 3 characters)."); return; }
    setBusy(true);
    const failure = await onConfirm(reason.trim());
    setBusy(false);
    if (failure) setError(failure);
    else { setError(null); onOpenChange(false); }
  }
  return <Dialog open={open} onOpenChange={(next) => { if (next) { setReason(defaultReason); setError(null); } onOpenChange(next); }}>
    {open && <DialogContent className="pf-dialog">
      <DialogClose />
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{description}</DialogDescription>
      <form onSubmit={submit} className="pf-form">
        <label>Reason (saved in the audit log)
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus placeholder="e.g. Ticket #14 — customer asked" />
        </label>
        {error && <p className="pf-form-error" role="alert">{error}</p>}
        <div className="pf-form-actions">
          <button type="button" className="pf-btn" onClick={() => onOpenChange(false)}>Cancel</button>
          <button type="submit" className="pf-btn is-primary" disabled={busy}>{busy ? "Working…" : confirmLabel}</button>
        </div>
      </form>
    </DialogContent>}
  </Dialog>;
}
