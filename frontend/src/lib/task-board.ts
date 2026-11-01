/**
 * Pure logic behind the Tasks workflow board: stages, grouping, ordering, move guards,
 * filters and due dates. No React here, so every rule is unit-tested on its own and the
 * board, list, detail sheet and keyboard paths all share one implementation.
 */
import type { Task, TaskStage, TaskStageKind } from "./api";

export type StageKind = TaskStageKind;
export type BoardStage = {
  id: string; name: string; kind: StageKind; color: string;
  wipLimit: number | null; isDone: boolean; automationEnabled: boolean;
};

/** The six built-in stages, in board order. Used when a workspace has none (demo / error). */
export const DEFAULT_STAGES: readonly BoardStage[] = [
  { id: "todo", name: "To Do", kind: "todo", color: "#a3a3b0", wipLimit: null, isDone: false, automationEnabled: true },
  { id: "in_progress", name: "In Progress", kind: "in_progress", color: "#b0a2fe", wipLimit: null, isDone: false, automationEnabled: true },
  { id: "review", name: "Review", kind: "review", color: "#47d6cf", wipLimit: null, isDone: false, automationEnabled: true },
  { id: "client_review", name: "Client Review", kind: "client_review", color: "#67b0f9", wipLimit: null, isDone: false, automationEnabled: true },
  { id: "revisions", name: "Revisions", kind: "revisions", color: "#fd7277", wipLimit: null, isDone: false, automationEnabled: true },
  { id: "approved", name: "Approved", kind: "approved", color: "#5bd295", wipLimit: null, isDone: true, automationEnabled: true },
];

/** Stage names from before `kind` existed, so an older payload still gets built-in styling. */
const KIND_BY_NAME: Record<string, StageKind> = {
  "to do": "todo", "in progress": "in_progress", "review": "review", "internal qa": "review",
  "client review": "client_review", "client": "client_review", "revisions": "revisions", "approved": "approved",
};

export function toBoardStages(stages: TaskStage[]): BoardStage[] {
  if (!stages.length) return [...DEFAULT_STAGES];
  const claimed = new Set<StageKind>();
  return [...stages].sort((a, b) => a.sort_order - b.sort_order).map((stage) => {
    let kind: StageKind = stage.kind ?? KIND_BY_NAME[stage.name.trim().toLowerCase()] ?? "custom";
    if (kind !== "custom" && claimed.has(kind)) kind = "custom";
    if (kind !== "custom") claimed.add(kind);
    return { id: stage.id, name: stage.name, kind, color: stage.color, wipLimit: stage.wip_limit, isDone: stage.is_done, automationEnabled: stage.automation_enabled };
  });
}

/**
 * Colour for a stage. Built-in kinds use design-system tokens (dot, pill text and tint all
 * pass AA); a custom stage's user hex can't be trusted for text, so it is dot-only and the
 * label stays neutral (`tone: null`).
 */
export function stageTone(stage: Pick<BoardStage, "kind" | "color">): { dot: string; tone: string | null } {
  const token: Partial<Record<StageKind, string>> = {
    todo: "var(--tb-stage-todo)", in_progress: "var(--tb-stage-in-progress)", review: "var(--tb-stage-review)",
    client_review: "var(--tb-stage-client-review)", revisions: "var(--tb-stage-revisions)", approved: "var(--tb-stage-approved)",
  };
  const value = token[stage.kind];
  return value ? { dot: value, tone: value } : { dot: stage.color, tone: null };
}

/** The column a task belongs in. A task whose stage no longer exists falls into the first column. */
export function stageIdOf(task: Pick<Task, "task_stage_id">, stages: readonly BoardStage[]): string {
  const id = task.task_stage_id;
  return id && stages.some((stage) => stage.id === id) ? id : stages[0]?.id ?? "";
}

/** Column order. Ties break on creation time, the same rule `POST tasks/<id>/move/` renumbers by. */
export function sortTasks<T extends Pick<Task, "sort_order" | "created_at">>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
}

/** Tasks grouped into their stage columns, each column in board order. Every stage gets a list. */
export function groupByStage<T extends Task>(tasks: T[], stages: readonly BoardStage[]): Map<string, T[]> {
  const groups = new Map<string, T[]>(stages.map((stage) => [stage.id, []]));
  for (const task of sortTasks(tasks)) groups.get(stageIdOf(task, stages))?.push(task);
  return groups;
}

/**
 * Optimistic move: the task goes to `toStageId` at `index` (end when omitted) and both
 * affected columns are renumbered 0..n, which mirrors what `POST tasks/<id>/move/` does.
 * Returns a new array; tasks outside the two columns are untouched.
 */
