"use client";

import { useEffect, useState } from "react";
import { LifeBuoy } from "@/components/icons";
import { toast } from "sonner";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { reportProblem } from "@/lib/platform-client";
import "./report-problem.css";
import { Select } from "@/components/ui/select";

/** Opens the dialog from anywhere: `window.dispatchEvent(new Event(REPORT_EVENT))`. */
export const REPORT_EVENT = "blazeflow:report-problem";

const CATEGORIES = [
  { value: "BUG", label: "Something is broken" },
  { value: "QUESTION", label: "How do I…?" },
  { value: "ACCOUNT", label: "Account or sign-in" },
  { value: "BILLING", label: "Plan or billing" },
  { value: "OTHER", label: "Something else" },
];

/**
 * "Report a problem": becomes a ticket in the Krewsys support inbox (`/platform/support`).
 * The page address and browser go with it (only if the box stays ticked), so support does
 * not have to ask; the server adds the plan and a request id itself.
 */
export function ReportProblemDialog({ workspaceId }: { workspaceId: string | null }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("BUG");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [includeContext, setIncludeContext] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const show = () => { setError(null); setOpen(true); };
    window.addEventListener(REPORT_EVENT, show);
    return () => window.removeEventListener(REPORT_EVENT, show);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!subject.trim() || !body.trim()) { setError("Add a short subject and what happened."); return; }
    setBusy(true);
    setError(null);
    const context: Record<string, string> = includeContext
      ? { url: window.location.href, user_agent: navigator.userAgent, viewport: `${window.innerWidth}×${window.innerHeight}` }
      : {};
    const result = await reportProblem({ category, subject: subject.trim(), body: body.trim(), workspace_id: workspaceId, context });
    setBusy(false);
    if (!result.ok) { setError(result.detail); return; }
    setOpen(false);
    setSubject("");
    setBody("");
    toast.success(`Thanks — we got it (ticket #${result.data.number}). We'll reply by email.`);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {open && <DialogContent className="report-dialog">
        <DialogClose />
        <DialogTitle>Report a problem</DialogTitle>
        <DialogDescription>Tell the Krewsys team what went wrong. We reply by email.</DialogDescription>
        <form onSubmit={submit} className="report-form">
          <label>What is it about?
            <Select aria-label="Category" value={category} onValueChange={setCategory} options={CATEGORIES.map((c) => ({ value: c.value, label: c.label }))} />
          </label>
          <label>Subject
            <input value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Upload stops at 99%" autoFocus />
          </label>
          <label>What happened?
            <textarea value={body} maxLength={10000} rows={5} onChange={(e) => setBody(e.target.value)} placeholder="What you did, what you expected, what you saw instead." />
          </label>
          <label className="report-check">
            <input type="checkbox" checked={includeContext} onChange={(e) => setIncludeContext(e.target.checked)} />
            Include this page&apos;s address and my browser (helps us fix it faster)
          </label>
          {error && <p className="report-error" role="alert">{error}</p>}
          <div className="report-actions">
            <button type="button" className="report-cancel" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="report-send" disabled={busy}>{busy ? "Sending…" : "Send report"}</button>
          </div>
        </form>
      </DialogContent>}
    </Dialog>
  );
}

/** A plain button that opens the dialog (used on the Help page). */
export function ReportProblemButton({ className }: { className?: string }) {
  return <button type="button" className={className} onClick={() => window.dispatchEvent(new Event(REPORT_EVENT))}><LifeBuoy size={16} />Report a problem</button>;
}
