"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RotateCcw } from "@/components/icons";
import type { JobRow } from "@/lib/platform-view";
import { formatDate, relativeTime } from "@/lib/platform-view";
import { platformActions } from "@/lib/platform-client";
import { ReasonDialog } from "./reason-dialog";
import { Pill } from "./ui";

export function JobsTable({ rows }: { rows: JobRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<JobRow[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const toggle = (id: string) => setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const all = rows.length > 0 && selected.size === rows.length;
  const chosen = rows.filter((r) => selected.has(r.id));

  return <>
    <div className="pf-toolbar">
      <label className="pf-check"><input type="checkbox" checked={all} onChange={() => setSelected(all ? new Set() : new Set(rows.map((r) => r.id)))} />Select all on page</label>
      <button type="button" className="pf-btn is-primary" disabled={!chosen.length} onClick={() => setTarget(chosen)}><RotateCcw size={15} />Retry selected ({chosen.length})</button>
    </div>
    <div className="pf-table-wrap"><table className="pf-table">
      <thead><tr><th aria-label="Select" /><th>Job</th><th>Status</th><th>Attempts</th><th>Last error</th><th>When</th><th /></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.id} className={selected.has(row.id) ? "is-selected" : undefined}>
        <td data-label="Select"><input type="checkbox" aria-label={`Select ${row.topic}`} checked={selected.has(row.id)} onChange={() => toggle(row.id)} /></td>
        <td data-label="Job"><code>{row.topic}</code><small className="pf-sub">{row.workspace ? <Link href={`/platform/workspaces/${row.workspace.id}`}>{row.workspace.name}</Link> : row.aggregate}</small></td>
        <td data-label="Status"><Pill tone={row.status === "DEAD_LETTER" || row.status === "FAILED" && row.kind === "ai_qa" ? "bad" : "warn"}>{row.status.replace("_", " ").toLowerCase()}</Pill></td>
        <td data-label="Attempts">{row.attempts}</td>
        <td data-label="Last error"><button type="button" className="pf-link-btn pf-error-text" onClick={() => setExpanded(expanded === row.id ? null : row.id)} aria-expanded={expanded === row.id}>{expanded === row.id ? row.last_error || "—" : (row.last_error || "—").slice(0, 70) + (row.last_error.length > 70 ? "…" : "")}</button>
          {expanded === row.id && <pre className="pf-pre">{JSON.stringify(row.payload, null, 2)}</pre>}</td>
        <td data-label="When" title={formatDate(row.updated_at)}>{relativeTime(row.updated_at)}</td>
        <td data-label=""><button type="button" className="pf-btn is-small" onClick={() => setTarget([row])}><RotateCcw size={14} />Retry</button></td>
      </tr>)}</tbody>
    </table></div>
    {target && <ReasonDialog
      open onOpenChange={(open) => !open && setTarget(null)}
      title={target.length === 1 ? `Retry ${target[0].topic}` : `Retry ${target.length} jobs`}
      description="Puts the job back in the queue to run again now. Fix the cause first (e.g. the email server), or it will fail again."
      confirmLabel="Retry now"
      onConfirm={async (reason) => {
        const result = await platformActions.retryJobs(target.map((r) => ({ kind: r.kind, id: r.id })), reason);
        if (!result.ok) return result.detail;
        const failed = result.data.results.filter((r) => !r.ok);
        if (failed.length) toast.warning(`${result.data.retried} retried, ${failed.length} skipped: ${failed[0].detail ?? ""}`);
        else toast.success(`${result.data.retried} job${result.data.retried === 1 ? "" : "s"} queued again.`);
        setSelected(new Set());
        router.refresh();
        return null;
      }}
    />}
  </>;
}
