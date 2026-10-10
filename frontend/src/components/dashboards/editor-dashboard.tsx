import Link from "next/link";
import { CheckCircle2, Clapperboard, MessageSquareText, Users } from "lucide-react";
import { DashboardPoster } from "@/components/dashboard-poster";
import type { LayoutChoice } from "@/lib/dashboard-role";
import type { EditorDashboard as EditorView, EditorTask } from "@/lib/role-dashboard-view";
import { ActivityPanel, Avatar, CounterStrip, DashboardHeading, EmptyState, FooterLink, InlineProblem } from "./parts";
import { EarningsPanel } from "./money-panels";

function subline(view: EditorView): string {
  const overdue = view.tasks.overdue.length;
  const notes = view.notesTotal;
  if (!overdue && !notes) return "You're up to date: nothing overdue and no notes waiting on you.";
  const parts = [];
  if (notes) parts.push(`${notes} ${notes === 1 ? "note" : "notes"} to address`);
  if (overdue) parts.push(`${overdue} overdue ${overdue === 1 ? "task" : "tasks"}`);
  return `You have ${parts.join(" and ")}.`;
}

function TaskGroup({ title, tasks, tone }: { title: string; tasks: EditorTask[]; tone: string }) {
  if (!tasks.length) return null;
  return <div className="editor-task-group">
    <h3 className={tone}>{title} <span>{tasks.length}</span></h3>
    {tasks.slice(0, 5).map((task) => <Link href={task.href} className="editor-task-row" key={task.id}>
      <span className="task-description">
        <strong>{task.name}</strong>
        <span>{task.project} · <b className={task.priority === "High" ? "high-priority" : ""}>{task.priority} priority</b></span>
      </span>
      <span className={`home-badge ${task.tone}`}>{task.when}</span>
    </Link>)}
  </div>;
}

export function EditorDashboard({ view, choice }: { view: EditorView; choice: LayoutChoice }) {
  const { tasks } = view;
  const extra = [tasks.later ? `${tasks.later} later` : "", tasks.undated ? `${tasks.undated} undated` : ""].filter(Boolean).join(" · ");
  return <div className="home-shell role-editor">
    <DashboardHeading workspaceName={view.workspaceName} today={view.today} greetingName={view.greetingName} subline={subline(view)} choice={choice} />
    <CounterStrip items={view.strip} />

    <div className="dashboard-columns">
      <section className="panel tasks-panel" aria-labelledby="editor-tasks-title">
        <div className="panel-title"><h2 id="editor-tasks-title"><CheckCircle2 size={16} />My tasks</h2><small>Overdue and due in the next 7 days</small></div>
        <div className="editor-task-list">
          {view.problems.tasks && <InlineProblem>{view.problems.tasks}</InlineProblem>}
          {!view.problems.tasks && !tasks.overdue.length && !tasks.dueSoon.length && <EmptyState
            title={tasks.total ? "Nothing due this week" : "No open tasks assigned to you"}
            body={tasks.total ? `You have ${tasks.total} open ${tasks.total === 1 ? "task" : "tasks"}, none due in the next 7 days.` : "Tasks assigned to you show up here."}
          />}
          <TaskGroup title="Overdue" tasks={tasks.overdue} tone="is-danger" />
          <TaskGroup title="Due soon" tasks={tasks.dueSoon} tone="" />
          {extra && (tasks.overdue.length > 0 || tasks.dueSoon.length > 0) && <p className="editor-task-extra">Also open: {extra}</p>}
        </div>
        <FooterLink href={view.membershipId ? `/tasks?assignee=${view.membershipId}` : "/tasks"}>All my tasks</FooterLink>
      </section>

      <section className="panel" aria-labelledby="notes-title">
        <div className="panel-title"><h2 id="notes-title"><MessageSquareText size={16} />Notes to address</h2><small>{view.notesTotal} unresolved on your cuts</small></div>
        <div className="note-list">
          {view.problems.notes && <InlineProblem>{view.problems.notes}</InlineProblem>}
          {!view.problems.notes && view.notes.length === 0 && <EmptyState title="No notes waiting on you" body="Unresolved notes from others on cuts you uploaded or are assigned to show up here." />}
          {view.notes.map((note) => <Link href={note.href} className="note-row" key={note.id} aria-label={`Open note by ${note.author} on ${note.cut}${note.timecode ? ` at ${note.timecode}` : ""}`}>
            <Avatar initials={note.initials} url={note.avatarUrl} tone={note.guest ? "blue" : "accent"} />
            <div className="note-body">
              <p className="note-meta"><strong>{note.author}</strong>{note.guest && <span className="home-badge blue">Guest</span>}{note.team && <span className="home-badge">Team only</span>}<time>{note.age}</time></p>
              <p className="note-text">{note.text}</p>
              <p className="note-cut">{note.timecode && <span className="timecode-chip">{note.timecode}</span>}<span>{note.cut}</span><span className="review-project">· {note.project}</span>{note.replies > 0 && <span className="note-replies">{note.replies} {note.replies === 1 ? "reply" : "replies"}</span>}</p>
            </div>
          </Link>)}
        </div>
      </section>
    </div>

    {view.earnings && <EarningsPanel earnings={view.earnings} />}

    <div className="dashboard-bottom">
      <section className="panel" aria-labelledby="my-cuts-title">
        <div className="panel-title"><h2 id="my-cuts-title"><Clapperboard size={16} />My cuts in review</h2><small>{view.cuts.length} in review</small></div>
        <div className="review-list">
          {view.problems.cuts && <InlineProblem>{view.problems.cuts}</InlineProblem>}
          {!view.problems.cuts && view.cuts.length === 0 && <EmptyState title="None of your cuts are in review" body="Cuts you uploaded or are assigned to show here while they're in review, revision or approval." action={{ href: "/files", label: "Open files" }} />}
          {view.cuts.map((cut) => <Link href={cut.href} className="review-row" key={cut.id} aria-label={`Open review: ${cut.title} ${cut.version}, ${cut.stage}`}>
            <DashboardPoster src={cut.poster} />
            <div className="review-description">
              <strong>{cut.title}</strong>
              <p><span className="review-version">{cut.version}</span><span className={`home-badge ${cut.tone}`}>{cut.stage}</span><span className="review-project">{cut.openNotes ? `${cut.openNotes} open ${cut.openNotes === 1 ? "note" : "notes"} · ` : ""}{cut.project}</span></p>
            </div>
            <time title="In this stage since">{cut.age}</time>
          </Link>)}
        </div>
      </section>
      <ActivityPanel
        items={view.activity}
        problem={view.problems.activity}
        title="Activity on my work"
        hint="Others on your tasks and cuts"
        emptyBody="When someone comments on your cuts, moves your tasks or approves your work, it shows up here."
      />
    </div>
    <p className="role-footnote"><Users size={12} aria-hidden="true" />Your work means cuts you uploaded and cuts linked to tasks assigned to you.</p>
  </div>;
}
