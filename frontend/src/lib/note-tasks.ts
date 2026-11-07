"use client";

import { useCallback, useEffect, useState } from "react";
import type { TaskSourceNote } from "./api";
import type { ReviewTarget } from "./review-media";

/** A note's task, as the review page shows it ("Task: Fix logo · In progress"). */
export type NoteTaskLink = { id: string; title: string; stage: string | null; done: boolean; href: string };
export type CarryOver = { available: number; previous: { id: string; version_number: number } | null; done: boolean };
export type NoteTaskDefaults = {
  comment_id: string; title: string; description: string; assignee_id: string | null; task_stage_id: string | null;
  project_id: string; existing: NoteTaskLink | null; source: TaskSourceNote | null;
};
export type NoteTaskInput = {
  comment_ids: string[]; title?: string; description?: string; assignee_id?: string | null;
  due_at?: string | null; task_stage_id?: string | null; sync_note_resolution?: boolean;
};
export type NoteTaskResult = { comment_id: string; task: NoteTaskLink; created: boolean };
type Result<T> = { ok: true; data: T } | { ok: false; detail: string };

function csrfToken(): string {
  return decodeURIComponent(document.cookie.split("; ").find((item) => item.startsWith("csrftoken="))?.slice(10) ?? "");
}

async function call<T>(url: string, body?: unknown): Promise<Result<T>> {
  try {
    const response = await fetch(url, {
      method: body === undefined ? "GET" : "POST", credentials: "include", cache: "no-store",
      headers: body === undefined ? {} : { "Content-Type": "application/json", "X-CSRFToken": csrfToken() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, detail: (data && typeof data.detail === "string" && data.detail) || `Request failed (${response.status}).` };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, detail: "Could not reach the server." };
  }
}

const versionBase = (t: ReviewTarget) => `/api/workspaces/${t.workspaceId}/projects/${t.projectId}/media-versions/${t.versionId}`;

export const noteTasksApi = {
  links: (t: ReviewTarget) => call<{ links: Record<string, NoteTaskLink>; carry_over: CarryOver }>(`${versionBase(t)}/note-tasks/`),
  defaults: (workspaceId: string, commentId: string) => call<NoteTaskDefaults>(`/api/workspaces/${workspaceId}/note-tasks/defaults/?comment=${commentId}`),
  create: (workspaceId: string, input: NoteTaskInput) => call<{ results: NoteTaskResult[] }>(`/api/workspaces/${workspaceId}/note-tasks/`, input),
  carryOver: (t: ReviewTarget) => call<CarryOver & { created: number }>(`${versionBase(t)}/carry-over/`, {}),
};

/** "Task: Fix logo timing (In progress)", or "(done)" once finished. */
export function chipLabel(link: NoteTaskLink) {
  return `Task: ${link.title}${link.done ? " (done)" : link.stage ? ` (${link.stage})` : ""}`;
}

/** First line of a note, trimmed to a task title (the server applies the same rule). */
export function titleFromNote(text: string, max = 120) {
  const first = (text.split("\n")[0] ?? "").trim() || "Review note";
  return first.length <= max ? first : `${first.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The review page's view of note ↔ task links for the cut on screen. Off (and silent) for
 * clients and for cuts with no server record. `refresh` is called after creating tasks and
 * after resolving a note, since that can move its task.
 */
export function useNoteTasks(target: ReviewTarget | null, enabled: boolean) {
  const [links, setLinks] = useState<Record<string, NoteTaskLink>>({});
  const [carry, setCarry] = useState<CarryOver | null>(null);
  const key = target && enabled ? `${target.workspaceId}/${target.projectId}/${target.versionId}` : null;
  const refresh = useCallback(async () => {
    if (!target || !enabled) return;
    const result = await noteTasksApi.links(target);
    if (result.ok) { setLinks(result.data.links); setCarry(result.data.carry_over); }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!key) return;
    let alive = true;
    void noteTasksApi.links(target!).then((result) => { if (alive && result.ok) { setLinks(result.data.links); setCarry(result.data.carry_over); } });
    // The task can move on the board in another tab; a light poll keeps the chips honest.
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 30_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { links: key ? links : {}, carry: key ? carry : null, refresh };
}
