/**
 * The three role dashboards: owner, editor and client.
 *
 * Builders are pure (unit-tested); the loaders at the bottom fetch what each layout needs
 * and nothing more — the client layout never asks for tasks, workload or notes, so there is
 * nothing internal in its data to leak even by mistake. Every list here is already
 * permission-scoped by the API.
 */
import {
  getClientPortalData, getTeamWorkload, listActivity, listAssetFiles, listClientTeams, listMediaVersions, listMyCuts,
  listNotesToAddress, listProjects, listTaskStages, listTasks,
} from "./api";
import type {
  ApiFailure, ClientTeam, MediaVersion, MyCut, NoteToAddress, Project, ProjectFile, Task, TaskStage,
  TeamWorkload, Workspace,
} from "./api";
import {
  CLOSED_PROJECT_STATUSES, DASHBOARD_ACTIVITY_LIMIT, MONTHS, REVIEW_SCAN_LIMIT, awaitsReview, buildActivity,
  buildDashboardView, buildReviewQueue, dueLabel, failureView, isMine, isOpen, openProjects, relativeAge, stageTone, startOfDay, titleCase,
  todayLabel,
} from "./dashboard-view";
import type { ActivityItem, DashboardFailure, DashboardReady, ReviewQueueItem, Tone } from "./dashboard-view";
import type { ActivityEntry } from "./activity";
import type { ClientPortal } from "./client-uploads";
import { timecode } from "./timecode";
import { getMoneySummary, getMyEarnings, getMyInvoices } from "./billing-api";
import { buildClientInvoices, buildEarnings, buildOwnerMoneyCards } from "./money-view";
import type { TotalCard } from "./money-view";

const DAY_MS = 86400000;
const failed = <T,>(value: T | ApiFailure): value is ApiFailure =>
  typeof value === "object" && value !== null && "status" in value && "detail" in value && !Array.isArray(value);

/** One counter in a layout's strip. `null` shows a dash: the number could not be loaded. */
export type StripItem = { label: string; value: number | null; danger?: boolean; title?: string };

const shortDate = (iso: string | null) => {
  if (!iso) return "No due date";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "No due date" : `${MONTHS[date.getMonth()]} ${date.getDate()}`;
};

/* ---------------------------------------------------------------- owner: approvals */

/** A cut on the Files board waiting on a decision: in Client Review (the client) or Review (the team). */
export type ApprovalItem = {
  id: string; title: string; version: string; project: string; client: string | null;
  stage: string; kind: "client_review" | "review"; tone: Tone; age: string; href: string; poster: string | null;
  createdAt: string;
};

/**
 * Cuts waiting for approval: the latest version of each asset whose Files-board stage is
 * Client Review or Review (by the stage's kind, so a renamed stage still counts). Waiting on
 * the client comes first, then the team's own review; oldest first within each, because the
 * longest wait is the one to chase.
 */
export function buildApprovals(
  files: ProjectFile[], stages: Pick<TaskStage, "id" | "name" | "kind">[], projects: Pick<Project, "id" | "name">[],
  clients: Pick<ClientTeam, "id" | "name">[], now: Date,
): ApprovalItem[] {
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const clientNames = new Map(clients.map((client) => [client.id, client.name]));
  const items: ApprovalItem[] = [];
  for (const file of files) {
    if (file.media_asset && !file.media_asset.is_latest) continue;
    const stage = file.task_stage_id ? stageById.get(file.task_stage_id) : undefined;
    if (!stage || (stage.kind !== "client_review" && stage.kind !== "review")) continue;
    items.push({
      id: file.id,
      title: file.media_asset?.name ?? file.file.name,
      version: `V${file.version_number ?? 1}`,
      project: (file.project_id && projectNames.get(file.project_id)) || "No project",
      client: (file.client_team_id && clientNames.get(file.client_team_id)) || null,
      stage: stage.name,
      kind: stage.kind,
      tone: stage.kind === "client_review" ? "accent" : "blue",
      age: relativeAge(file.created_at, now),
      href: `/review?media=${file.file.id}`,
      poster: file.poster ? `/api/workspaces/${file.workspace_id}/asset-files/${file.id}/poster/` : null,
      createdAt: file.created_at,
    });
  }
  const rank = (item: ApprovalItem) => (item.kind === "client_review" ? 0 : 1);
  return items.sort((a, b) => rank(a) - rank(b) || a.createdAt.localeCompare(b.createdAt));
}

