"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Send, StickyNote } from "@/components/icons";
import type { TicketDetail, TicketStatus } from "@/lib/platform-view";
import { TICKET_STATUSES, statusLabel } from "@/lib/platform-view";
import { platformActions } from "@/lib/platform-client";
import { ReasonDialog } from "./reason-dialog";

type Pending = { kind: "message"; mode: "REPLY" | "NOTE" } | { kind: "update"; changes: { status?: TicketStatus; assignee?: "me" | "none" }; label: string };

export function TicketWorkbench({ ticket, staffEmail }: { ticket: TicketDetail; staffEmail: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"REPLY" | "NOTE">("REPLY");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const mine = ticket.assignee?.email === staffEmail;

  return <div className="pf-workbench">
    <div className="pf-ticket-controls">
      <label>Status
        <select value={ticket.status} onChange={(e) => setPending({ kind: "update", changes: { status: e.target.value as TicketStatus }, label: `Mark as ${statusLabel(e.target.value)}` })}>
          {TICKET_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
      </label>
      <button type="button" className="pf-btn" onClick={() => setPending({ kind: "update", changes: { assignee: mine ? "none" : "me" }, label: mine ? "Unassign" : "Assign to me" })}>{mine ? "Unassign me" : "Assign to me"}</button>
    </div>
    <form className="pf-composer" onSubmit={(e) => { e.preventDefault(); if (body.trim()) setPending({ kind: "message", mode }); }}>
      <div className="pf-segment" role="tablist" aria-label="Message type">
        <button type="button" role="tab" aria-selected={mode === "REPLY"} className={mode === "REPLY" ? "active" : undefined} onClick={() => setMode("REPLY")}><Send size={14} />Reply to customer</button>
        <button type="button" role="tab" aria-selected={mode === "NOTE"} className={mode === "NOTE" ? "active" : undefined} onClick={() => setMode("NOTE")}><StickyNote size={14} />Internal note</button>
      </div>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={10000}
        aria-label={mode === "REPLY" ? "Reply" : "Internal note"}
        placeholder={mode === "REPLY" ? `Emailed to ${ticket.user?.email}…` : "Only staff can see this."} />
      <div className="pf-form-actions">
        <small>{mode === "REPLY" ? "Sent by email through the outbox; failures show up under Jobs." : "Never shown to the customer."}</small>
        <button type="submit" className="pf-btn is-primary" disabled={!body.trim()}>{mode === "REPLY" ? "Send reply" : "Add note"}</button>
      </div>
    </form>
    {pending && <ReasonDialog
      open onOpenChange={(open) => !open && setPending(null)}
      title={pending.kind === "message" ? (pending.mode === "REPLY" ? "Send this reply?" : "Add internal note?") : pending.label}
      description={pending.kind === "message" && pending.mode === "REPLY" ? `It will be emailed to ${ticket.user?.email}.` : `Ticket #${ticket.number}: ${ticket.subject}`}
      confirmLabel={pending.kind === "message" ? (pending.mode === "REPLY" ? "Send reply" : "Add note") : "Save"}
      defaultReason={pending.kind === "message" && pending.mode === "REPLY" ? `Support reply on ticket #${ticket.number}` : ""}
      onConfirm={async (reason) => {
        const result = pending.kind === "message"
          ? await platformActions.postMessage(ticket.id, pending.mode, body.trim(), reason)
          : await platformActions.updateTicket(ticket.id, pending.changes, reason);
        if (!result.ok) return result.detail;
        if (pending.kind === "message") { setBody(""); toast.success(pending.mode === "REPLY" ? "Reply queued for email." : "Note added."); }
        else toast.success("Ticket updated.");
        router.refresh();
        return null;
      }}
    />}
  </div>;
}
