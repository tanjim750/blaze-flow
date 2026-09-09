"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { CalendarDays, Check, Circle, CirclePlus, ListChecks, Search, TriangleAlert, X } from "lucide-react";
import type { TasksView } from "@/lib/tasks-view";
import { createTaskAction, setTaskCompletedAction, type TaskActionState } from "./actions";

const initial: TaskActionState = { error: null, message: null };
type Filter = "OPEN" | "ALL" | "COMPLETED";

export function TasksBoard({ view }: { view: TasksView }) {
  const [filter, setFilter] = useState<Filter>("OPEN");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [state, createAction, creatingTask] = useActionState(createTaskAction, initial);
  const [pending, startTransition] = useTransition();
  const [actionError, setActionError] = useState("");
  const projectNames = useMemo(() => new Map(view.projects.map((project) => [project.id, project.name])), [view.projects]);
  const tasks = view.tasks.filter((task) => {
    const matchesFilter = filter === "ALL" || (filter === "COMPLETED" ? task.status === "COMPLETED" : !["COMPLETED", "CANCELLED"].includes(task.status));
    const needle = query.trim().toLowerCase();
    return matchesFilter && (!needle || `${task.title} ${task.description ?? ""} ${task.project_id ? projectNames.get(task.project_id) : ""}`.toLowerCase().includes(needle));
  });

  function toggle(taskId: string, complete: boolean) {
    setActionError("");
    startTransition(async () => {
      const result = await setTaskCompletedAction(taskId, complete);
      if (result.error) setActionError(result.error);
    });
  }

  return <div className="tasks-page">
    {view.notice && <p className="tasks-notice"><TriangleAlert size={15} />{view.notice}</p>}
    <header className="tasks-heading"><div><p className="eyebrow">Production planning</p><h1>Tasks</h1><p>Plan, prioritize, and finish work across the selected workspace.</p></div><button onClick={() => setCreating(true)}><CirclePlus size={17} />New task</button></header>
    <div className="tasks-toolbar">
      <div className="tasks-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tasks and projects…" /></div>
      <div className="tasks-filters">{(["OPEN", "ALL", "COMPLETED"] as Filter[]).map((value) => <button key={value} className={filter === value ? "active" : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value.toLowerCase()}</button>)}</div>
    </div>
    {actionError && <p className="form-error" role="alert">{actionError}</p>}
    <section className="tasks-list">
      {!tasks.length && <div className="tasks-empty"><ListChecks /><strong>No tasks here</strong><span>Adjust the filter or create the next piece of work.</span></div>}
      {tasks.map((task) => { const done = task.status === "COMPLETED"; return <article key={task.id} className={done ? "done" : ""}>
        <button className="task-complete" onClick={() => toggle(task.id, !done)} disabled={pending} aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}>{done ? <Check /> : <Circle />}</button>
        <div><h2>{task.title}</h2><p>{task.description || "No description"}</p><span>{task.project_id ? projectNames.get(task.project_id) ?? "Project" : "Workspace task"}</span></div>
        <div className="task-details"><b className={`priority-${task.priority.toLowerCase()}`}>{title(task.priority)}</b><time><CalendarDays size={13} />{due(task.due_at)}</time><small>{title(task.status)}</small></div>
      </article>; })}
    </section>
    {creating && <div className="task-modal"><button className="task-modal-backdrop" onClick={() => setCreating(false)} aria-label="Close" /><form action={createAction} className="task-create">
      <header><div><p className="eyebrow">Add work</p><h2>New task</h2></div><button type="button" onClick={() => setCreating(false)} aria-label="Close"><X /></button></header>
      <label>Title<input name="title" required autoFocus placeholder="Review final color grade" /></label>
      <label>Description<textarea name="description" rows={3} /></label>
      <div className="task-form-grid"><label>Project<select name="project_id"><option value="">Workspace-wide</option>{view.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label>Priority<select name="priority" defaultValue="MEDIUM"><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select></label></div>
      <label>Due date<input name="due_at" type="datetime-local" /></label>
      {state.error && <p className="form-error" role="alert">{state.error}</p>}{state.message && <p className="task-success">{state.message}</p>}
      <footer><button type="button" onClick={() => setCreating(false)}>Cancel</button><button disabled={creatingTask}>{creatingTask ? "Creating…" : "Create task"}</button></footer>
    </form></div>}
  </div>;
}

const title = (value: string) => value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
function due(value: string | null) { if (!value) return "No due date"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "No due date" : date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