/* ----------------------------------------------------------- owner: project health */

export type HealthFlag = "overdue" | "due_week" | "on_hold";
export type HealthRow = {
  id: string; name: string; client: string | null; flag: HealthFlag; label: string; tone: Tone;
  due: string; openTasks: number; overdueTasks: number; href: string;
};
export type ProjectHealth = { counts: Record<HealthFlag, number>; rows: HealthRow[]; healthy: number };

const FLAG_ORDER: Record<HealthFlag, number> = { overdue: 0, due_week: 1, on_hold: 2 };

/**
 * Open projects (not completed, archived or being deleted) sorted into one flag each:
 * On hold wins (it is paused on purpose), then Overdue (due date passed), then Due this
 * week (due in the next 7 days). Everything else counts as healthy.
 */
export function buildProjectHealth(projects: Project[], tasks: Task[], clients: Pick<ClientTeam, "id" | "name">[], now: Date): ProjectHealth {
  const clientNames = new Map(clients.map((client) => [client.id, client.name]));
  const counts: Record<HealthFlag, number> = { overdue: 0, due_week: 0, on_hold: 0 };
  const rows: HealthRow[] = [];
  let healthy = 0;
  const weekEnd = now.getTime() + 7 * DAY_MS;
  for (const project of projects) {
    if (CLOSED_PROJECT_STATUSES.includes(project.status)) continue;
    const due = project.due_at ? new Date(project.due_at).getTime() : Number.NaN;
    let flag: HealthFlag | null = null;
    if (project.status === "ON_HOLD") flag = "on_hold";
    else if (Number.isFinite(due) && due < now.getTime()) flag = "overdue";
    else if (Number.isFinite(due) && due <= weekEnd) flag = "due_week";
    if (!flag) { healthy += 1; continue; }
    counts[flag] += 1;
    const own = tasks.filter((task) => task.project_id === project.id && isOpen(task));
    const days = Number.isFinite(due) ? Math.round((startOfDay(new Date(due)) - startOfDay(now)) / DAY_MS) : null;
    rows.push({
      id: project.id,
      name: project.name,
      client: (project.client_team_id && clientNames.get(project.client_team_id)) || null,
      flag,
      label: flag === "on_hold" ? "On hold" : flag === "overdue" ? "Overdue" : "Due this week",
      tone: flag === "overdue" ? "danger" : flag === "due_week" ? "warning" : "neutral",
      due: flag === "overdue" && days !== null
        ? (days === -1 ? "Due yesterday" : days === 0 ? "Due today" : `${Math.abs(days)} days overdue`)
        : flag === "due_week" && days !== null
          ? (days <= 0 ? "Due today" : days === 1 ? "Due tomorrow" : `Due ${shortDate(project.due_at)}`)
          : `Due ${shortDate(project.due_at)}`,
      openTasks: own.length,
      overdueTasks: own.filter((task) => task.due_at && new Date(task.due_at).getTime() < now.getTime()).length,
      href: `/projects?campaign=${project.id}`,
    });
  }
  rows.sort((a, b) => FLAG_ORDER[a.flag] - FLAG_ORDER[b.flag] || a.name.localeCompare(b.name));
  return { counts, rows, healthy };
}

/* --------------------------------------------------------------- owner: workload */

export type WorkloadBar = {
  id: string; name: string; initials: string; avatarUrl: string | null;
  open: number; overdue: number; dueThisWeek: number;
  /** Bar length against the busiest person (0–100), and the overdue share of it. */
  percent: number; overduePercent: number; href: string;
};
export type WorkloadView = { rows: WorkloadBar[]; unassigned: { open: number; overdue: number }; totalOpen: number };

