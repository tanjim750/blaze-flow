import Link from "next/link";
import { ArrowRight, CheckCheck, Download, FolderKanban, Inbox, MessagesSquare, Plus } from "lucide-react";
import { MessagesInbox } from "@/components/messages/inbox";
import { DashboardPoster } from "@/components/dashboard-poster";
import type { LayoutChoice } from "@/lib/dashboard-role";
import type { ClientDashboard as ClientView } from "@/lib/role-dashboard-view";
import { ClientUploadPanel } from "@/components/client-uploads/client-upload-panel";
import { ActivityPanel, CounterStrip, DashboardHeading, EmptyState, InlineProblem, ReviewQueuePanel } from "./parts";
import { ClientInvoicesPanel } from "./money-panels";
import { PortalBrandBar } from "@/components/portal/brand-bar";
import { ClientRequestList } from "@/components/portal/request-list";
import { accentStyle } from "@/lib/portal";
import "@/components/portal/portal.css";

function subline(view: ClientView): string {
  const waiting = view.waiting.length;
  if (waiting) return `${waiting} ${waiting === 1 ? "cut is" : "cuts are"} ready for your review.`;
  return "Nothing is waiting for your review right now.";
}

/**
 * The client layout (the client portal home): cuts to review, approved work, a place to
 * send files to the studio, invoices, recent activity and their projects. It never loads
 * tasks, workload or internal notes; activity is the API's client-scoped feed.
 */
export function ClientDashboard({ view, choice }: { view: ClientView; choice: LayoutChoice }) {
  const pending = view.requests?.items.filter((row) => row.status === "pending").length ?? 0;
  return <div className="home-shell role-client pt-scope" style={accentStyle(view.branding?.brand_color)}>
    {view.branding && <PortalBrandBar branding={view.branding}>
      <Link className="pt-ghost" href="/portal/chat" style={{ height: 36, padding: "0 12px" }}><MessagesSquare size={14} />Messages</Link>
      {view.requests && <Link className="pt-cta" href="/portal/requests/new"><Plus />Start a new project</Link>}
    </PortalBrandBar>}
    <DashboardHeading workspaceName={view.workspaceName} today={view.today} greetingName={view.greetingName} subline={subline(view)} choice={choice} />
    <CounterStrip items={view.strip} label="Your work" />

    <div className="dashboard-columns">
      <ReviewQueuePanel
        items={view.waiting.slice(0, 6)}
        total={view.waiting.length}
        problem={view.problems.reviews}
        title="Waiting for your review"
        totalLabel="to review"
        empty={{ title: "You're all caught up", body: "When the studio sends a cut for review, it shows up here." }}
      />
      <section className="panel" aria-labelledby="delivered-title">
        <div className="panel-title"><h2 id="delivered-title"><CheckCheck size={16} />Recently approved</h2><small>Delivered and signed off</small></div>
        <div className="review-list">
          {view.delivered.length === 0 && <EmptyState title="Nothing approved yet" body="Approved cuts and deliverables show up here." />}
          {view.delivered.map((cut) => <div className="review-row delivered-row" key={cut.id}>
            <DashboardPoster src={cut.poster} />
            <Link href={cut.href} className="review-description" aria-label={`Open review: ${cut.title} ${cut.version}`}>
              <strong>{cut.title}</strong>
              <p><span className="review-version">{cut.version}</span><span className="home-badge success">{cut.stage}</span><span className="review-project">{cut.project} · {cut.age}</span></p>
            </Link>
            {cut.downloadHref
              ? <a className="delivered-download" href={cut.downloadHref}><Download size={12} aria-hidden="true" />Download</a>
              : <time>{cut.age}</time>}
          </div>)}
        </div>
      </section>
    </div>

    {(view.portal || view.activity) && <div className={`dashboard-columns client-portal-row${view.portal && view.activity ? "" : " is-single"}`}>
      {view.portal && <ClientUploadPanel workspaceId={view.portal.workspaceId} projects={view.portal.projects} recent={view.portal.recent} maxBytes={view.portal.maxBytes} accept={view.portal.accept} />}
      {view.activity && <ActivityPanel
        items={view.activity}
        problem={view.problems.activity ?? null}
        hint="On your projects"
        emptyBody="New cuts, notes, approvals and files you send show up here."
      />}
    </div>}

    {view.messages && view.messages.summary.projects.length > 0 && <section className="panel pt-home-messages" aria-labelledby="messages-title">
      <div className="panel-title"><h2 id="messages-title"><MessagesSquare size={16} />Messages with the studio</h2><small>{view.messages.summary.total_unread ? `${view.messages.summary.total_unread} unread` : "All caught up"}</small></div>
      <MessagesInbox workspaceId={view.messages.workspaceId} initial={view.messages.summary} limit={4} emptyText="No messages yet. Open a project to write to the studio." />
      {view.messages.summary.projects.length > 4 && <Link className="pt-back" href="/portal/chat">All conversations<ArrowRight size={14} /></Link>}
    </section>}

    {view.requests && view.requests.items.length > 0 && <section className="panel pt-home-requests" aria-labelledby="requests-title">
      <div className="panel-title"><h2 id="requests-title"><Inbox size={16} />Your project requests</h2><small>{pending ? `${pending} with the studio` : "All answered"}</small></div>
      <ClientRequestList workspaceId={view.requests.workspaceId} requests={view.requests.items.slice(0, 3)} compact />
      {view.requests.items.length > 3 && <Link className="pt-back" href="/portal/requests">See all {view.requests.items.length} requests<ArrowRight size={14} /></Link>}
    </section>}

    {view.invoices && <ClientInvoicesPanel invoices={view.invoices} />}

    <section className="section-block active-projects">
      <div className="section-heading"><h2><FolderKanban size={16} />Your projects <span>{view.projects.length}</span></h2></div>
      {view.problems.reviews && <InlineProblem>Some counts may be missing.</InlineProblem>}
      {view.projects.length === 0
        ? <div className="home-empty-state is-panel"><strong>No projects yet</strong><p>Projects the studio shares with you appear here.</p></div>
        : <div className="home-project-grid">
          {view.projects.map((project) => <Link href={project.href} className="home-project-card" key={project.id}>
            <div className="home-project-meta"><span className={`home-badge ${project.tone}`}>{project.status}</span></div>
            <h3>{project.title}</h3><p>{project.due}</p>
            <div className="home-project-progress"><span>{project.waiting ? `${project.waiting} ${project.waiting === 1 ? "cut" : "cuts"} to review` : "Nothing to review"}</span></div>
          </Link>)}
        </div>}
    </section>
  </div>;
}
