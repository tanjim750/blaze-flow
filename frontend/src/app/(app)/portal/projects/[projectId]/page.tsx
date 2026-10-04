import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, CalendarClock, CheckCircle2, CircleDot, Clapperboard, Download, Eye, FileText, Flag, History, ListChecks, MessagesSquare, RotateCcw, Sparkles } from "lucide-react";
import { getClientPortalData, getClientProjectOverview } from "@/lib/api";
import { formatBytes } from "@/lib/client-uploads";
import { CUT_STATE_LABEL, PHASE_HINT, accentStyle, dayDate, dueLabel, splitTimeline, type TimelineEvent } from "@/lib/portal";
import { loadWorkspaceContext } from "@/lib/workspace";
import { PortalBrandBar } from "@/components/portal/brand-bar";
import { ClientUploadPanel } from "@/components/client-uploads/client-upload-panel";
import { ProjectThread } from "@/components/messages/thread";
import "@/components/portal/portal.css";

/* Posters are small, permission-checked images from our own API (as on the dashboard); plain <img> on purpose. */
/* eslint-disable @next/next/no-img-element */

export const metadata: Metadata = { title: "Project · Client portal · Blaze Flow" };

const EVENT_ICON: Record<TimelineEvent["kind"], typeof Flag> = {
  start: Flag, shared: Clapperboard, approved: CheckCircle2, changes: RotateCcw, due: CalendarClock,
};
const STATUS_WORDS: Record<string, string> = {
  DRAFT: "Getting started", ACTIVE: "In progress", ON_HOLD: "Paused", COMPLETED: "Finished",
};

/**
 * The client's page for one project: where it stands (five plain phases), what happened
 * when, the files they can take away, and the record of what they signed off. Built from
 * what a client may already see; tasks and internal stages never reach it.
 */
