import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight, CalendarDays, Clock3, CloudOff, Film, FolderKanban, Layers2, ListChecks,
  MessageSquareText, TriangleAlert, Zap,
} from "lucide-react";
import { DashboardPoster } from "@/components/dashboard-poster";
import { DashboardRetry } from "@/components/dashboard-retry";
import { DashboardTasks } from "@/components/dashboard-tasks";
import { loadDashboardView } from "@/lib/dashboard-view";
import type { AttentionItem, DashboardFailure, TodayCounts } from "@/lib/dashboard-view";
import { loadSession } from "@/lib/session";
import { displayName } from "@/lib/user";
import { listWorkspaces } from "@/lib/api";
import "./home.css";

const ATTENTION_ICONS = { clock: Clock3, message: MessageSquareText, checks: ListChecks };

export default async function Dashboard() {
  // Redirects to /sign-in when the API says we are unauthenticated.
  const session = await loadSession();
  if (session.user) {
    const workspaces = await listWorkspaces();
    if (workspaces.ok && workspaces.data.length === 0) redirect("/onboarding");
  }
  const view = await loadDashboardView(session.user ? displayName(session.user).split(" ")[0] : "there");
  if (view.status === "error") return <DashboardError view={view} />;

  const { counts } = view;
  return <>
    <div className="home-shell">
    <div className="dashboard-heading">
      <p><span>{view.workspaceName.toUpperCase()}</span><b>·</b>{view.today}</p>
      <h1>Good {partOfDay()}, {view.greetingName}</h1>
      <div>{headline(counts.activeProjects, view.openProjectCount)}</div>
    </div>

    <TodayStrip counts={counts} />

    {view.attention.length > 0 && (
      <section className="section-block">
        <div className="section-heading">
          <h2><Zap size={16} />Needs attention <span>{view.attention.length}</span></h2>
        </div>
        <div className="attention-grid">
          {view.attention.map((item: AttentionItem) => {
            const Icon = ATTENTION_ICONS[item.icon];
            return <article className={`attention-card ${item.tone}`} key={item.id}>
              <div className="attention-meta"><span className={`home-badge ${item.tone}`}>{item.eyebrow}</span><small>{item.client}</small></div>
              <h3>{item.title}</h3><p className="muted">{item.detail}</p>
              <footer><span><Icon size={13} />{item.footer}</span><Link href={item.href}>{item.action}<ArrowRight size={12} /></Link></footer>
            </article>;
          })}
        </div>
      </section>
    )}

    <div className="dashboard-columns">
      <DashboardTasks tasks={view.tasks} membershipId={view.membershipId} error={view.problems.tasks} />
      <section className="panel" aria-labelledby="review-queue-title">
        <div className="panel-title">
          <h2 id="review-queue-title"><Film size={16} />Review queue</h2>
          <small>{view.reviewTotal} awaiting review</small>
        </div>
        <div className="review-list">
          {view.problems.reviews && <p className="home-inline-problem" role="status"><TriangleAlert size={13} aria-hidden="true" />{view.problems.reviews}</p>}
          {view.reviewQueue.length === 0 && <div className="home-empty-state">
            <strong>Nothing is waiting for review</strong>
            <p>Cuts moved to In review or Approval show up here.</p>
            <Link className="home-empty-action" href="/files">Open files</Link>
          </div>}
          {view.reviewQueue.map(item => <Link href={item.href} className="review-row" key={item.id} aria-label={`Open review: ${item.title} ${item.version}, ${item.stage}`}>
            <DashboardPoster src={item.poster} />
            <div className="review-description">
              <strong>{item.title}</strong>
              <p><span className="review-version">{item.version}</span><span className={`home-badge ${item.tone}`}>{item.stage}</span><span className="review-project">{item.project}</span></p>
            </div>
            <time>{item.age}</time>
          </Link>)}
        </div>
      </section>
    </div>

    <section className="section-block active-projects">
      <div className="section-heading"><h2><FolderKanban size={16} />Projects <span>{view.openProjectCount}</span></h2><Link href="/projects">View all projects <ArrowRight size={13} /></Link></div>
      {view.projects.length === 0
        ? <div className="home-empty-state is-panel">
          <strong>No open projects</strong>
          <p>Projects that aren&apos;t completed or archived appear here.</p>
          <Link className="home-empty-action" href="/projects">Go to projects</Link>
        </div>
        : <div className="home-project-grid">
          {view.projects.map(project => <Link href={project.href} className="home-project-card" key={project.id}>
            <div className="home-project-meta">
              <span className={`home-badge ${project.tone}`}>{project.status}</span>
              <span className={project.priority === "High" ? "high-priority" : ""}>{project.priority}</span>
            </div>
            <h3>{project.title}</h3><p>Due {project.date}</p>
            <div className="home-project-progress"><span>Tasks {project.tasks}</span><strong>{project.percent}%</strong></div>
            <div className="home-progress-track" role="progressbar" aria-label={`${project.title} completion`} aria-valuenow={project.percent} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${project.percent}%` }} /></div>
          </Link>)}
        </div>}
    </section>

    <div className="dashboard-bottom">
      <section className="panel deadlines-panel">
        <div className="panel-title"><h2><CalendarDays size={16} />Upcoming deadlines</h2><small>Next 7 days</small></div>
        <div className="deadline-list">
          {view.problems.tasks && <p className="home-inline-problem" role="status"><TriangleAlert size={13} aria-hidden="true" />Deadlines come from tasks, which didn&apos;t load.</p>}
          {!view.problems.tasks && view.deadlines.length === 0 && <div className="home-empty-state"><strong>No deadlines this week</strong><p>Open tasks due in the next 7 days appear here.</p></div>}
          {view.deadlines.map(item => <Link href={`/tasks?task=${item.id}`} className="deadline-row" key={item.id}>
            <div className="deadline-date"><small>{item.day}</small><strong>{item.date}</strong></div>
            <div className="deadline-description"><strong>{item.title}</strong><p>{item.project}</p></div>
            <span className={`home-badge ${item.tone}`}>{item.priority}</span>
          </Link>)}
        </div>
      </section>
      <section className="panel activity-panel">
        <div className="panel-title"><h2><Layers2 size={16} />Recent activity</h2><small>Across the workspace</small></div>
        <div className="activity-list">
          {view.problems.activity && <p className="home-inline-problem" role="status"><TriangleAlert size={13} aria-hidden="true" />{view.problems.activity}</p>}
          {!view.problems.activity && view.activity.length === 0 && <div className="home-empty-state">
            <strong>Nothing yet</strong>
            <p>Uploads, review notes, approvals, task moves and client link visits show up here.</p>
          </div>}
          {view.activity.map(item => {
            const body = <>
              <span className={`activity-avatar ${item.tone}`} aria-hidden="true">
                {/* eslint-disable-next-line @next/next/no-img-element -- avatars are arbitrary user URLs */}
                {item.avatarUrl ? <img src={item.avatarUrl} alt="" /> : item.initials}
              </span>
              <div><p><strong>{item.actor}</strong> {item.action}</p><small>{item.detail}</small></div>
            </>;
            return item.href
              ? <Link href={item.href} className="activity-row" key={item.id}>{body}</Link>
              : <div className="activity-row" key={item.id}>{body}</div>;
          })}
        </div>
      </section>
    </div>
    </div>
  </>;
}

function headline(active: number, open: number): string {
  if (active > 0) return `Here's what needs your attention today across ${active} active ${active === 1 ? "project" : "projects"}.`;
  if (open > 0) return `${open} open ${open === 1 ? "project" : "projects"}, none marked Active yet.`;
  return "No open projects yet. Create one to get started.";
}

/** C-D2: one strip of inline counters. Zeros are quiet; overdue turns red only above zero. */
function TodayStrip({ counts }: { counts: TodayCounts }) {
  const mine = counts.taskScope === "mine";
  const items: { label: string; value: number | null; danger?: boolean; title?: string }[] = [
    { label: "Active projects", value: counts.activeProjects, title: "Projects whose status is Active" },
    { label: "Awaiting review", value: counts.awaitingReview, title: "Cuts in In review or Approval" },
    { label: mine ? "My tasks due today" : "Tasks due today", value: counts.dueToday },
    { label: mine ? "My overdue tasks" : "Overdue tasks", value: counts.overdue, danger: true },
  ];
  return <section className="today-strip" aria-label="Today">
    {items.map((item) => <div key={item.label} className={`today-counter${item.value === 0 ? " is-zero" : ""}${item.danger && (item.value ?? 0) > 0 ? " is-danger" : ""}`} title={item.title}>
      <strong>{item.value ?? "—"}</strong><span>{item.label}</span>
    </div>)}
  </section>;
}

function DashboardError({ view }: { view: DashboardFailure }) {
  return <div className="home-shell">
    <div className="dashboard-heading">
      <p>{view.today}</p>
      <h1>Good {partOfDay()}, {view.greetingName}</h1>
    </div>
    <section className="home-error" role="alert" aria-labelledby="dashboard-error-title">
      <CloudOff size={22} aria-hidden="true" />
      <h2 id="dashboard-error-title">{view.title}</h2>
      <p>{view.detail}</p>
      <DashboardRetry />
    </section>
  </div>;
}

function partOfDay(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  return hour < 18 ? "afternoon" : "evening";
}
