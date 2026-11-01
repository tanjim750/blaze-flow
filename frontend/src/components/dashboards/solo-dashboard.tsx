import Link from "next/link";
import { CalendarClock, ClipboardCheck, FolderKanban, FolderPlus, ListTodo, MessageSquareText, Plus, ReceiptText, Share2, UserPlus, Wallet } from "@/components/icons";
import { DashboardPoster } from "@/components/dashboard-poster";
import type { LayoutChoice } from "@/lib/dashboard-role";
import { formatMoney } from "@/lib/money";
import type { SoloDashboard as SoloView, SoloTask } from "@/lib/solo-dashboard-view";
import { accountTitle } from "@/lib/user";
import { ActivityPanel, Avatar, EmptyState, FooterLink, InlineProblem, ViewAsSwitch } from "./parts";
import "./solo-dashboard.css";

const ACTIONS = [
  { href: "/projects", label: "New project", icon: FolderPlus },
  { href: "/tasks", label: "New task", icon: Plus },
  { href: "/money", label: "New invoice", icon: ReceiptText },
  { href: "/clients", label: "Add client", icon: UserPlus },
  { href: "/files", label: "Share review link", icon: Share2 },
];

function TaskRow({ task }: { task: SoloTask }) {
  return <Link href={task.href} className="solo-task">
    <span className={`solo-task-dot${task.overdue ? " is-overdue" : ""}`} aria-hidden="true" />
    <span className="solo-task-main"><strong>{task.title}</strong><small>{task.project ?? "No project"}</small></span>
    <time className={task.overdue ? "is-overdue" : undefined}>{task.due}</time>
  </Link>;
}

