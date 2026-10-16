"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarDays, Clapperboard, Coins, TriangleAlert, Undo2 } from "lucide-react";
import { REQUEST_STATUS, answerProjectRequest, budgetLabel, dayDate, deliverablesSummary, type ProjectRequest } from "@/lib/portal";

/** A client's own requests, newest first, with what the studio said back. */
export function ClientRequestList({ workspaceId, requests, compact = false }: { workspaceId: string; requests: ProjectRequest[]; compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function withdraw(id: string) {
    if (!confirm("Withdraw this request? The studio will no longer see it as waiting.")) return;
    setBusy(id);
    setError(null);
    const result = await answerProjectRequest(workspaceId, id, { action: "withdraw" });
    setBusy(null);
    if (!result.ok) setError(result.error);
    else router.refresh();
  }

  return <>
    {error && <p className="pt-alert is-error" role="alert"><TriangleAlert />{error}</p>}
    <ul className="pt-requests">{requests.map((row) => {
      const status = REQUEST_STATUS[row.status];
      return <li className="pt-request" key={row.id}>
        <div className="pt-request-head"><h3>{row.title}</h3><span className={`pt-pill is-${status.tone}`}>{status.label}</span></div>
        <div className="pt-request-meta">
          <span><Clapperboard />{deliverablesSummary(row.deliverables)}</span>
          <span><CalendarDays />Sent {dayDate(row.created_at)}{row.wanted_by ? ` · needed by ${dayDate(row.wanted_by)}` : ""}</span>
          {!compact && budgetLabel(row.budget_range) && <span><Coins />{budgetLabel(row.budget_range)}</span>}
        </div>
        {!compact && <p>{row.brief}</p>}
        {row.decision_note && <p className="pt-request-note"><strong>{row.decided_by_name ?? "The studio"}:</strong> {row.decision_note}</p>}
        {(row.project_id || row.status === "pending") && <div className="pt-request-actions">
          {row.project_id && <Link className="pt-cta" href={`/portal/projects/${row.project_id}`}>Open project<ArrowRight /></Link>}
          {row.status === "pending" && !compact && <button type="button" className="pt-ghost is-danger" disabled={busy === row.id} onClick={() => withdraw(row.id)}><Undo2 />{busy === row.id ? "Withdrawing…" : "Withdraw"}</button>}
        </div>}
      </li>;
    })}</ul>
  </>;
}