export function applyMove(tasks: Task[], taskId: string, toStageId: string, index: number | null, stages: readonly BoardStage[]): Task[] {
  const moving = tasks.find((task) => task.id === taskId);
  if (!moving) return tasks;
  const fromStageId = stageIdOf(moving, stages);
  const target = sortTasks(tasks.filter((task) => task.id !== taskId && stageIdOf(task, stages) === toStageId));
  const at = index === null || index === undefined ? target.length : Math.max(0, Math.min(index, target.length));
  const toStage = stages.find((stage) => stage.id === toStageId);
  const moved: Task = { ...moving, task_stage_id: toStageId, ...(toStage && fromStageId !== toStageId ? { status: toStage.isDone ? "APPROVED" : "TODO", completed_at: toStage.isDone ? (moving.completed_at ?? new Date().toISOString()) : null } : {}) };
  target.splice(at, 0, moved);
  const order = new Map<string, number>(target.map((task, i) => [task.id, i]));
  if (fromStageId !== toStageId) {
    sortTasks(tasks.filter((task) => task.id !== taskId && stageIdOf(task, stages) === fromStageId)).forEach((task, i) => order.set(task.id, i));
  }
  return tasks.map((task) => {
    if (task.id === taskId) return { ...moved, sort_order: order.get(taskId)! };
    const next = order.get(task.id);
    return next === undefined || next === task.sort_order ? task : { ...task, sort_order: next };
  });
}

/** Where a task sits in its column (0-based), for undo and announcements. */
export function positionOf(tasks: Task[], taskId: string, stages: readonly BoardStage[]): { stageId: string; index: number; size: number } {
  const task = tasks.find((item) => item.id === taskId);
  const stageId = task ? stageIdOf(task, stages) : stages[0]?.id ?? "";
  const column = sortTasks(tasks.filter((item) => stageIdOf(item, stages) === stageId));
  return { stageId, index: Math.max(0, column.findIndex((item) => item.id === taskId)), size: column.length };
}

export type MoveGuard =
  | { kind: "silent" }
  | { kind: "confirm"; dialog: "approve" | "reopen" | "client"; message: string }
  | { kind: "blocked"; reason: string };

/**
 * What happens when a task is moved between stages. Every path (drag, keyboard, menu, list,
 * detail sheet) runs this before committing, so the rules are identical everywhere.
 *
 * - Into the done stage: confirm ("approve").
 * - Out of the done stage: confirm ("reopen"), because the edit lock lifts.
 * - Into Client Review without a client: blocked; the hand-off notifies client contacts.
 * - Into Client Review with nothing attached: confirm, so a card isn't sent with no cut.
 * - Everything else, and same-column reorders: silent.
 */
export function moveGuard(task: Task, from: BoardStage | undefined, to: BoardStage, context: { clientId: string | null }): MoveGuard {
  if (!from || from.id === to.id) return { kind: "silent" };
  if (from.isDone && !to.isDone) return { kind: "confirm", dialog: "reopen", message: `“${task.title}” is approved. Reopening moves it back to ${to.name} and unlocks editing.` };
  if (to.isDone) return { kind: "confirm", dialog: "approve", message: `Mark “${task.title}” as approved? Approved work is locked for editing.` };
  if (to.kind === "client_review") {
    if (!context.clientId) return { kind: "blocked", reason: `${to.name} needs a client. Add a client or client project to “${task.title}” first.` };
    if (!(task.attachment_file_ids?.length)) return { kind: "confirm", dialog: "client", message: `“${task.title}” has no cut attached. Send it to ${to.name} anyway?` };
  }
  return { kind: "silent" };
}

// ---------------------------------------------------------------------------------------
// Due dates. Always in the viewer's local time; never overdue once the task is done.

export type DueState = "none" | "overdue" | "today" | "soon" | "later";
const DAY = 86_400_000;
const startOfDay = (time: number) => { const date = new Date(time); date.setHours(0, 0, 0, 0); return date.getTime(); };

export function dueState(dueAt: string | null, done: boolean, now: number = Date.now()): DueState {
  if (!dueAt) return "none";
  const due = new Date(dueAt).getTime();
  if (Number.isNaN(due)) return "none";
  if (!done && due < now) return "overdue";
  const days = Math.round((startOfDay(due) - startOfDay(now)) / DAY);
  if (days <= 0) return "today";
  if (days <= 2) return "soon";
  return "later";
}

