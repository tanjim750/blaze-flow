"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import type { Bucket, DashboardTask } from "@/lib/dashboard-view";

const BUCKETS: Bucket[] = ["Today", "Upcoming", "Overdue"];

export function DashboardTasks({ tasks }: { tasks: DashboardTask[] }) {
  const [bucket, setBucket] = useState<Bucket>("Today");
  /**
   * Ticking a task is local-only for now: the workspace task API exposes no completion
   * endpoint the dashboard can call, so the checkbox reflects intent within the session
   * rather than writing back.
   */
  const [completed, setCompleted] = useState<string[]>([]);
  const visible = tasks.filter((task) => task.bucket === bucket);
  const todayCount = tasks.filter((task) => task.bucket === "Today").length;

  return <section className="panel tasks-panel">
    <div className="panel-title">
      <h2><CheckCircle2 size={17} />My Tasks <small>({todayCount} today)</small></h2>
      <div className="task-tabs" aria-label="Task date filter">
        {BUCKETS.map(value => (
          <button key={value} aria-pressed={bucket === value} className={bucket === value ? "selected" : ""} onClick={() => setBucket(value)}>
            {value}
          </button>
        ))}
      </div>
    </div>
    <div className="task-list">
      {visible.length === 0 && <p className="home-empty">Nothing {bucket.toLowerCase()}.</p>}
      {visible.map(task => {
        const done = completed.includes(task.id);
        return <label className={`task-row ${done ? "completed" : ""}`} key={task.id}>
          <input
            type="checkbox"
            aria-label={`Complete ${task.name}`}
            checked={done}
            onChange={event => setCompleted(event.target.checked ? [...completed, task.id] : completed.filter(id => id !== task.id))}
          />
          <span className="task-description">
            <strong>{task.name}</strong>
            <span>{task.project} · <b className={task.priority === "High" ? "high-priority" : ""}>{task.priority} Priority</b> · <time>{task.time}</time></span>
          </span>
          <span className={`home-badge ${done ? "success" : task.tone}`}>{done ? "Done" : task.status}</span>
        </label>;
      })}
    </div>
    <Link className="panel-footer-link" href="/projects?view=tasks">View all tasks <ArrowRight size={13} /></Link>
  </section>;
}
