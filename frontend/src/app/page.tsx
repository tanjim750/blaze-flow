import Link from "next/link";
import {
  ArrowRight, CalendarDays, Clock3, Film, Folder, FolderKanban, Layers2, ListChecks,
  MessageSquareText, TriangleAlert, Zap,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { DashboardTasks } from "@/components/dashboard-tasks";
import { loadDashboardView } from "@/lib/dashboard-view";
import type { AttentionItem } from "@/lib/dashboard-view";
import { displayName, loadSession } from "@/lib/session";
import "./home.css";

const ATTENTION_ICONS = { clock: Clock3, message: MessageSquareText, checks: ListChecks };

export default async function Dashboard() {
  // Redirects to /sign-in when the API says we are unauthenticated.
  const session = await loadSession();
  const view = await loadDashboardView(session.user ? displayName(session.user).split(" ")[0] : "there");
  const notice = session.notice ?? view.notice;

  return <AppShell>
    <div className="home-shell">
    {notice && <p className="home-notice"><TriangleAlert size={14} /><span>{notice}</span></p>}

    <div className="dashboard-heading">
      <p><span>{view.workspaceName.toUpperCase()}</span><b>·</b>{view.today}</p>
      <h1>Good {partOfDay()}, {view.greetingName}</h1>
      <div>
        {view.activeProjectCount
          ? `Here's what needs your attention today across ${view.activeProjectCount} active ${view.activeProjectCount === 1 ? "project" : "projects"}.`
          : "No projects yet — create one to get started."}
      </div>
    </div>

    <section className="stat-grid" aria-label="Workspace summary">
      <Stat label="Active Projects" value={view.stats.activeProjects} icon={<Folder />} />
      <Stat label="Tasks Due Today" value={view.stats.dueToday} icon={<CalendarDays />} tone="warning" />
      <Stat label="Overdue Tasks" value={view.stats.overdue} icon={<TriangleAlert />} tone="danger" dot={view.stats.overdue > 0} />
      <Stat label="Awaiting Review" value={view.stats.awaitingReview} icon={<MessageSquareText />} tone="accent" />
    </section>

    {view.attention.length > 0 && (
      <section className="section-block">
        <div className="section-heading">
          <h2><Zap size={17} />Needs Attention <span>{view.attention.length} {view.attention.length === 1 ? "Item" : "Items"}</span></h2>
          <p>Calm urgency · Prioritized by client milestones</p>
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
      <DashboardTasks tasks={view.tasks} />
      <section className="panel">
        <div className="panel-title">
          <h2><Film size={17} />Review Queue</h2>
          <small>{view.reviewQueue.length} {view.reviewQueue.length === 1 ? "cut" : "cuts"} pending</small>
        </div>
        <div className="review-list">
          {view.reviewQueue.length === 0 && <p className="home-empty">Nothing is waiting for review.</p>}
          {view.reviewQueue.map(item => <Link href={item.href} className="review-row" key={item.id}>
            {/* The media list serializer exposes no poster frame, so the slot keeps a tinted plate. */}
            <div className="review-thumbnail review-plate"><Film size={18} /></div>
            <div className="review-description">
              <small className={item.tone}>{item.version}</small>
              <strong>{item.title}</strong>
              <p>{item.project}</p>
              <span className="review-open">Open Review <ArrowRight size={12} /></span>
            </div>
            <time>{item.age}</time>
          </Link>)}
        </div>
      </section>
    </div>

    <section className="section-block active-projects">
      <div className="section-heading"><h2><FolderKanban size={17} />Active Projects</h2><Link href="/projects">View all projects <ArrowRight size={13} /></Link></div>
      <div className="home-project-grid">
        {view.projects.length === 0 && <p className="home-empty">No projects yet.</p>}
        {view.projects.map(project => <Link href={project.href} className="home-project-card" key={project.id}>
          <div className="home-project-meta">
            <span className={`home-badge ${project.tone}`}>{project.status}</span>
            <span className={project.priority === "High" ? "high-priority" : ""}>{project.priority} ↗</span>
          </div>
          <h3>{project.title}</h3><p>Due {project.date}</p>
          <div className="home-project-progress"><span>Tasks: {project.tasks}</span><strong>{project.percent}%</strong></div>
          <div className="home-progress-track" role="progressbar" aria-label={`${project.title} completion`} aria-valuenow={project.percent} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${project.percent}%` }} /></div>
        </Link>)}
      </div>
    </section>

    <div className="dashboard-bottom">
      <section className="panel deadlines-panel">
        <div className="panel-title"><h2><CalendarDays size={17} />Upcoming Deadlines</h2><small>Next 7 Days</small></div>
        <div className="deadline-list">
          {view.deadlines.length === 0 && <p className="home-empty">No upcoming deadlines.</p>}
          {view.deadlines.map(item => <Link href="/projects?view=tasks" className="deadline-row" key={item.id}>
            <div className="deadline-date"><small>{item.day}</small><strong>{item.date}</strong></div>
            <div className="deadline-description"><strong>{item.title}</strong><p>{item.project}</p></div>
            <span className={`home-badge ${item.tone}`}>{item.priority}</span>
          </Link>)}
        </div>
      </section>
      <section className="panel activity-panel">
        <div className="panel-title"><h2><Layers2 size={17} />Recent Activity</h2><small className="activity-live"><i />live</small></div>
        <div className="activity-list">
          {view.activity.length === 0 && <p className="home-empty">No recent activity.</p>}
          {view.activity.map(item => <div className="activity-row" key={item.id}>
            <span className={`activity-avatar ${item.tone}`}>{item.initials}</span>
            <div><p>{item.text}</p><small>{item.detail}</small></div>
          </div>)}
        </div>
      </section>
    </div>
    </div>
  </AppShell>;
}

function partOfDay(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  return hour < 18 ? "afternoon" : "evening";
}

function Stat({ label, value, icon, tone = "neutral", dot = false }: { label: string; value: number; icon: React.ReactNode; tone?: string; dot?: boolean }) {
  return <article className={`stat-card ${tone}`}><div><p>{label}{dot && <i className="stat-dot" />}</p><strong>{value}</strong></div><span>{icon}</span></article>;
}