/** "Today", "Tomorrow", "Yesterday" or "26 Sep" (with the year when it isn't this year). */
export function formatDue(dueAt: string | null, now: number = Date.now()): string {
  if (!dueAt) return "No date";
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return "No date";
  const days = Math.round((startOfDay(due.getTime()) - startOfDay(now)) / DAY);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  const sameYear = due.getFullYear() === new Date(now).getFullYear();
  return due.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

/** Full local date and time, for tooltips and the detail sheet. */
export function formatDueLong(dueAt: string | null): string {
  if (!dueAt) return "No due date";
  const due = new Date(dueAt);
  return Number.isNaN(due.getTime()) ? "No due date" : due.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ---------------------------------------------------------------------------------------
// Filters. The URL carries them on /tasks so a filtered board can be shared or bookmarked.

export type DueFilter = "" | "overdue" | "today" | "week" | "none";
export type TaskFilters = { q: string; assignee: string[]; priority: string[]; client: string[]; project: string[]; due: DueFilter };
export const EMPTY_FILTERS: TaskFilters = { q: "", assignee: [], priority: [], client: [], project: [], due: "" };
export const PRIORITIES = [{ id: "HIGH", label: "High" }, { id: "MEDIUM", label: "Medium" }, { id: "LOW", label: "Low" }] as const;
export const DUE_OPTIONS: readonly { id: Exclude<DueFilter, "">; label: string }[] = [
  { id: "overdue", label: "Overdue" }, { id: "today", label: "Due today" }, { id: "week", label: "Next 7 days" }, { id: "none", label: "No due date" },
];

const list = (value: string | null) => (value ? value.split(",").map((part) => part.trim()).filter(Boolean) : []);

export function parseFilters(params: URLSearchParams): TaskFilters {
  const due = params.get("due") ?? "";
  return {
    q: params.get("q") ?? "",
    assignee: list(params.get("assignee")),
    priority: list(params.get("priority")).map((value) => value.toUpperCase()),
    client: list(params.get("client")),
    project: list(params.get("project")),
    due: (DUE_OPTIONS.some((option) => option.id === due) ? due : "") as DueFilter,
  };
}

/** Writes the filters into `params`, leaving any other keys (e.g. `task`) alone. */
export function writeFilters(filters: TaskFilters, params: URLSearchParams = new URLSearchParams()): URLSearchParams {
  const set = (key: string, value: string) => (value ? params.set(key, value) : params.delete(key));
  set("q", filters.q.trim());
  set("assignee", filters.assignee.join(","));
  set("priority", filters.priority.map((value) => value.toLowerCase()).join(","));
  set("client", filters.client.join(","));
  set("project", filters.project.join(","));
  set("due", filters.due);
  return params;
}

export function activeFilterCount(filters: TaskFilters): number {
  return (filters.q.trim() ? 1 : 0) + filters.assignee.length + filters.priority.length + filters.client.length + filters.project.length + (filters.due ? 1 : 0);
}

export function matchesDue(dueAt: string | null, filter: DueFilter, now: number = Date.now()): boolean {
  if (!filter) return true;
  if (filter === "none") return !dueAt;
  if (!dueAt) return false;
  const due = new Date(dueAt).getTime();
  if (filter === "overdue") return due < now;
  if (filter === "today") return startOfDay(due) === startOfDay(now);
  return due >= now && due <= now + 7 * DAY;
}

export type FilterContext = { clientOf: (task: Task) => string | null; projectName: (task: Task) => string; clientName: (task: Task) => string; isDone: (task: Task) => boolean; now?: number };

export function matchTask(task: Task, filters: TaskFilters, context: FilterContext): boolean {
  const query = filters.q.trim().toLowerCase();
  if (query) {
    const haystack = `${task.title} ${task.description ?? ""} ${context.projectName(task)} ${context.clientName(task)} ${task.assignees.map((person) => person.name).join(" ")}`.toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  if (filters.assignee.length && !task.assignees.some((person) => filters.assignee.includes(person.id)) && !(filters.assignee.includes("none") && !task.assignees.length)) return false;
  if (filters.priority.length && !filters.priority.includes(task.priority)) return false;
  if (filters.client.length && !filters.client.includes(context.clientOf(task) ?? "")) return false;
  if (filters.project.length && !filters.project.includes(task.project_id ?? "")) return false;
  if (filters.due === "overdue" && context.isDone(task)) return false;
  return matchesDue(task.due_at, filters.due, context.now);
}

export const priorityLabel = (value: string) => PRIORITIES.find((item) => item.id === value)?.label ?? (value ? value[0] + value.slice(1).toLowerCase() : "");
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
