import Link from "next/link";
import { ArrowLeft } from "@/components/icons";
import { AuditTable, ErrorPanel, PageHead, Pill, Stat, TicketList } from "@/components/platform/ui";
import { getPlatformWorkspace } from "@/lib/platform-api";
import { ChangePlan } from "@/components/platform/change-plan";
import { viewWorkspaceAction } from "../actions";
import { formatBytes, formatDate, planLabel, relativeTime } from "@/lib/platform-view";

export default async function PlatformWorkspaceDetail({ params, searchParams }: PageProps<"/platform/workspaces/[id]">) {
  const { id } = await params;
  const viewError = (await searchParams).view_error;
  const result = await getPlatformWorkspace(id);
  if (!result.ok) return <><Link className="pf-back-link" href="/platform/workspaces"><ArrowLeft size={14} />Workspaces</Link><ErrorPanel detail={result.error.detail} /></>;
  const w = result.data;
  const tone = w.health.status === "healthy" ? "good" : w.health.status === "critical" ? "bad" : "warn";
  return <>
    <Link className="pf-back-link" href="/platform/workspaces"><ArrowLeft size={14} />Workspaces</Link>
    <PageHead title={w.name} sub={<>{w.slug} · created {formatDate(w.created_at)} <Pill tone={w.status === "ACTIVE" ? "good" : "warn"}>{w.status.toLowerCase()}</Pill> {w.is_demo && <Pill tone="demo">demo</Pill>}</>}>
      <div className="pf-actions">
        <form action={viewWorkspaceAction}><input type="hidden" name="workspaceId" value={w.id} /><button type="submit" className="pf-btn is-primary">View workspace (read-only)</button></form>
        {w.owner && <ChangePlan workspaceId={w.id} currentPlan={w.subscription?.plan ?? "FREE"} />}
      </div>
    </PageHead>
    {viewError && <ErrorPanel detail="Could not open the read-only view. Check you still have platform access and try again." />}
    <section className="pf-stats is-compact">
      <Stat label="Owner" value={w.owner ? <Link href={`/platform/users/${w.owner.id}`}>{w.owner.name}</Link> : "—"} hint={w.owner?.email} />
      <Stat label="Plan" value={planLabel(w.subscription)} hint={w.subscription?.trial_ends_at ? `trial ends ${formatDate(w.subscription.trial_ends_at)}` : w.subscription?.current_period_end ? `renews ${formatDate(w.subscription.current_period_end)}` : "no renewal date"} />
      <Stat label="Projects" value={`${w.projects} / ${w.limits.projects}`} />
      <Stat label="Storage" value={formatBytes(w.storage_bytes)} hint={`of ${formatBytes(w.limits.storage_bytes)}`} />
      <Stat label="AI QA (30d)" value={`${w.ai_qa_30d.runs} runs`} hint={`${w.ai_qa_30d.minutes} min · ${w.ai_qa_30d.failed} failed`} tone={w.ai_qa_30d.failed ? "warn" : undefined} />
      <Stat label="Health" value={<Pill tone={tone}>{w.health.status}</Pill>} hint={w.health.alerts.map((a) => `${a.count} ${a.code.replaceAll("_", " ")}`).join(" · ") || "no alerts"} />
    </section>
    <div className="pf-grid-2">
      <section className="pf-card">
        <h2>Members ({w.members})</h2>
        <ul className="pf-list">{w.members_list.map((m) => <li key={m.id}><Link href={`/platform/users/${m.user?.id}`}>
          <span className="pf-list-main"><b>{m.user?.name}</b><small>{m.user?.email} · joined {relativeTime(m.joined_at)}</small></span>
          <span>{m.is_primary_owner ? <Pill tone="violet">owner</Pill> : <Pill>{m.role ?? "member"}</Pill>} {m.status !== "ACTIVE" && <Pill tone="warn">{m.status.toLowerCase()}</Pill>}</span>
        </Link></li>)}</ul>
      </section>
      <section className="pf-card">
        <h2>Support tickets</h2>
        <TicketList tickets={w.tickets} />
        <h2 className="pf-h2-gap">Deliveries & jobs</h2>
        <p className="pf-kv">Emails: {Object.entries(w.health.deliveries).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(" · ") || "none"}<br />Outbox: {Object.entries(w.health.outbox).map(([k, v]) => `${v} ${k.toLowerCase().replace("_", " ")}`).join(" · ") || "none"}</p>
      </section>
    </div>
    <section className="pf-card"><h2>Recent activity</h2><AuditTable rows={w.recent_audit} compact /></section>
  </>;
}
