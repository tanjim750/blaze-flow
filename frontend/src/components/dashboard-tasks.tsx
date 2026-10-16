"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, PartyPopper } from "lucide-react";
import { useState, useTransition } from "react";
import type { Bucket, DashboardTask } from "@/lib/dashboard-view";
import { setTaskCompletedAction } from "@/app/(app)/tasks/actions";

const BUCKETS: Bucket[] = ["Today", "Upcoming", "Overdue"];
type Scope = "mine" | "all";

const EMPTY_COPY: Record<Bucket, { title: string; body: string }> = {
  Today: { title: "You're clear for today", body: "Nothing is due today." },
  Upcoming: { title: "Nothing coming up", body: "No open tasks are scheduled after today." },
  Overdue: { title: "Nothing overdue", body: "Every open task is on schedule." },
};

/**
 * The dashboard's task panel. Defaults to the viewer's own tasks (assigned to their
 * workspace membership) with a switch to see everyone's. Without a membership id — a
 * client-team viewer, or an older backend — there is no "mine", so it lists all.
 */
export function DashboardTasks({ tasks, membershipId = null, error = null }: { tasks: DashboardTask[]; membershipId?: string | null; error?: string | null }) {
  const [scope, setScope] = useState<Scope>(membershipId ? "mine" : "all");
  const [bucket, setBucket] = useState<Bucket>("Today");
  const [completed, setCompleted] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const [actionError, setActionError] = useState("");
  const scoped = scope === "mine" ? tasks.filter((task) => task.mine) : tasks;
  const visible = scoped.filter((task) => task.bucket === bucket);
  const count = (value: Bucket) => scoped.filter((task) => task.bucket === value).length;
  const empty = EMPTY_COPY[bucket];
  const showUpcoming = bucket === "Today" && count("Upcoming") > 0;
  const showOverdue = bucket !== "Overdue" && count("Overdue") > 0;
  const allHref = scope === "mine" && membershipId ? `/tasks?assignee=${membershipId}` : "/tasks";

  return <section className="panel tasks-panel" aria-labelledby="dashboard-tasks-title">
    <div className="panel-title">
      <h2 id="dashboard-tasks-title"><CheckCircle2 size={16} />{scope === "mine" ? "My tasks" : "All tasks"}</h2>
      <div className="task-controls">
        {membershipId && <div className="task-tabs" role="group" aria-label="Whose tasks">
          <button type="button" aria-pressed={scope === "mine"} className={scope === "mine" ? "selected" : ""} onClick={() => setScope("mine")}>Mine</button>
          <button type="button" aria-pressed={scope === "all"} className={scope === "all" ? "selected" : ""} onClick={() => setScope("all")}>Everyone</button>
        </div>}
        <div className="task-tabs" role="group" aria-label="Task date filter">
          {BUCKETS.map(value => (
            <button type="button" key={value} aria-pressed={bucket === value} className={bucket === value ? "selected" : ""} onClick={() => setBucket(value)}>
              {value}<span className="task-tab-count">{count(value)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
    <div className="task-list">
      {actionError && <p className="form-error" role="alert">{actionError}</p>}
      {error
        ? <div className="home-empty-state is-error" role="status"><strong>Tasks didn&apos;t load</strong><p>{error}</p></div>
        : visible.length === 0 && <div className="home-empty-state">
          {bucket === "Today" && scope === "mine" && <PartyPopper size={18} aria-hidden="true" />}
          <strong>{bucket === "Today" && scope === "all" ? "Nothing due today" : empty.title}</strong>
          <p>{empty.body}</p>
          {(showUpcoming || showOverdue) && <div className="home-empty-actions">
            {showUpcoming && <button type="button" className="home-empty-action" onClick={() => setBucket("Upcoming")}>View upcoming ({count("Upcoming")})</button>}
            {showOverdue && <button type="button" className="home-empty-action is-danger" onClick={() => setBucket("Overdue")}>{count("Overdue")} overdue</button>}
          </div>}
        </div>}
      {!error && visible.map(task => {
        const done = completed.includes(task.id);
        return <label className={`task-row ${done ? "completed" : ""}`} key={task.id}>
          <input
            type="checkbox"
            aria-label={`Complete ${task.name}`}
            checked={done}
            disabled={pending}
            onChange={event => {
              const checked = event.target.checked;
              setCompleted(checked ? [...completed, task.id] : completed.filter(id => id !== task.id));
              setActionError("");
              startTransition(async () => {
                const result = await setTaskCompletedAction(task.id, checked);
                if (result.error) {
                  setCompleted((value) => checked ? value.filter((id) => id !== task.id) : [...value, task.id]);
                  setActionError(result.error);
                }
              });
            }}
          />
          <span className="task-description">
            <strong>{task.name}</strong>
            <span>{task.project} · <b className={task.priority === "High" ? "high-priority" : ""}>{task.priority} Priority</b> · <time>{task.time}</time></span>
          </span>
          <span className={`home-badge ${done ? "success" : task.tone}`}>{done ? "Done" : task.status}</span>
        </label>;
      })}
    </div>
    <Link className="panel-footer-link" href={allHref}>{scope === "mine" ? "All my tasks" : "All tasks"} <ArrowRight size={13} /></Link>
  </section>;
}
