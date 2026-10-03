import { listActivity, listMediaVersions, listProjects, listTasks, listWorkspaces } from "./api";
import type { ApiFailure, MediaVersion, Project, Task } from "./api";
import { toDashboardRow, type ActivityEntry } from "./activity";
import { selectWorkspace } from "./workspace";
import { upcomingDeadlines } from "./deadlines";

export type Bucket = "Today" | "Upcoming" | "Overdue";
export type Tone = "neutral" | "warning" | "danger" | "success" | "accent" | "blue";

export type DashboardTask = {
  id: string; name: string; project: string; priority: string;
  time: string; status: string; tone: Tone; bucket: Bucket;
  /** Assigned to the viewer's own workspace membership. */
  mine: boolean;
};
export type AttentionItem = {
  id: string; eyebrow: string; client: string; title: string;
  detail: string; action: string; footer: string; tone: Tone; href: string; icon: "clock" | "message" | "checks";
};
export type ReviewQueueItem = {
  id: string; title: string; version: string; project: string;
  stage: string; age: string; tone: Tone; href: string;
  /** Same-origin, permission-checked poster route; null until the worker has made one. */
  poster: string | null;
  /** Sort key only — the rendered form is `age`. */
  createdAt: string;
};
export type ProjectCard = {
  id: string; title: string; status: string; tone: Tone; priority: string;
  date: string; tasks: string; percent: number; href: string;
};
export type DeadlineItem = { id: string; day: string; date: string; title: string; project: string; priority: string; tone: Tone };
/** One row of Recent Activity: "<actor> <action>", with the actor rendered in bold. */
export type ActivityItem = { id: string; initials: string; avatarUrl?: string | null; tone: Tone; actor: string; action: string; detail: string; href: string | null };

/** Recent Activity shows this many of the workspace feed's newest rows. */
export const DASHBOARD_ACTIVITY_LIMIT = 6;

/**
 * The "today" strip (C-D2). Task counts are the viewer's own when the API names their
 * membership, otherwise the workspace's; `null` means the task list could not be loaded,
 * which the strip shows as a dash rather than a zero.
 */
export type TodayCounts = {
  activeProjects: number;
  awaitingReview: number;
  dueToday: number | null;
  overdue: number | null;
  taskScope: "mine" | "workspace";
};

export type DashboardReady = {
  status: "ready";
  greetingName: string;
  workspaceName: string;
  today: string;
  counts: TodayCounts;
  attention: AttentionItem[];
  /** Every open task; the panel filters to `mine` by default. */
  tasks: DashboardTask[];
  /** The viewer's membership id, used for the "all my tasks" link. Null when unknown. */
  membershipId: string | null;
  reviewQueue: ReviewQueueItem[];
  /** How many cuts await review in the projects scanned (the queue itself is capped). */
  reviewTotal: number;
  projects: ProjectCard[];
  /** Projects in the workspace that are not finished, archived or being deleted. */
  openProjectCount: number;
  deadlines: DeadlineItem[];
  activity: ActivityItem[];
  /** Per-panel failures. A panel with a problem shows it instead of pretending to be empty. */
  problems: { tasks: string | null; reviews: string | null; activity: string | null };
};

/** The page could not be built. Never accompanied by numbers: there are none to trust. */
export type DashboardFailure = { status: "error"; greetingName: string; today: string; title: string; detail: string };

export type DashboardView = DashboardReady | DashboardFailure;

/** Projects fanned out for media versions. Caps the request count on a large workspace. */
export const REVIEW_SCAN_LIMIT = 6;

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
const titleCase = (value: string) => value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/** `titleCase` would render TODO as "Todo"; the board calls it "To Do". */
const TASK_STATUS_LABELS: Record<string, string> = { TODO: "To Do" };
const statusLabel = (status: string) => TASK_STATUS_LABELS[status] ?? titleCase(status);

const isOpen = (task: Task) => !["COMPLETED", "APPROVED", "CANCELLED"].includes(task.status);

/** Project statuses that mean the work is over or going away. */
const CLOSED_PROJECT_STATUSES = ["COMPLETED", "ARCHIVED", "PENDING_DELETION"];