export const WORKLOAD_LIMIT = 8;

export function buildWorkload(data: TeamWorkload, limit = WORKLOAD_LIMIT): WorkloadView {
  const max = Math.max(1, ...data.results.map((row) => row.open));
  return {
    rows: data.results.slice(0, limit).map((row) => ({
      id: row.membership_id,
      name: row.user.name,
      initials: row.user.initials,
      avatarUrl: row.user.avatar_url,
      open: row.open,
      overdue: row.overdue,
      dueThisWeek: row.due_this_week,
      percent: Math.round((row.open / max) * 100),
      overduePercent: Math.round((Math.min(row.overdue, row.open) / max) * 100),
      href: `/tasks?assignee=${row.membership_id}`,
    })),
    unassigned: data.unassigned,
    totalOpen: data.total_open,
  };
}

/* ---------------------------------------------------------------- editor: tasks */

export type EditorTask = { id: string; name: string; project: string; priority: string; when: string; tone: Tone; href: string };
export type EditorTasks = { overdue: EditorTask[]; dueSoon: EditorTask[]; later: number; undated: number; total: number };

/** "Due soon" is the next 7 days, today included. */
export const DUE_SOON_DAYS = 7;

/**
 * The editor's own open tasks: overdue (most overdue first), then due in the next week
 * (soonest first). Tasks further out or without a date are only counted.
 */
export function buildEditorTasks(tasks: Task[], membershipId: string | null, projectNames: Map<string, string>, now: Date): EditorTasks {
  const mine = tasks.filter((task) => isOpen(task) && isMine(task, membershipId));
  const soonEnd = startOfDay(now) + (DUE_SOON_DAYS + 1) * DAY_MS;
  const due = (task: Task) => (task.due_at ? new Date(task.due_at).getTime() : Number.NaN);
  const row = (task: Task, tone: Tone): EditorTask => ({
    id: task.id,
    name: task.title,
    project: task.project_id ? projectNames.get(task.project_id) ?? "Workspace" : "Workspace",
    priority: titleCase(task.priority),
    when: dueLabel(task, now),
    tone,
    href: `/tasks?task=${task.id}`,
  });
  const dated = mine.filter((task) => Number.isFinite(due(task))).sort((a, b) => due(a) - due(b));
  const overdue = dated.filter((task) => due(task) < now.getTime());
  const soon = dated.filter((task) => due(task) >= now.getTime() && due(task) < soonEnd);
  return {
    overdue: overdue.map((task) => row(task, "danger")),
    dueSoon: soon.map((task) => row(task, startOfDay(new Date(due(task))) === startOfDay(now) ? "warning" : "neutral")),
    later: dated.length - overdue.length - soon.length,
    undated: mine.length - dated.length,
    total: mine.length,
  };
}

/* ---------------------------------------------------------------- editor: notes */

export type NoteRow = {
  id: string; author: string; initials: string; avatarUrl: string | null; guest: boolean;
  text: string; cut: string; project: string; timecode: string | null; age: string;
  replies: number; team: boolean; href: string;
};

export function buildNotes(notes: NoteToAddress[], now: Date): NoteRow[] {
  return notes.map((note) => ({
    id: note.id,
    author: note.author.name,
    initials: note.author.initials,
    avatarUrl: note.author.avatar_url,
    guest: note.author.type === "guest",
    text: note.text?.trim() || "(attachment only)",
    cut: `${note.media.title} · V${note.media.version_number}`,
    project: note.media.project.name,
    timecode: note.start_time_ms === null ? null : timecode(note.start_time_ms),
    age: relativeAge(note.created_at, now),
    replies: note.reply_count,
    team: note.visibility === "team",
    href: note.href,
  }));
}

/* ---------------------------------------------------------------- editor: cuts */

export type CutRow = {
  id: string; title: string; version: string; project: string; stage: string; tone: Tone;
  openNotes: number; age: string; poster: string | null; href: string;
};