/** The Solo editor dashboard: my day, my projects, my clients, my money. No team widgets. */
export function SoloDashboard({ view, choice }: { view: SoloView; choice: LayoutChoice }) {
  const { tasks, money } = view;
  const dueNow = [...tasks.overdue, ...tasks.today];
  return <div className="home-shell role-owner is-solo">
    <section className="solo-hero" aria-labelledby="solo-hello">
      <div className="solo-hero-text">
        <p className="solo-hero-date">{view.today} · <span>{view.workspaceName}</span></p>
        <h1 id="solo-hello">{accountTitle(view.greetingName)}</h1>
        <p className="solo-hero-line">{view.headline}</p>
      </div>
      {choice.canSwitch && <ViewAsSwitch choice={choice} />}
      <nav className="solo-actions" aria-label="Quick actions">
        {ACTIONS.map(({ href, label, icon: Icon }) => <Link key={label} href={href} className="solo-action"><Icon size={15} aria-hidden="true" /><span>{label}</span></Link>)}
      </nav>
    </section>

    {money && <section className="solo-money" aria-label="Money snapshot">
      <Link href="/money" className="solo-money-card">
        <span><Wallet size={14} aria-hidden="true" />Unpaid invoices</span>
        <strong>{formatMoney(money.unpaid, money.currency)}</strong>
        <small>{money.unpaidCount} {money.unpaidCount === 1 ? "invoice" : "invoices"} out</small>
      </Link>
      <Link href="/money" className="solo-money-card is-good">
        <span><ReceiptText size={14} aria-hidden="true" />Paid this month</span>
        <strong>{formatMoney(money.paidThisMonth, money.currency)}</strong>
        <small>Collected since the 1st</small>
      </Link>
      <Link href="/money" className={`solo-money-card${money.overdueCount ? " is-danger" : ""}`}>
        <span><CalendarClock size={14} aria-hidden="true" />Overdue</span>
        <strong>{formatMoney(money.overdue, money.currency)}</strong>
        <small>{money.overdueCount ? `${money.overdueCount} past due` : "Nothing past due"}</small>
      </Link>
    </section>}
    {view.problems.money && <InlineProblem>{view.problems.money}</InlineProblem>}

    <div className="dashboard-columns solo-columns">
      <section className="panel" aria-labelledby="solo-tasks-title">
        <div className="panel-title">
          <h2 id="solo-tasks-title"><ListTodo size={16} />Today and overdue</h2>
          <small>{tasks.overdue.length} overdue · {tasks.today.length} today</small>
        </div>
        <div className="solo-task-list">
          {view.problems.tasks && <InlineProblem>{view.problems.tasks}</InlineProblem>}
          {!view.problems.tasks && dueNow.length === 0 && <EmptyState title="Nothing due today" body="Tasks due today or already late show up here." action={{ href: "/tasks", label: "Open tasks" }} />}
          {dueNow.slice(0, 6).map((task) => <TaskRow key={task.id} task={task} />)}
        </div>
        {dueNow.length > 6 && <FooterLink href="/tasks">All {dueNow.length} tasks</FooterLink>}
      </section>

      <section className="panel" aria-labelledby="solo-projects-title">
        <div className="panel-title"><h2 id="solo-projects-title"><FolderKanban size={16} />Active projects</h2><small>{view.projects.length} open</small></div>
        <div className="health-list">
          {view.projects.length === 0 && <EmptyState title="No active projects" body="Start a project for your next client job." action={{ href: "/projects", label: "New project" }} />}
          {view.projects.map((project) => <Link href={project.href} className="health-row" key={project.id}>
            <div><strong>{project.name}</strong><p>{project.client ?? "No client"} · {project.openTasks} open {project.openTasks === 1 ? "task" : "tasks"}</p></div>
            <span className={`home-badge ${project.tone}`}>{project.tone === "danger" ? "Overdue" : project.tone === "warning" ? "Due soon" : project.tone === "success" ? "On track" : "No date"}</span>
            <time>{project.due}</time>
          </Link>)}
        </div>
        <FooterLink href="/projects">All projects</FooterLink>
      </section>

      <section className="panel" aria-labelledby="solo-review-title">
        <div className="panel-title"><h2 id="solo-review-title"><ClipboardCheck size={16} />Waiting on clients</h2><small>{view.awaiting.length} in client review</small></div>
        <div className="review-list">
          {view.problems.review && <InlineProblem>{view.problems.review}</InlineProblem>}
          {!view.problems.review && view.awaiting.length === 0 && <EmptyState title="Nothing with clients" body="Cuts you send for client review or approval show up here." action={{ href: "/files", label: "Share a review link" }} />}
          {view.awaiting.slice(0, 4).map((item) => <Link href={item.href} className="review-row" key={item.id} aria-label={`Open review: ${item.title} ${item.version}`}>
            <DashboardPoster src={item.poster} />
            <div className="review-description">
              <strong>{item.title}</strong>
              <p><span className="review-version">{item.version}</span><span className={`home-badge ${item.tone}`}>{item.stage}</span><span className="review-project">{item.client ? `${item.client} · ` : ""}{item.project}</span></p>
            </div>
            <time>{item.age}</time>
          </Link>)}
        </div>
      </section>

      <section className="panel" aria-labelledby="solo-feedback-title">
        <div className="panel-title"><h2 id="solo-feedback-title"><MessageSquareText size={16} />Recent client feedback</h2><small>From review links</small></div>
        <div className="activity-list">
          {view.problems.feedback && <InlineProblem>{view.problems.feedback}</InlineProblem>}
          {!view.problems.feedback && view.feedback.length === 0 && <EmptyState title="No new client notes" body="Notes your clients leave on a cut show up here." />}
          {view.feedback.map((note) => <Link href={note.href} className="activity-row" key={note.id}>
            <Avatar initials={note.initials} url={note.avatarUrl} tone="accent" />
            <div><p><strong>{note.author}</strong> {note.text}</p><small>{note.cut}{note.timecode ? ` · ${note.timecode}` : ""} · {note.age}</small></div>
          </Link>)}
        </div>
      </section>
    </div>

    <ActivityPanel items={view.activity} problem={view.problems.activity} hint="Your workspace" className="solo-activity" />
  </div>;
}
