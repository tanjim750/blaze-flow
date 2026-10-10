import Link from "next/link";
import { ArrowRight, Eye, Film, Layers2, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { DashboardPoster } from "@/components/dashboard-poster";
import type { ActivityItem, ReviewQueueItem } from "@/lib/dashboard-view";
import { DASHBOARD_LAYOUTS, LAYOUT_LABELS, previewNotice, viewAsHref, type LayoutChoice } from "@/lib/dashboard-role";
import type { StripItem } from "@/lib/role-dashboard-view";

export function partOfDay(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  return hour < 18 ? "afternoon" : "evening";
}

export function DashboardHeading({ workspaceName, today, greetingName, subline, choice }: {
  workspaceName: string; today: string; greetingName: string; subline: string; choice: LayoutChoice;
}) {
  return <>
    <div className="dashboard-heading has-switch">
      <div>
        <p><span>{workspaceName.toUpperCase()}</span><b>·</b>{today}</p>
        <h1>Good {partOfDay()}, {greetingName}</h1>
        <div>{subline}</div>
      </div>
      {choice.canSwitch && <ViewAsSwitch choice={choice} />}
    </div>
    {choice.previewing && <PreviewBanner choice={choice} />}
  </>;
}

/** Owners only. Links, not state: a preview is shareable and survives a refresh. */
export function ViewAsSwitch({ choice }: { choice: LayoutChoice }) {
  return <nav className="view-as" aria-label="View dashboard as">
    <span><Eye size={13} aria-hidden="true" />View as</span>
    <div className="task-tabs">
      {DASHBOARD_LAYOUTS.map((layout) => <Link
        key={layout}
        href={viewAsHref(layout)}
        className={choice.layout === layout ? "selected" : ""}
        aria-current={choice.layout === layout ? "page" : undefined}
        prefetch={false}
      >{LAYOUT_LABELS[layout]}{layout === choice.role && <small> (you)</small>}</Link>)}
    </div>
  </nav>;
}

function PreviewBanner({ choice }: { choice: LayoutChoice }) {
  return <div className="preview-banner" role="status">
    <Eye size={14} aria-hidden="true" />
    <p><strong>Preview: {LAYOUT_LABELS[choice.layout]} dashboard.</strong> {previewNotice(choice.layout)}</p>
    <Link href={viewAsHref(choice.role)}>Back to your dashboard</Link>
  </div>;
}

export function CounterStrip({ items, label = "Today" }: { items: StripItem[]; label?: string }) {
  return <section className="today-strip" aria-label={label}>
    {items.map((item) => <div key={item.label} className={`today-counter${item.value === 0 ? " is-zero" : ""}${item.danger && (item.value ?? 0) > 0 ? " is-danger" : ""}`} title={item.title}>
      <strong>{item.value ?? "—"}</strong><span>{item.label}</span>
    </div>)}
  </section>;
}

export function InlineProblem({ children }: { children: ReactNode }) {
  return <p className="home-inline-problem" role="status"><TriangleAlert size={13} aria-hidden="true" />{children}</p>;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: { href: string; label: string } }) {
  return <div className="home-empty-state">
    <strong>{title}</strong>
    <p>{body}</p>
    {action && <Link className="home-empty-action" href={action.href}>{action.label}</Link>}
  </div>;
}

export function Avatar({ initials, url, tone = "" }: { initials: string; url?: string | null; tone?: string }) {
  return <span className={`activity-avatar ${tone}`} aria-hidden="true">
    {/* eslint-disable-next-line @next/next/no-img-element -- avatars are arbitrary user URLs */}
    {url ? <img src={url} alt="" /> : initials}
  </span>;
}

export function ActivityPanel({ items, problem, title = "Recent activity", hint = "Across the workspace", emptyBody, className = "" }: {
  items: ActivityItem[]; problem: string | null; title?: string; hint?: string; emptyBody?: string; className?: string;
}) {
  return <section className={`panel activity-panel ${className}`}>
    <div className="panel-title"><h2><Layers2 size={16} />{title}</h2><small>{hint}</small></div>
    <div className="activity-list">
      {problem && <InlineProblem>{problem}</InlineProblem>}
      {!problem && items.length === 0 && <EmptyState title="Nothing yet" body={emptyBody ?? "Uploads, review notes, approvals, task moves and client link visits show up here."} />}
      {items.map((item) => {
        const body = <>
          <Avatar initials={item.initials} url={item.avatarUrl} tone={item.tone} />
          <div><p><strong>{item.actor}</strong> {item.action}</p><small>{item.detail}</small></div>
        </>;
        return item.href
          ? <Link href={item.href} className="activity-row" key={item.id}>{body}</Link>
          : <div className="activity-row" key={item.id}>{body}</div>;
      })}
    </div>
  </section>;
}

export function ReviewQueuePanel({ items, total, problem, title = "Review queue", totalLabel = "awaiting review", empty }: {
  items: ReviewQueueItem[]; total: number; problem: string | null; title?: string; totalLabel?: string;
  empty?: { title: string; body: string; action?: { href: string; label: string } };
}) {
  return <section className="panel" aria-labelledby="review-queue-title">
    <div className="panel-title">
      <h2 id="review-queue-title"><Film size={16} />{title}</h2>
      <small>{total} {totalLabel}</small>
    </div>
    <div className="review-list">
      {problem && <InlineProblem>{problem}</InlineProblem>}
      {items.length === 0 && <EmptyState {...(empty ?? { title: "Nothing is waiting for review", body: "Cuts moved to In review or Approval show up here.", action: { href: "/files", label: "Open files" } })} />}
      {items.map((item) => <Link href={item.href} className="review-row" key={item.id} aria-label={`Open review: ${item.title} ${item.version}, ${item.stage}`}>
        <DashboardPoster src={item.poster} />
        <div className="review-description">
          <strong>{item.title}</strong>
          <p><span className="review-version">{item.version}</span><span className={`home-badge ${item.tone}`}>{item.stage}</span><span className="review-project">{item.project}</span></p>
        </div>
        <time>{item.age}</time>
      </Link>)}
    </div>
  </section>;
}

export function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link className="panel-footer-link" href={href}>{children} <ArrowRight size={13} /></Link>;
}