/** "Active" means the project's status is ACTIVE — not merely that the project exists. */
export const countActiveProjects = (projects: Pick<Project, "status">[]) =>
  projects.filter((project) => project.status === "ACTIVE").length;

export const isMine = (task: Pick<Task, "assignees">, membershipId: string | null) =>
  !!membershipId && task.assignees.some((person) => person.id === membershipId);

export function todayLabel(now: Date): string {
  return `${DAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}`;
}

export function bucketFor(task: Task, now: Date): Bucket {
  if (!task.due_at) return "Upcoming";
  const due = new Date(task.due_at).getTime();
  if (Number.isNaN(due)) return "Upcoming";
  if (due < now.getTime() && isOpen(task)) return "Overdue";
  if (startOfDay(new Date(due)) === startOfDay(now)) return "Today";
  return "Upcoming";
}

function dueLabel(task: Task, now: Date): string {
  if (!task.due_at) return "No due date";
  const due = new Date(task.due_at);
  if (Number.isNaN(due.getTime())) return "No due date";
  const time = due.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const days = Math.round((startOfDay(due) - startOfDay(now)) / 86400000);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Tomorrow, ${time}`;
  if (days < 0) return days === -1 ? "Due yesterday" : `${Math.abs(days)} days overdue`;
  return `${MONTHS[due.getMonth()]} ${due.getDate()}, ${time}`;
}

function taskTone(task: Task, bucket: Bucket): Tone {
  if (bucket === "Overdue") return "danger";
  if (["IN_PROGRESS", "REVISIONS", "INTERNAL_QA", "CLIENT"].includes(task.status)) return "warning";
  if (["COMPLETED", "APPROVED"].includes(task.status)) return "success";
  return "neutral";
}

export function relativeAge(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.floor((now.getTime() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function stageTone(label: string): Tone {
  const value = label.toLowerCase();
  if (value.includes("approved")) return "success";
  if (value.includes("approv")) return "accent";
  if (value.includes("revision")) return "warning";
  if (value.includes("review")) return "blue";
  return "neutral";
}

/**
 * A cut awaits review while its workflow stage is a review or approval step. "Approved" is
 * where review ends, so it no longer counts (it used to, because "approved" contains "approv").
 */
export const awaitsReview = (media: Pick<MediaVersion, "current_stage">) => {
  const stage = media.current_stage;
  if (!stage) return false;
  const slug = stage.slug?.toLowerCase() ?? "";
  const name = stage.name.toLowerCase();
  if (slug === "approved" || name === "approved") return false;
  return name.includes("review") || name.includes("approv");
};

/** Recent Activity: the newest rows of the workspace activity feed (already permission-scoped). */
export function buildActivity(entries: ActivityEntry[], now: Date = new Date(), limit = DASHBOARD_ACTIVITY_LIMIT): ActivityItem[] {
  return entries.slice(0, limit).map((entry) => toDashboardRow(entry, now));
}

export function buildDashboardTasks(tasks: Task[], projectNames: Map<string, string>, membershipId: string | null, now: Date): DashboardTask[] {
  return tasks.filter(isOpen).map((task) => {
    const bucket = bucketFor(task, now);
    return {
      id: task.id,
      name: task.title,
      project: task.project_id ? projectNames.get(task.project_id) ?? "Workspace" : "Workspace",
      priority: titleCase(task.priority),
      time: dueLabel(task, now),
      status: bucket === "Overdue" ? "Overdue" : statusLabel(task.status),
      tone: taskTone(task, bucket),
      bucket,
      mine: isMine(task, membershipId),
    };
  });
}

/** Cuts awaiting review across the scanned projects, newest first, with their posters. */
export function buildReviewQueue(scanned: { project: Pick<Project, "name">; media: MediaVersion[] }[], now: Date = new Date()): ReviewQueueItem[] {
  const queue: ReviewQueueItem[] = [];
  for (const { project, media } of scanned) {
    for (const item of media) {
      if (!awaitsReview(item)) continue;
      const stage = item.current_stage?.name ?? titleCase(item.status);
      queue.push({
        id: item.id,
        title: item.title,
        version: `V${item.version_number}`,
        project: project.name,
        stage,
        age: relativeAge(item.created_at, now),
        tone: stageTone(stage),
        href: `/review?media=${item.file.id}`,
        poster: item.poster?.url ?? null,
        createdAt: item.created_at,
      });
    }
  }
  return queue.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Not-closed projects, ACTIVE ones first, then by due date (undated last). */
export function openProjects(projects: Project[]): Project[] {
  const due = (project: Project) => (project.due_at ? new Date(project.due_at).getTime() : Number.POSITIVE_INFINITY);
  return projects
    .filter((project) => !CLOSED_PROJECT_STATUSES.includes(project.status))
    .sort((a, b) => Number(b.status === "ACTIVE") - Number(a.status === "ACTIVE") || due(a) - due(b));
}

export type DashboardInput = {
  greetingName: string;
  now: Date;
  workspace: { id: string; name: string; my_membership_id?: string | null };
  projects: Project[];
  /** A failure leaves the task panels saying so rather than showing zeros. */
  tasks: Task[] | ApiFailure;
  activity: ActivityEntry[] | ApiFailure;
  scanned: { project: Project; media: MediaVersion[] | ApiFailure }[];
};

const failed = <T,>(value: T[] | ApiFailure): value is ApiFailure => !Array.isArray(value);

/** Everything the dashboard shows, derived from what the API returned. Pure, so it is unit-tested. */
export function buildDashboardView(input: DashboardInput): DashboardReady {
  const { now, workspace, projects } = input;
  const membershipId = input.workspace.my_membership_id ?? null;
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const tasks = failed(input.tasks) ? [] : input.tasks;
  const dashboardTasks = buildDashboardTasks(tasks, projectNames, membershipId, now);

  const scannedOk = input.scanned.filter((entry): entry is { project: Project; media: MediaVersion[] } => !failed(entry.media));
  const reviewQueue = buildReviewQueue(scannedOk, now);
  const reviewFailures = input.scanned.length - scannedOk.length;

  // The strip counts the viewer's own tasks when we know who they are in this workspace.
  const scoped = membershipId ? dashboardTasks.filter((task) => task.mine) : dashboardTasks;
  const overdue = dashboardTasks.filter((task) => task.bucket === "Overdue");
  const dueToday = dashboardTasks.filter((task) => task.bucket === "Today");
  const tasksFailed = failed(input.tasks);

  const visibleProjects = openProjects(projects);
  // Tasks per project drive the completion bar; cancelled tasks are excluded from both sides.
  const projectCards: ProjectCard[] = visibleProjects.slice(0, 4).map((project) => {
    const own = tasks.filter((task) => task.project_id === project.id && task.status !== "CANCELLED");
    const done = own.filter((task) => ["COMPLETED", "APPROVED"].includes(task.status)).length;
    const due = project.due_at ? new Date(project.due_at) : null;
    return {
      id: project.id,
      title: project.name,
      status: titleCase(project.status),
      tone: project.status === "ACTIVE" ? "accent" : project.status === "ON_HOLD" ? "warning" : "neutral",
      priority: titleCase(project.priority),
      date: due && !Number.isNaN(due.getTime()) ? `${MONTHS[due.getMonth()]} ${due.getDate()}` : "No due date",
      tasks: `${done}/${own.length}`,
      percent: own.length ? Math.round((done / own.length) * 100) : 0,
      href: `/projects?campaign=${project.id}`,
    };
  });

  const openById = new Map(dashboardTasks.map((task) => [task.id, task]));
  const deadlines: DeadlineItem[] = upcomingDeadlines(tasks.filter((task) => openById.has(task.id)), now)
    .map((source) => {
      const task = openById.get(source.id)!;
      const due = source.due_at ? new Date(source.due_at) : null;
      return {
        id: task.id,
        day: due ? (task.bucket === "Today" ? "Today" : DAYS[due.getDay()]) : "—",
        date: due ? String(due.getDate()) : "—",
        title: task.name,
        project: `${task.project} · ${task.time}`,
        priority: task.priority,
        tone: task.priority === "High" ? "warning" : "neutral",
      };
    });

  const attention: AttentionItem[] = [
    ...overdue.slice(0, 2).map((task): AttentionItem => ({
      id: task.id, eyebrow: `Overdue · ${task.time}`, client: task.project, title: task.name,
      detail: `${task.priority} priority task is past its due date.`, action: "Open task",
      footer: task.time, tone: "danger", href: `/tasks?task=${task.id}`, icon: "clock",
    })),
    ...reviewQueue.slice(0, 1).map((item): AttentionItem => ({
      id: item.id, eyebrow: item.stage, client: item.project, title: `${item.title} · ${item.version}`,
      detail: "This cut is waiting on feedback.", action: "Open review",
      footer: item.age, tone: "accent", href: item.href, icon: "message",
    })),
    ...dueToday.slice(0, 1).map((task): AttentionItem => ({
      id: task.id, eyebrow: "Due today", client: task.project, title: task.name,
      detail: `${task.priority} priority task is due today.`, action: "Open task",
      footer: task.time, tone: "warning", href: `/tasks?task=${task.id}`, icon: "checks",
    })),
  ].slice(0, 3);

  return {
    status: "ready",
    greetingName: input.greetingName,
    workspaceName: workspace.name,
    today: todayLabel(now),
    counts: {
      activeProjects: countActiveProjects(projects),
      awaitingReview: reviewQueue.length,
      dueToday: tasksFailed ? null : scoped.filter((task) => task.bucket === "Today").length,
      overdue: tasksFailed ? null : scoped.filter((task) => task.bucket === "Overdue").length,
      taskScope: membershipId ? "mine" : "workspace",
    },
    attention,
    tasks: dashboardTasks,
    membershipId,
    reviewQueue: reviewQueue.slice(0, 4),
    reviewTotal: reviewQueue.length,
    projects: projectCards,
    openProjectCount: visibleProjects.length,
    deadlines,
    activity: failed(input.activity) ? [] : buildActivity(input.activity, now),
    problems: {
      tasks: failed(input.tasks) ? `Tasks could not be loaded: ${input.tasks.detail}` : null,
      reviews: reviewFailures
        ? `${reviewFailures} ${reviewFailures === 1 ? "project's" : "projects'"} cuts could not be loaded.`
        : null,
      activity: failed(input.activity) ? `Activity could not be loaded: ${input.activity.detail}` : null,
    },
  };
}

/** What the error state says. Honest about the cause; never paired with numbers. */
export function failureView(greetingName: string, now: Date, error: ApiFailure): DashboardFailure {
  const unreachable = error.status === 0;
  return {
    status: "error",
    greetingName,
    today: todayLabel(now),
    title: unreachable ? "Can't reach Blaze Flow right now" : "The dashboard couldn't load",
    detail: unreachable
      ? "The server didn't answer. Check your connection and try again."
      : `The server answered ${error.status}: ${error.detail}`,
  };
}

/**
 * Loads the dashboard from the Django API.
 *
 * Everything here is derived from three workspace-wide lists (projects, tasks,
 * activity) plus a bounded fan-out for media versions, because the backend has no
 * dashboard/summary endpoint. When the workspace or project list fails there is nothing
 * honest to show, so the page renders an error state with Retry — never sample numbers.
 */
export async function loadDashboardView(greetingName: string): Promise<DashboardView> {
  const now = new Date();
  const workspaces = await listWorkspaces();
  if (!workspaces.ok) return failureView(greetingName, now, workspaces.error);
  const workspace = await selectWorkspace(workspaces.data);
  if (!workspace) return failureView(greetingName, now, { status: 404, detail: "This account has no workspace yet." });

  const [projectsResult, tasksResult, activityResult] = await Promise.all([
    listProjects(workspace.id),
    listTasks(workspace.id),
    listActivity(workspace.id, { pageSize: DASHBOARD_ACTIVITY_LIMIT }),
  ]);
  if (!projectsResult.ok) return failureView(greetingName, now, projectsResult.error);

  // Scan the projects most likely to have cuts in review first.
  const scanTargets = openProjects(projectsResult.data).slice(0, REVIEW_SCAN_LIMIT);
  const scanned = await Promise.all(scanTargets.map(async (project) => {
    const media = await listMediaVersions(workspace.id, project.id);
    return { project, media: media.ok ? media.data : media.error };
  }));

  return buildDashboardView({
    greetingName,
    now,
    workspace,
    projects: projectsResult.data,
    tasks: tasksResult.ok ? tasksResult.data : tasksResult.error,
    activity: activityResult.ok ? activityResult.data.results : activityResult.error,
    scanned,
  });
}
