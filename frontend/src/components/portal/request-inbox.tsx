"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, CalendarDays, Check, Clapperboard, Coins, Link2, Mail, MonitorPlay, TriangleAlert, X } from "lucide-react";
import {
  LENGTH_OPTIONS, REQUEST_STATUS, answerProjectRequest, budgetLabel, dayDate, deliverablesSummary, type ProjectRequest, type RequestStatus,
} from "@/lib/portal";

const FILTERS: { value: RequestStatus | "all"; label: string }[] = [
  { value: "pending", label: "Waiting" }, { value: "accepted", label: "Accepted" }, { value: "declined", label: "Declined" }, { value: "all", label: "All" },
];

/**
 * The studio's side of project requests: read the brief, then accept (a draft project
 * opens for that client, with the brief and specs filled in) or decline with a note.
 */
export function RequestInbox({ workspaceId, requests }: { workspaceId: string; requests: ProjectRequest[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<RequestStatus | "all">(requests.some((row) => row.status === "pending") ? "pending" : "all");
  const [open, setOpen] = useState<{ id: string; mode: "accept" | "decline" } | null>(null);
  const [note, setNote] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = requests.filter((row) => filter === "all" || row.status === filter || (filter === "declined" && row.status === "withdrawn"));
  const count = (status: RequestStatus | "all") => (status === "all" ? requests.length : requests.filter((row) => row.status === status).length);

  function start(row: ProjectRequest, mode: "accept" | "decline") {
    setOpen({ id: row.id, mode });
    setNote("");
    setName(row.title);
    setError(null);
  }

  async function answer(row: ProjectRequest) {
    if (!open) return;
    if (open.mode === "decline" && !note.trim()) { setError("Add a short note so the client knows why."); return; }
    setBusy(true);
    setError(null);
    const result = await answerProjectRequest(workspaceId, row.id, { action: open.mode, note, ...(open.mode === "accept" ? { name } : {}) });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setOpen(null);
    router.refresh();
  }

  return <section className="pt-card" aria-labelledby="inbox-title">
    <div className="pt-card-head">
      <h2 id="inbox-title"><Mail />Project requests</h2>
      <div className="pt-tabs" role="group" aria-label="Filter requests">
        {FILTERS.map((option) => <button type="button" key={option.value} className="pt-tab" aria-pressed={filter === option.value} onClick={() => setFilter(option.value)}>{option.label} {count(option.value)}</button>)}
      </div>
    </div>
    {shown.length === 0
      ? <p className="pt-empty">{filter === "pending" ? "No requests waiting. Clients can start one from their portal home." : "Nothing here yet."}</p>
      : <ul className="pt-requests">{shown.map((row) => {
        const status = REQUEST_STATUS[row.status];
        const isOpen = open?.id === row.id;
        const format = [row.platform, row.aspect_ratio, LENGTH_OPTIONS.find((option) => option.value === row.target_length_seconds)?.label ?? (row.target_length_seconds ? `${row.target_length_seconds}s` : null)].filter(Boolean).join(" · ");
        return <li className="pt-request" key={row.id}>
          <div className="pt-request-head"><h3>{row.title}</h3><span className={`pt-pill is-${status.tone}`}>{row.status === "pending" ? "Waiting for you" : status.label}</span></div>
          <div className="pt-request-meta">
            <span><Building2 />{row.client_team.name} · {row.requester_name}{row.requester_email ? ` (${row.requester_email})` : ""}</span>
            <span><CalendarDays />Sent {dayDate(row.created_at)}{row.wanted_by ? ` · needed by ${dayDate(row.wanted_by)}` : ""}</span>
          </div>
          <div className="pt-request-meta">
            <span><Clapperboard />{deliverablesSummary(row.deliverables)}</span>
            {format && <span><MonitorPlay />{format}</span>}
            {budgetLabel(row.budget_range) && <span><Coins />{budgetLabel(row.budget_range)}</span>}
          </div>
          <p>{row.brief}</p>
          {row.references && <p className="pt-request-note"><Link2 size={12} aria-hidden="true" /> {row.references}</p>}
          {row.decision_note && <p className="pt-request-note"><strong>{row.decided_by_name ?? "Studio"}:</strong> {row.decision_note}</p>}
          {row.status === "pending" && !isOpen && <div className="pt-request-actions">
            <button type="button" className="pt-cta" onClick={() => start(row, "accept")}><Check />Accept and open project</button>
            <button type="button" className="pt-ghost" onClick={() => start(row, "decline")}><X />Decline</button>
          </div>}
          {isOpen && <div className="pt-request-actions" role="group" aria-label={open.mode === "accept" ? "Accept request" : "Decline request"}>
            {open.mode === "accept" && <input aria-label="Project name" value={name} onChange={(event) => setName(event.target.value)} maxLength={200} />}
            <input aria-label={open.mode === "accept" ? "Note to the client (optional)" : "Why you are declining"} placeholder={open.mode === "accept" ? "Note to the client (optional)" : "Why, in a sentence"} value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} />
            <button type="button" className={open.mode === "accept" ? "pt-cta" : "pt-ghost is-danger"} disabled={busy} onClick={() => answer(row)}>{busy ? "Saving…" : open.mode === "accept" ? "Open draft project" : "Send decline"}</button>
            <button type="button" className="pt-ghost" onClick={() => setOpen(null)} disabled={busy}>Cancel</button>
          </div>}
          {isOpen && error && <p className="pt-alert is-error" role="alert"><TriangleAlert />{error}</p>}
          {row.project_id && <div className="pt-request-actions">
            <Link className="pt-ghost" href={`/projects?campaign=${row.project_id}`}>Open in Projects<ArrowRight /></Link>
            <Link className="pt-ghost" href={`/portal/projects/${row.project_id}`}>See the client view</Link>
          </div>}
        </li>;
      })}</ul>}
  </section>;
}
