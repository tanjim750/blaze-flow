import Link from "next/link";
import type { ReactNode } from "react";
import type { AuditRow, TicketSummary } from "@/lib/platform-view";
import { formatDate, relativeTime, statusLabel } from "@/lib/platform-view";

export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return <header className="pf-head"><div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>{children && <div className="pf-head-actions">{children}</div>}</header>;
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "good" | "warn" | "bad" }) {
  return <div className={`pf-stat${tone ? ` is-${tone}` : ""}`}><small>{label}</small><strong>{value}</strong>{hint && <span>{hint}</span>}</div>;
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "violet" | "good" | "warn" | "bad" | "demo" }) {
  return <span className={`pf-pill is-${tone}`}>{children}</span>;
}

export function ErrorPanel({ detail }: { detail: string }) {
  return <div className="pf-error" role="alert"><strong>Could not load this.</strong><span>{detail}</span></div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="pf-empty">{children}</p>;
}

export function Pager({ total, limit, offset, href }: { total: number; limit: number; offset: number; href: (offset: number) => string }) {
  if (total <= limit) return null;
  return <nav className="pf-pager" aria-label="Pages">
    {offset > 0 ? <Link href={href(Math.max(0, offset - limit))}>← Previous</Link> : <span />}
    <small>{offset + 1}–{Math.min(total, offset + limit)} of {total}</small>
    {offset + limit < total ? <Link href={href(offset + limit)}>Next →</Link> : <span />}
  </nav>;
}

export const ticketTone = (status: string) => (status === "NEW" ? "violet" : status === "SOLVED" ? "good" : status === "WAITING" ? "neutral" : "warn");

export function TicketList({ tickets }: { tickets: TicketSummary[] }) {
  if (!tickets.length) return <Empty>No tickets.</Empty>;
  return <ul className="pf-list">{tickets.map((t) => <li key={t.id}><Link href={`/platform/support/${t.id}`}>
    <span className="pf-list-main"><b>#{t.number} {t.subject}</b><small>{t.user?.email} · {relativeTime(t.created_at)}</small></span>
    <Pill tone={ticketTone(t.status)}>{statusLabel(t.status)}</Pill>
  </Link></li>)}</ul>;
}

export function AuditTable({ rows, compact = false }: { rows: AuditRow[]; compact?: boolean }) {
  if (!rows.length) return <Empty>No audit entries.</Empty>;
  return <div className="pf-table-wrap"><table className="pf-table">
    <thead><tr><th>When</th><th>Actor</th><th>Action</th>{!compact && <th>Workspace</th>}<th>Reason</th></tr></thead>
    <tbody>{rows.map((r) => <tr key={r.id}>
      <td data-label="When" title={formatDate(r.created_at)}>{relativeTime(r.created_at)}</td>
      <td data-label="Actor">{r.actor?.email ?? "system"} {r.actor_type === "PLATFORM_STAFF" ? <Pill tone="violet">staff</Pill> : r.actor_type === "GUEST" ? <Pill>guest</Pill> : null}</td>
      <td data-label="Action"><code>{r.action}</code>{r.entity_type && <small className="pf-sub"> {r.entity_type}</small>}</td>
      {!compact && <td data-label="Workspace">{r.workspace ? <Link href={`/platform/workspaces/${r.workspace.id}`}>{r.workspace.name}</Link> : "—"}</td>}
      <td data-label="Reason">{r.reason ?? "—"}</td>
    </tr>)}</tbody>
  </table></div>;
}
