import Link from "next/link";
import { ArrowLeft } from "@/components/icons";
import { UserActions } from "@/components/platform/user-actions";
import { AuditTable, Empty, ErrorPanel, PageHead, Pill, Stat, TicketList } from "@/components/platform/ui";
import { getPlatformUser } from "@/lib/platform-api";
import { formatDate, planLabel, relativeTime } from "@/lib/platform-view";

export default async function PlatformUserDetail({ params }: PageProps<"/platform/users/[id]">) {
  const { id } = await params;
  const result = await getPlatformUser(id);
  if (!result.ok) return <><Link className="pf-back-link" href="/platform/users"><ArrowLeft size={14} />Users</Link><ErrorPanel detail={result.error.detail} /></>;
  const u = result.data;
  return <>
    <Link className="pf-back-link" href="/platform/users"><ArrowLeft size={14} />Users</Link>
    <PageHead title={u.name} sub={<>{u.email} {u.is_demo && <Pill tone="demo">demo</Pill>} {u.is_platform_staff && <Pill tone="violet">staff</Pill>}</>}>
      <UserActions userId={u.id} email={u.email} verified={Boolean(u.email_verified_at)} />
    </PageHead>
    <section className="pf-stats is-compact">
      <Stat label="Status" value={u.status === "ACTIVE" ? "Active" : u.status.toLowerCase()} tone={u.status === "ACTIVE" ? undefined : "warn"} />
      <Stat label="Email" value={u.email_verified_at ? "Verified" : "Not verified"} hint={u.email_verified_at ? formatDate(u.email_verified_at) : "can't receive some emails"} tone={u.email_verified_at ? "good" : "warn"} />
      <Stat label="Plan" value={planLabel(u.subscription)} hint={u.subscription.trial_ends_at ? `trial ends ${formatDate(u.subscription.trial_ends_at)}` : undefined} />
      <Stat label="Sign-in" value={relativeTime(u.last_login)} hint={u.oauth_providers.length ? `also via ${u.oauth_providers.join(", ").toLowerCase()}` : "password only"} />
      <Stat label="Joined" value={relativeTime(u.created_at)} hint={formatDate(u.created_at)} />
    </section>
    <div className="pf-grid-2">
      <section className="pf-card">
        <h2>Workspaces</h2>
        {u.workspaces.length === 0 ? <Empty>Not in any workspace.</Empty> : <ul className="pf-list">{u.workspaces.map((w) => <li key={w.id}><Link href={`/platform/workspaces/${w.id}`}>
          <span className="pf-list-main"><b>{w.name}</b><small>{w.role ?? "member"}</small></span>{w.is_primary_owner ? <Pill tone="violet">owner</Pill> : <Pill>{w.status.toLowerCase()}</Pill>}
        </Link></li>)}</ul>}
        <h2 className="pf-h2-gap">Subscription history</h2>
        {u.subscription_history.length === 0 ? <Empty>No subscription rows (treated as FREE).</Empty> : <ul className="pf-timeline">{u.subscription_history.map((s) => <li key={s.id}>
          <b>{s.plan}</b> <Pill tone={s.status === "ACTIVE" ? "good" : s.status === "PAST_DUE" ? "warn" : "neutral"}>{s.status.toLowerCase().replace("_", " ")}</Pill>
          <small>started {formatDate(s.started_at)}{s.trial_ends_at ? ` · trial to ${formatDate(s.trial_ends_at)}` : ""}{s.cancelled_at ? ` · cancelled ${formatDate(s.cancelled_at)}` : ""}</small>
        </li>)}</ul>}
      </section>
      <section className="pf-card"><h2>Support tickets</h2><TicketList tickets={u.tickets} /></section>
    </div>
    <section className="pf-card"><h2>Recent activity by or about this user</h2><AuditTable rows={u.recent_audit} /></section>
  </>;
}