/**
 * A cut is "in review" from the moment it goes up for review until it is approved: In
 * review, Revision and Approval. Queued and In progress cuts have not been shown yet.
 */
export const inReviewLoop = (stage: { name: string; slug?: string | null } | null) => {
  if (!stage) return false;
  if (awaitsReview({ current_stage: { id: "", name: stage.name, slug: stage.slug ?? "" } })) return true;
  return stage.name.toLowerCase().includes("revision");
};

export function buildMyCutsInReview(cuts: MyCut[], now: Date): CutRow[] {
  return cuts.filter((cut) => inReviewLoop(cut.stage)).map((cut) => ({
    id: cut.id,
    title: cut.title,
    version: `V${cut.version_number}`,
    project: cut.project.name,
    stage: cut.stage?.name ?? "No stage",
    tone: stageTone(cut.stage?.name ?? ""),
    openNotes: cut.open_notes,
    age: relativeAge(cut.stage?.entered_at ?? cut.created_at, now),
    poster: cut.poster?.url ?? null,
    href: cut.href,
  }));
}

/* ---------------------------------------------------------------- client */

export type ClientProject = { id: string; title: string; status: string; tone: Tone; due: string; waiting: number; href: string };
export type DeliveredCut = {
  id: string; title: string; version: string; project: string; stage: string; age: string;
  poster: string | null; href: string; downloadable: boolean; downloadHref: string | null;
};

const approvedStage = (media: Pick<MediaVersion, "current_stage">) => {
  const stage = media.current_stage;
  return !!stage && (stage.slug?.toLowerCase() === "approved" || stage.name.toLowerCase() === "approved");
};

/** Approved cuts, most recently approved first. Downloadable ones get a Download link. */
export function buildDelivered(scanned: { project: Pick<Project, "id" | "name" | "workspace_id">; media: MediaVersion[] }[], now: Date, limit = 6): DeliveredCut[] {
  const rows: { row: DeliveredCut; at: string }[] = [];
  for (const { project, media } of scanned) {
    for (const item of media) {
      if (!approvedStage(item)) continue;
      const at = item.current_stage?.entered_at ?? item.created_at;
      rows.push({
        at,
        row: {
          id: item.id,
          title: item.title,
          version: `V${item.version_number}`,
          project: project.name,
          stage: item.current_stage?.name ?? "Approved",
          age: relativeAge(at, now),
          poster: item.poster?.url ?? null,
          href: `/review?media=${item.file.id}`,
          downloadable: item.allow_download,
          downloadHref: item.allow_download ? `/api/workspaces/${project.workspace_id}/projects/${project.id}/media-versions/${item.id}/download/` : null,
        },
      });
    }
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit).map(({ row }) => row);
}

export function buildClientProjects(projects: Project[], waitingByProject: Map<string, number>): ClientProject[] {
  return openProjects(projects).map((project) => ({
    id: project.id,
    title: project.name,
    status: titleCase(project.status),
    tone: project.status === "ACTIVE" ? "accent" : project.status === "ON_HOLD" ? "warning" : "neutral",
    due: project.due_at ? `Due ${shortDate(project.due_at)}` : "No due date",
    waiting: waitingByProject.get(project.id) ?? 0,
    href: `/projects?campaign=${project.id}`,
  }));
}

/* ---------------------------------------------------------------- views */

type Base = { greetingName: string; workspaceName: string; today: string };

export type OwnerDashboard = Base & {
  layout: "owner";
  strip: StripItem[];
  approvals: ApprovalItem[];
  health: ProjectHealth;
  workload: WorkloadView | null;
  reviewQueue: ReviewQueueItem[];
  reviewTotal: number;
  activity: ActivityItem[];
  problems: { approvals: string | null; tasks: string | null; workload: string | null; reviews: string | null; activity: string | null };
  /** Billing demo: present only for viewers with billing.view whose summary loaded. */
  money?: TotalCard[];
};

