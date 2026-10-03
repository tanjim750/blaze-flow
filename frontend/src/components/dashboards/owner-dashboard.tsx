import Link from "next/link";
import { BarChart3, ClipboardCheck, HeartPulse } from "lucide-react";
import { DashboardPoster } from "@/components/dashboard-poster";
import type { LayoutChoice } from "@/lib/dashboard-role";
import type { OwnerDashboard as OwnerView } from "@/lib/role-dashboard-view";
import { ActivityPanel, Avatar, CounterStrip, DashboardHeading, EmptyState, FooterLink, InlineProblem, ReviewQueuePanel } from "./parts";

function subline(view: OwnerView): string {
  const waiting = view.approvals.length;
  const risk = view.health.counts.overdue + view.health.counts.due_week;
  if (!waiting && !risk) return "Nothing is waiting on a decision and no project is at risk.";
  const parts = [];
  if (waiting) parts.push(`${waiting} ${waiting === 1 ? "cut is" : "cuts are"} waiting on approval`);
  if (risk) parts.push(`${risk} ${risk === 1 ? "project needs" : "projects need"} a look`);
  return `${parts.join(", and ")}.`;
}

export function OwnerDashboard({ view, choice }: { view: OwnerView; choice: LayoutChoice }) {
  const { health, workload } = view;
  return <div className="home-shell role-owner">
    <DashboardHeading workspaceName={view.workspaceName} today={view.today} greetingName={view.greetingName} subline={subline(view)} choice={choice} />
    <CounterStrip items={view.strip} />

    <div className="dashboard-columns">
      <section className="panel" aria-labelledby="approvals-title">
        <div className="panel-title">
          <h2 id="approvals-title"><ClipboardCheck size={16} />Approvals waiting</h2>
          <small>{view.approvals.filter((item) => item.kind === "client_review").length} with clients · {view.approvals.filter((item) => item.kind === "review").length} internal</small>
        </div>
        <div className="review-list">
          {view.problems.approvals && <InlineProblem>{view.problems.approvals}</InlineProblem>}
          {!view.problems.approvals && view.approvals.length === 0 && <EmptyState title="No cuts waiting on approval" body="Cuts in Client Review or Review on the Files board show up here." action={{ href: "/files", label: "Open files" }} />}
          {view.approvals.slice(0, 5).map((item) => <Link href={item.href} className="review-row" key={item.id} aria-label={`Open review: ${item.title} ${item.version}, ${item.stage}`}>
            <DashboardPoster src={item.poster} />
            <div className="review-description">
              <strong>{item.title}</strong>
              <p><span className="review-version">{item.version}</span><span className={`home-badge ${item.tone}`}>{item.stage}</span><span className="review-project">{item.client ? `${item.client} · ` : ""}{item.project}</span></p>
            </div>
            <time title="Uploaded">{item.age}</time>
          </Link>)}
        </div>
        {view.approvals.length > 5 && <FooterLink href="/files">All {view.approvals.length} in review</FooterLink>}
      </section>

      <section className="panel" aria-labelledby="health-title">
        <div className="panel-title"><h2 id="health-title"><HeartPulse size={16} />Project health</h2><small>{health.healthy} on track</small></div>
        <div className="health-counts">
          <div className={health.counts.overdue ? "is-danger" : "is-zero"}><strong>{health.counts.overdue}</strong><span>Overdue</span></div>
          <div className={health.counts.due_week ? "is-warning" : "is-zero"}><strong>{health.counts.due_week}</strong><span>Due this week</span></div>
          <div className={health.counts.on_hold ? "" : "is-zero"}><strong>{health.counts.on_hold}</strong><span>On hold</span></div>
        </div>
        <div className="health-list">
          {view.problems.tasks && <InlineProblem>Task counts are missing: {view.problems.tasks}</InlineProblem>}
          {health.rows.length === 0 && <EmptyState title="Every open project is on track" body="Nothing is overdue, due this week or on hold." />}
          {health.rows.slice(0, 5).map((row) => <Link href={row.href} className="health-row" key={row.id}>
            <div><strong>{row.name}</strong><p>{row.client ?? "No client"} · {row.openTasks} open {row.openTasks === 1 ? "task" : "tasks"}{row.overdueTasks ? <>, <b>{row.overdueTasks} overdue</b></> : null}</p></div>
            <span className={`home-badge ${row.tone}`}>{row.label}</span>
            <time>{row.due}</time>
          </Link>)}
        </div>
        <FooterLink href="/projects">All projects</FooterLink>
      </section>
    </div>

    <div className="dashboard-columns">
      <ReviewQueuePanel items={view.reviewQueue} total={view.reviewTotal} problem={view.problems.reviews} />
      <section className="panel" aria-labelledby="workload-title">
        <div className="panel-title"><h2 id="workload-title"><BarChart3 size={16} />Team workload</h2><small>{workload ? `${workload.totalOpen} open tasks` : ""}</small></div>
        <div className="workload-list">
          {view.problems.workload && <InlineProblem>{view.problems.workload}</InlineProblem>}
          {workload && workload.rows.length === 0 && <EmptyState title="No team members yet" body="Invite people from Team to share the work." action={{ href: "/team", label: "Open team" }} />}
          {workload?.rows.map((row) => <Link href={row.href} className="workload-row" key={row.id} aria-label={`${row.name}: ${row.open} open, ${row.overdue} overdue`}>
            <Avatar initials={row.initials} url={row.avatarUrl} />
            <div className="workload-main">
              <div className="workload-label"><strong>{row.name}</strong><span>{row.open} open{row.overdue ? <b> · {row.overdue} overdue</b> : null}{row.dueThisWeek ? ` · ${row.dueThisWeek} this week` : ""}</span></div>
              <div className="workload-track" aria-hidden="true"><i style={{ width: `${row.percent}%` }} />{row.overduePercent > 0 && <em style={{ width: `${row.overduePercent}%` }} />}</div>
            </div>
          </Link>)}
          {workload && workload.unassigned.open > 0 && <Link href="/tasks" className="workload-unassigned">
            {workload.unassigned.open} unassigned {workload.unassigned.open === 1 ? "task" : "tasks"}{workload.unassigned.overdue ? `, ${workload.unassigned.overdue} overdue` : ""}
          </Link>}
        </div>
        {workload && <div className="workload-legend" aria-hidden="true"><span><i />Open</span><span><em />Overdue</span></div>}
      </section>
    </div>

    <ActivityPanel items={view.activity} problem={view.problems.activity} className="is-wide" />
  </div>;
}