export default async function ClientProjectPage({ params }: PageProps<"/portal/projects/[projectId]">) {
  const { projectId } = await params;
  const context = await loadWorkspaceContext();
  const workspace = context.ok ? context.data.selected : null;
  if (!workspace) return <div className="pt-page"><p className="pt-alert is-error" role="alert">No workspace is available.</p></div>;
  const [loaded, portal] = await Promise.all([getClientProjectOverview(workspace.id, projectId), getClientPortalData(workspace.id)]);
  if (!loaded.ok) {
    return <div className="pt-page">
      <Link className="pt-back" href="/"><ArrowLeft size={14} />Back to your portal</Link>
      <p className="pt-alert is-error" role="alert">{loaded.error.status === 404 ? "This project is not available to you." : `The project could not be loaded: ${loaded.error.detail}`}</p>
    </div>;
  }
  const view = loaded.data;
  const now = new Date();
  const { past, ahead } = splitTimeline(view.timeline, now);
  const due = dueLabel(view.project.due_at, now);
  const live = view.cuts.filter((cut) => !cut.superseded);
  const deliverables = live.filter((cut) => cut.state === "approved").sort((a, b) => Number(b.downloadable) - Number(a.downloadable));
  const waiting = live.filter((cut) => cut.state === "waiting");
  const sendTarget = portal.ok ? portal.data.projects.find((project) => project.id === projectId) : undefined;
  const currentLabel = view.phases.find((phase) => phase.state === "current")?.label ?? "Delivered";

  return <div className="pt-page pt-scope" style={accentStyle(view.branding.brand_color)}>
    <Link className="pt-back" href="/"><ArrowLeft size={14} />Back to your portal</Link>
    <PortalBrandBar branding={view.branding} eyebrow={view.project.client_team_name ? `Prepared for ${view.project.client_team_name}` : "Client portal"} />

    <section className="pt-hero" aria-labelledby="pt-title">
      <div>
        <p className="pt-eyebrow">{STATUS_WORDS[view.project.status] ?? view.project.status} · now at {currentLabel}</p>
        <h1 id="pt-title">{view.project.name}</h1>
        <p>{PHASE_HINT[view.current_phase]}</p>
      </div>
      <div className="pt-facts">
        <div className={`pt-fact${view.counts.waiting ? " is-alert" : ""}`}><small>Ready for you</small><strong>{view.counts.waiting}</strong></div>
        <div className="pt-fact"><small>Approved</small><strong>{view.counts.approved}</strong></div>
        <div className="pt-fact"><small>{view.project.due_at && due ? due.charAt(0).toUpperCase() + due.slice(1) : "Due date"}</small><strong>{view.project.due_at ? dayDate(view.project.due_at, now) : "Not set"}</strong></div>
      </div>
    </section>

    <ol className="pt-phases" aria-label="Project progress">
      {view.phases.map((phase, index) => <li key={phase.key} className={`pt-phase is-${phase.state}`} aria-current={phase.key === view.current_phase ? "step" : undefined}>
        <span className="pt-dot">{phase.state === "done" ? <CheckCircle2 size={14} aria-hidden="true" /> : index + 1}</span>
        <span>{phase.label}<span className="pt-sr">{phase.state === "done" ? " (done)" : phase.state === "current" ? " (current)" : ""}</span></span>
      </li>)}
    </ol>

    <div className="pt-body">
      <div className="pt-stack">
        {waiting.length > 0 && <section className="pt-card" aria-labelledby="pt-waiting">
          <div className="pt-card-head"><h2 id="pt-waiting"><Eye />Ready for your review</h2><small>{waiting.length} {waiting.length === 1 ? "cut" : "cuts"}</small></div>
          <ul className="pt-files">{waiting.map((cut) => <li className="pt-file" key={cut.id}>
            <span className="pt-thumb">{cut.poster_path ? <img src={cut.poster_path} alt="" /> : <Clapperboard size={16} aria-hidden="true" />}</span>
            <span className="pt-file-copy"><strong>{cut.title} · V{cut.version_number}</strong><small>Shared {dayDate(cut.stage_entered_at ?? cut.created_at, now)}</small></span>
            <span className="pt-file-actions"><Link className="pt-cta" href={cut.review_path}>Review</Link></span>
          </li>)}</ul>
        </section>}

        <section className="pt-card" aria-labelledby="pt-deliverables">
          <div className="pt-card-head"><h2 id="pt-deliverables"><Download />Your deliverables</h2><small>{view.counts.downloadable} ready to download</small></div>
          {!view.media_visible
            ? <p className="pt-empty">Your access does not include the project&apos;s cuts. Ask the studio if you need them.</p>
            : deliverables.length === 0
              ? <p className="pt-empty">Approved files land here. Once the studio switches on downloads you can save them straight from this page.</p>
              : <ul className="pt-files">{deliverables.map((cut) => <li className="pt-file" key={cut.id}>
                <span className="pt-thumb">{cut.poster_path ? <img src={cut.poster_path} alt="" /> : <FileText size={16} aria-hidden="true" />}</span>
                <span className="pt-file-copy">
                  <strong>{cut.title} · V{cut.version_number}</strong>
                  <small>{cut.file_name} · {formatBytes(cut.size_bytes)}</small>
                  <span className={`pt-pill is-${cut.state}`}>{CUT_STATE_LABEL[cut.state]}{cut.last_decision?.decision === "approved" ? ` by ${cut.last_decision.reviewer_name}` : ""}</span>
                </span>
                <span className="pt-file-actions">
                  <Link className="pt-ghost" href={cut.review_path} aria-label={`Watch ${cut.title} V${cut.version_number}`}><Eye />Watch</Link>
                  {cut.download_path
                    ? <a className="pt-cta" href={cut.download_path} download aria-label={`Download ${cut.title} V${cut.version_number}`}><Download />Download</a>
                    : <span className="pt-ghost" aria-disabled="true" title="The studio has not switched on downloads for this file yet">Not yet</span>}
                </span>
              </li>)}</ul>}
        </section>

        <section className="pt-card" aria-labelledby="pt-record">
          <div className="pt-card-head"><h2 id="pt-record"><ListChecks />Sign-off record</h2><small>Every approval and change request</small></div>
          {view.history.length === 0
            ? <p className="pt-empty">When you approve a cut or ask for changes, it is recorded here with the version and the date.</p>
            : <ul className="pt-record">{view.history.map((row) => <li key={row.id}>
              <div className="pt-record-line">
                <span className={`pt-pill is-${row.decision === "approved" ? "approved" : "changes"}`}>{row.decision === "approved" ? "Approved" : "Changes asked"}</span>
                <strong>{row.title} · V{row.version_number}</strong>
                <time dateTime={row.created_at}>{dayDate(row.created_at, now)}</time>
              </div>
              <small>by {row.reviewer_name}{row.decision === "approved" && row.open_notes_count > 0 ? ` · ${row.open_notes_count} open ${row.open_notes_count === 1 ? "note" : "notes"} at the time` : ""}</small>
              {row.message && <blockquote>{row.message}</blockquote>}
            </li>)}</ul>}
        </section>
      </div>

      <div className="pt-stack">
        <section className="pt-card" aria-labelledby="pt-timeline">
          <div className="pt-card-head"><h2 id="pt-timeline"><History />What&apos;s happened</h2></div>
          {ahead.map((event) => <p className="pt-ahead" key={`${event.kind}-${event.at}`}><CalendarClock />{event.title}: {dayDate(event.at, now)}{due ? ` (${due})` : ""}</p>)}
          <ol className="pt-timeline">{past.map((event, index) => {
            const Icon = EVENT_ICON[event.kind] ?? CircleDot;
            return <li className={`pt-event is-${event.kind}`} key={`${event.kind}-${event.at}-${index}`}>
              <span className="pt-event-icon"><Icon aria-hidden="true" /></span>
              <span className="pt-event-copy"><strong>{event.title}</strong><span>{event.text}</span></span>
              <time dateTime={event.at}>{dayDate(event.at, now)}</time>
            </li>;
          })}</ol>
        </section>

        {view.project.description && <section className="pt-card" aria-labelledby="pt-brief">
          <div className="pt-card-head"><h2 id="pt-brief"><Sparkles />The brief</h2>{view.request && <small>From your request of {dayDate(view.request.created_at, now)}</small>}</div>
          <p className="pt-brief">{view.project.description}</p>
        </section>}

        {sendTarget && portal.ok && <ClientUploadPanel
          workspaceId={workspace.id} projects={[sendTarget]}
          recent={portal.data.recent_uploads.filter((row) => row.project_id === projectId).slice(0, 5)}
          maxBytes={portal.data.max_file_bytes} accept={portal.data.accept}
        />}
      </div>
    </div>

    <section className="pt-card pt-messages" id="messages" aria-labelledby="pt-messages-title">
      <div className="pt-card-head"><h2 id="pt-messages-title"><MessagesSquare />Messages with the studio</h2><small>The team is notified when you write</small></div>
      <ProjectThread workspaceId={workspace.id} projectId={projectId} variant="portal" />
    </section>
  </div>;
}