export type EditorDashboard = Base & {
  layout: "editor";
  strip: StripItem[];
  tasks: EditorTasks;
  membershipId: string | null;
  notes: NoteRow[];
  notesTotal: number;
  cuts: CutRow[];
  activity: ActivityItem[];
  problems: { tasks: string | null; notes: string | null; cuts: string | null; activity: string | null };
  /** Billing demo: the editor's own pay; absent when they have none or it failed to load. */
  earnings?: ReturnType<typeof buildEarnings>;
};

export type ClientDashboard = Base & {
  layout: "client";
  strip: StripItem[];
  projects: ClientProject[];
  waiting: ReviewQueueItem[];
  delivered: DeliveredCut[];
  problems: { reviews: string | null; activity?: string | null };
  /** Billing demo: the client's sent invoices; absent when there are none. */
  invoices?: ReturnType<typeof buildClientInvoices>;
  /** Recent activity the client may see (their projects' uploads, notes and approvals). */
  activity?: ActivityItem[];
  /** The portal's "send files" area; absent when the client cannot send to any project. */
  portal?: { workspaceId: string; projects: ClientPortal["projects"]; recent: ClientPortal["recent_uploads"]; maxBytes: number; accept: string[] };
};

export type RoleDashboard = OwnerDashboard | EditorDashboard | ClientDashboard;

const problem = (what: string, value: unknown) => (failed(value) ? `${what} could not be loaded: ${value.detail}` : null);

export type OwnerInput = {
  base: DashboardReady; now: Date; projects: Project[];
  tasks: Task[] | ApiFailure; files: ProjectFile[] | ApiFailure; stages: TaskStage[] | ApiFailure;
  clients: ClientTeam[] | ApiFailure; workload: TeamWorkload | ApiFailure;
};

export function buildOwnerDashboard(input: OwnerInput): OwnerDashboard {
  const { base, now } = input;
  const tasks = failed(input.tasks) ? [] : input.tasks;
  const clients = failed(input.clients) ? [] : input.clients;
  const approvals = failed(input.files) || failed(input.stages) ? [] : buildApprovals(input.files, input.stages, input.projects, clients, now);
  const health = buildProjectHealth(input.projects, tasks, clients, now);
  const workload = failed(input.workload) ? null : buildWorkload(input.workload);
  const openTasks = tasks.filter(isOpen);
  const overdueTasks = failed(input.tasks) ? null : openTasks.filter((task) => task.due_at && new Date(task.due_at).getTime() < now.getTime()).length;
  return {
    layout: "owner",
    greetingName: base.greetingName,
    workspaceName: base.workspaceName,
    today: base.today,
    strip: [
      { label: "Active projects", value: base.counts.activeProjects, title: "Projects whose status is Active" },
      { label: "Waiting on approval", value: failed(input.files) || failed(input.stages) ? null : approvals.length, title: "Cuts in Client Review or Review on the Files board" },
      { label: "Projects at risk", value: health.counts.overdue + health.counts.due_week, danger: health.counts.overdue > 0, title: "Overdue or due in the next 7 days" },
      { label: "Overdue tasks", value: overdueTasks, danger: true, title: "Across the whole team" },
    ],
    approvals,
    health,
    workload,
    reviewQueue: base.reviewQueue,
    reviewTotal: base.reviewTotal,
    activity: base.activity,
    problems: {
      approvals: problem("Files", input.files) ?? problem("Stages", input.stages),
      tasks: problem("Tasks", input.tasks),
      workload: failed(input.workload) ? (input.workload.status === 403 ? "Only owners and admins can see team workload." : `Workload could not be loaded: ${input.workload.detail}`) : null,
      reviews: base.problems.reviews,
      activity: base.problems.activity,
    },
  };
}

export type EditorInput = {
  greetingName: string; now: Date; workspace: Pick<Workspace, "name" | "my_membership_id">;
  projects: Project[] | ApiFailure; tasks: Task[] | ApiFailure;
  notes: { results: NoteToAddress[]; count: number } | ApiFailure;
  cuts: { results: MyCut[] } | ApiFailure;
  activity: ActivityEntry[] | ApiFailure;
};

export function buildEditorDashboard(input: EditorInput): EditorDashboard {
  const { now } = input;
  const membershipId = input.workspace.my_membership_id ?? null;
  const projects = failed(input.projects) ? [] : input.projects;
  const names = new Map(projects.map((project) => [project.id, project.name]));
  const tasks = buildEditorTasks(failed(input.tasks) ? [] : input.tasks, membershipId, names, now);
  const notes = failed(input.notes) ? [] : buildNotes(input.notes.results, now);
  const cuts = failed(input.cuts) ? [] : buildMyCutsInReview(input.cuts.results, now);
  const dueToday = tasks.dueSoon.filter((task) => task.tone === "warning").length;
  return {
    layout: "editor",
    greetingName: input.greetingName,
    workspaceName: input.workspace.name,
    today: todayLabel(now),
    strip: [
      { label: "My tasks due today", value: failed(input.tasks) ? null : dueToday },
      { label: "My overdue tasks", value: failed(input.tasks) ? null : tasks.overdue.length, danger: true },
      { label: "Notes to address", value: failed(input.notes) ? null : input.notes.count, title: "Unresolved notes from others on your cuts" },
      { label: "My cuts in review", value: failed(input.cuts) ? null : cuts.length },
    ],
    tasks,
    membershipId,
    notes,
    notesTotal: failed(input.notes) ? 0 : input.notes.count,
    cuts,
    activity: failed(input.activity) ? [] : buildActivity(input.activity, now),
    problems: {
      tasks: problem("Tasks", input.tasks),
      notes: problem("Notes", input.notes),
      cuts: problem("Your cuts", input.cuts),
      activity: problem("Activity", input.activity),
    },
  };
}

export type ClientInput = {
  greetingName: string; now: Date; workspace: Pick<Workspace, "name">;
  projects: Project[];
  scanned: { project: Project; media: MediaVersion[] | ApiFailure }[];
  /** Optional so older callers (and tests) keep working without the activity panel. */
  activity?: ActivityEntry[] | ApiFailure;
};

/** The portal upload area, or undefined when there is nowhere this client may send files. */
export function buildClientPortal(workspaceId: string, portal: ClientPortal | ApiFailure | null): ClientDashboard["portal"] {
  if (!portal || failed(portal) || portal.projects.length === 0) return undefined;
  return { workspaceId, projects: portal.projects, recent: portal.recent_uploads.slice(0, 6), maxBytes: portal.max_file_bytes, accept: portal.accept };
}

export function buildClientDashboard(input: ClientInput): ClientDashboard {
  const { now } = input;
  const ok = input.scanned.filter((entry): entry is { project: Project; media: MediaVersion[] } => !failed(entry.media));
  const waiting = buildReviewQueue(ok, now);
  const waitingByProject = new Map<string, number>();
  for (const { project, media } of ok) waitingByProject.set(project.id, media.filter(awaitsReview).length);
  const delivered = buildDelivered(ok, now);
  const projects = buildClientProjects(input.projects, waitingByProject);
  const failures = input.scanned.length - ok.length;
  return {
    layout: "client",
    greetingName: input.greetingName,
    workspaceName: input.workspace.name,
    today: todayLabel(now),
    strip: [
      { label: "Your projects", value: projects.length },
      { label: "Waiting for your review", value: waiting.length },
      { label: "Approved", value: ok.reduce((sum, entry) => sum + entry.media.filter(approvedStage).length, 0) },
    ],
    projects,
    waiting,
    delivered,
    problems: {
      reviews: failures ? `${failures} ${failures === 1 ? "project's" : "projects'"} cuts could not be loaded.` : null,
      ...(input.activity !== undefined ? { activity: problem("Activity", input.activity) } : {}),
    },
    ...(input.activity !== undefined ? { activity: failed(input.activity) ? [] : buildActivity(input.activity, now) } : {}),
  };
}

/* ---------------------------------------------------------------- loaders */

/** Client projects fanned out for cuts. A client rarely has more; this caps the requests. */
export const CLIENT_SCAN_LIMIT = 12;

const settle = <T,>(result: { ok: true; data: T } | { ok: false; error: ApiFailure }): T | ApiFailure => (result.ok ? result.data : result.error);

export async function loadOwnerDashboard(greetingName: string, workspace: Workspace): Promise<OwnerDashboard | DashboardFailure> {
  const now = new Date();
  const [projects, tasks, activity, files, stages, clients, workload] = await Promise.all([
    listProjects(workspace.id),
    listTasks(workspace.id),
    listActivity(workspace.id, { pageSize: DASHBOARD_ACTIVITY_LIMIT }),
    listAssetFiles(workspace.id),
    listTaskStages(workspace.id),
    listClientTeams(workspace.id),
    getTeamWorkload(workspace.id),
  ]);
  const money = workspace.billing?.view ? await getMoneySummary(workspace.id) : null;
  if (!projects.ok) return failureView(greetingName, now, projects.error);
  // The Review Queue scans the projects most likely to have cuts in review first.
  const scanned = await Promise.all(openProjects(projects.data).slice(0, REVIEW_SCAN_LIMIT).map(async (project) => {
    const media = await listMediaVersions(workspace.id, project.id);
    return { project, media: media.ok ? media.data : media.error };
  }));
  const base = buildDashboardView({
    greetingName, now, workspace, projects: projects.data,
    tasks: settle(tasks), activity: activity.ok ? activity.data.results : activity.error, scanned,
  });
  const dashboard = buildOwnerDashboard({
    base, now,
    projects: projects.data,
    tasks: settle(tasks),
    files: settle(files),
    stages: stages.ok ? stages.data.stages : stages.error,
    clients: settle(clients),
    workload: settle(workload),
  });
  return money?.ok ? { ...dashboard, money: buildOwnerMoneyCards(money.data) } : dashboard;
}

export async function loadEditorDashboard(greetingName: string, workspace: Workspace): Promise<EditorDashboard> {
  const [projects, tasks, notes, cuts, activity, earnings] = await Promise.all([
    listProjects(workspace.id),
    listTasks(workspace.id),
    listNotesToAddress(workspace.id, 6),
    listMyCuts(workspace.id, 30),
    listActivity(workspace.id, { pageSize: DASHBOARD_ACTIVITY_LIMIT, mine: true }),
    getMyEarnings(workspace.id),
  ]);
  const dashboard = buildEditorDashboard({
    greetingName, now: new Date(), workspace,
    projects: settle(projects), tasks: settle(tasks), notes: settle(notes), cuts: settle(cuts),
    activity: activity.ok ? activity.data.results : activity.error,
  });
  if (!earnings.ok) return dashboard;
  const view = buildEarnings(earnings.data);
  return view.empty ? dashboard : { ...dashboard, earnings: view };
}

export async function loadClientDashboard(greetingName: string, workspace: Workspace): Promise<ClientDashboard | DashboardFailure> {
  const now = new Date();
  const [projects, invoices, activity, portal] = await Promise.all([
    listProjects(workspace.id), getMyInvoices(workspace.id),
    listActivity(workspace.id, { pageSize: DASHBOARD_ACTIVITY_LIMIT }), getClientPortalData(workspace.id),
  ]);
  if (!projects.ok) return failureView(greetingName, now, projects.error);
  const targets = openProjects(projects.data).slice(0, CLIENT_SCAN_LIMIT);
  const scanned = await Promise.all(targets.map(async (project) => {
    const media = await listMediaVersions(workspace.id, project.id);
    return { project, media: media.ok ? media.data : media.error };
  }));
  const dashboard = buildClientDashboard({
    greetingName, now, workspace, projects: projects.data, scanned, activity: activity.ok ? activity.data.results : activity.error,
  });
  const withPortal = { ...dashboard, portal: buildClientPortal(workspace.id, settle(portal)) };
  // Invoices come from the billing demo's own permission check: a client sees only what was sent to them.
  return invoices.ok && invoices.data.results.length > 0 ? { ...withPortal, invoices: buildClientInvoices(invoices.data, now) } : withPortal;
}
