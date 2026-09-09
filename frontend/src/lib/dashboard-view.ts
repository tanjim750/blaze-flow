import { listMediaVersions, listNotifications, listProjects, listTasks, listWorkspaces } from "./api";
import type { MediaVersion, Notification, Task } from "./api";
import { selectWorkspace } from "./workspace";

export type Bucket = "Today" | "Upcoming" | "Overdue";
export type Tone = "neutral" | "warning" | "danger" | "success" | "accent" | "blue";

export type DashboardTask = {
  id: string; name: string; project: string; priority: string;
  time: string; status: string; tone: Tone; bucket: Bucket;
};
export type AttentionItem = {
  id: string; eyebrow: string; client: string; title: string;
  detail: string; action: string; footer: string; tone: Tone; href: string; icon: "clock" | "message" | "checks";
};
export type ReviewQueueItem = {
  id: string; title: string; version: string; project: string;
  stage: string; age: string; tone: Tone; href: string;
  /** Sort key only — the rendered form is `age`. */
  createdAt: string;
};
export type ProjectCard = {
  id: string; title: string; status: string; tone: Tone; priority: string;
  date: string; tasks: string; percent: number; href: string;
};
export type DeadlineItem = { id: string; day: string; date: string; title: string; project: string; priority: string; tone: Tone };
export type ActivityItem = { id: string; initials: string; tone: Tone; text: string; detail: string };

export type DashboardView = {
  greetingName: string;
  workspaceName: string;
  today: string;
  activeProjectCount: number;
  stats: { activeProjects: number; dueToday: number; overdue: number; awaitingReview: number };
  attention: AttentionItem[];
  tasks: DashboardTask[];
  reviewQueue: ReviewQueueItem[];
  projects: ProjectCard[];
  deadlines: DeadlineItem[];
  activity: ActivityItem[];
  /** Non-null when the API could not supply the page and demo content is shown instead. */
  notice: string | null;
};

/** Projects fanned out for media versions. Caps the request count on a large workspace. */
const REVIEW_SCAN_LIMIT = 6;

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
const titleCase = (value: string) => value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/** `titleCase` would render TODO as "Todo"; the board calls it "To Do". */
const TASK_STATUS_LABELS: Record<string, string> = { TODO: "To Do" };
const statusLabel = (status: string) => TASK_STATUS_LABELS[status] ?? titleCase(status);

const isOpen = (task: Task) => task.status !== "COMPLETED" && task.status !== "CANCELLED";

function bucketFor(task: Task, now: Date): Bucket {
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
  if (task.status === "IN_PROGRESS") return "warning";
  if (task.status === "COMPLETED") return "success";
  return "neutral";
}

function relativeAge(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function stageTone(label: string): Tone {
  const value = label.toLowerCase();
  if (value.includes("approv")) return "success";
  if (value.includes("revision")) return "warning";
  if (value.includes("review")) return "blue";
  return "neutral";
}

/** A cut counts as awaiting review when its workflow stage says review or approval. */
const awaitsReview = (media: MediaVersion) => {
  const stage = media.current_stage?.name.toLowerCase() ?? "";
  return stage.includes("review") || stage.includes("approv");
};

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return `${parts[0].charAt(0)}${parts.length > 1 ? parts[parts.length - 1].charAt(0) : ""}`.toUpperCase();
}

const describe = (status: number, detail: string) =>
  status === 0
    ? `${detail} Showing demo content until the API is running.`
    : `The API returned ${status}: ${detail}. Showing demo content.`;

/**
 * Loads the dashboard from the Django API.
 *
 * Everything here is derived from three workspace-wide lists (projects, tasks,
 * notifications) plus a bounded fan-out for media versions, because the backend has no
 * dashboard/summary endpoint. Panels the API genuinely cannot answer — per-cut comment
 * counts, durations, render state — are left out rather than faked.
 */
export async function loadDashboardView(greetingName: string): Promise<DashboardView> {
  const now = new Date();
  const today = `${DAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}`;

  const workspaces = await listWorkspaces();
  if (!workspaces.ok) return demoView(greetingName, today, describe(workspaces.error.status, workspaces.error.detail));
  const workspace = await selectWorkspace(workspaces.data);
  if (!workspace) return demoView(greetingName, today, "This account has no workspace yet, so demo content is shown.");

  const [projectsResult, tasksResult, notificationsResult] = await Promise.all([
    listProjects(workspace.id),
    listTasks(workspace.id),
    listNotifications(),
  ]);
  if (!projectsResult.ok) return demoView(greetingName, today, describe(projectsResult.error.status, projectsResult.error.detail));

  const projects = projectsResult.data;
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  // A task list failure is not fatal: the projects half of the page is still worth showing.
  const tasks = tasksResult.ok ? tasksResult.data : [];

  const reviewQueue: ReviewQueueItem[] = [];
  let awaitingReview = 0;
  const scanned = await Promise.all(
    projects.slice(0, REVIEW_SCAN_LIMIT).map(async (project) => ({
      project,
      media: await listMediaVersions(workspace.id, project.id),
    })),
  );
  for (const { project, media } of scanned) {
    if (!media.ok) continue;
    for (const item of [...media.data].reverse()) {
      const stage = item.current_stage?.name ?? titleCase(item.status);
      if (awaitsReview(item)) awaitingReview += 1;
      reviewQueue.push({
        id: item.id,
        title: item.title,
        version: `V${item.version_number} · ${stage}`,
        project: project.name,
        stage,
        age: relativeAge(item.created_at),
        tone: stageTone(stage),
        href: `/review?project=${project.id}&version=${item.id}`,
        createdAt: item.created_at,
      });
    }
  }
  // Newest cut first, across every project scanned.
  reviewQueue.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const dashboardTasks: DashboardTask[] = tasks.filter(isOpen).map((task) => {
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
    };
  });

  const overdue = dashboardTasks.filter((task) => task.bucket === "Overdue");
  const dueToday = dashboardTasks.filter((task) => task.bucket === "Today");

  // Tasks per project drive the completion bar; cancelled tasks are excluded from both sides.
  const projectCards: ProjectCard[] = projects.map((project) => {
    const own = tasks.filter((task) => task.project_id === project.id && task.status !== "CANCELLED");
    const done = own.filter((task) => task.status === "COMPLETED").length;
    return {
      id: project.id,
      title: project.name,
      status: titleCase(project.status),
      tone: stageTone(project.status),
      priority: titleCase(project.priority),
      date: project.due_at ? `${MONTHS[new Date(project.due_at).getMonth()]} ${new Date(project.due_at).getDate()}` : "No due date",
      tasks: own.length ? `${done}/${own.length}` : "0/0",
      percent: own.length ? Math.round((done / own.length) * 100) : 0,
      href: `/projects?campaign=${project.id}`,
    };
  });

  const deadlines: DeadlineItem[] = dashboardTasks
    .filter((task) => task.bucket !== "Overdue")
    .slice(0, 5)
    .map((task) => {
      const source = tasks.find((item) => item.id === task.id)!;
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
      detail: `${task.priority} priority task is past its due date.`, action: "Open Task",
      footer: task.time, tone: "danger", href: "/projects?view=tasks", icon: "clock",
    })),
    ...reviewQueue.filter((item) => item.tone === "blue").slice(0, 1).map((item): AttentionItem => ({
      id: item.id, eyebrow: item.stage, client: item.project, title: item.title,
      detail: "This cut is sitting in review and waiting on feedback.", action: "Review Feedback",
      footer: item.age, tone: "accent", href: item.href, icon: "message",
    })),
    ...dueToday.slice(0, 1).map((task): AttentionItem => ({
      id: task.id, eyebrow: "Due today", client: task.project, title: task.name,
      detail: `${task.priority} priority task is due today.`, action: "Open Project",
      footer: task.time, tone: "warning", href: "/projects?view=tasks", icon: "checks",
    })),
  ].slice(0, 3);

  const activity: ActivityItem[] = (notificationsResult.ok ? notificationsResult.data : []).slice(0, 4).map((item: Notification) => {
    const actor = item.actor?.name?.trim() || item.actor?.email || "Someone";
    return {
      id: item.id,
      initials: initialsFrom(actor),
      tone: item.unread ? "accent" : "neutral",
      text: `${actor} mentioned you in a review comment`,
      detail: relativeAge(item.created_at),
    };
  });

  return {
    greetingName,
    workspaceName: workspace.name,
    today,
    activeProjectCount: projects.length,
    stats: {
      activeProjects: projects.length,
      dueToday: dueToday.length,
      overdue: overdue.length,
      awaitingReview,
    },
    attention,
    tasks: dashboardTasks,
    reviewQueue: reviewQueue.slice(0, 4),
    projects: projectCards.slice(0, 4),
    deadlines,
    activity,
    notice: tasksResult.ok ? null : `Tasks unavailable: ${tasksResult.error.detail}`,
  };
}

/** Content from the Stitch reference, used only when the API cannot answer. */
function demoView(greetingName: string, today: string, notice: string): DashboardView {
  return {
    greetingName,
    workspaceName: "Blaze Flow Studio",
    today,
    activeProjectCount: 4,
    stats: { activeProjects: 12, dueToday: 5, overdue: 3, awaitingReview: 8 },
    attention: [
      { id: "a1", eyebrow: "Overdue · due yesterday", client: "Blaze Media", title: "Homepage Animation", detail: "Deliver 60fps Lottie SVG asset and test mobile fallback.", action: "Open Task", footer: "24h delay", tone: "danger", href: "/projects?view=tasks", icon: "clock" },
      { id: "a2", eyebrow: "Revision requested", client: "Summer Campaign", title: "Summer Campaign Film", detail: "4 unresolved comments on opening hook and music drop.", action: "Review Feedback", footer: "4 comments", tone: "accent", href: "/review", icon: "message" },
      { id: "a3", eyebrow: "Due tomorrow", client: "Brand Launch", title: "Brand Launch", detail: "2 open tasks: packaging 3D render & vector logo exports.", action: "Open Project", footer: "2 tasks pending", tone: "warning", href: "/projects", icon: "checks" },
    ],
    tasks: [
      { id: "t1", name: "Refine opening animation", project: "Summer Campaign", priority: "High", time: "Today, 10:00 AM", status: "In Progress", tone: "warning", bucket: "Today" },
      { id: "t2", name: "Export final social cutdowns", project: "Product Launch", priority: "Medium", time: "Today, 2:00 PM", status: "To Do", tone: "neutral", bucket: "Today" },
      { id: "t3", name: "Update brand presentation", project: "Studio Rebrand", priority: "High", time: "Today, 4:00 PM", status: "In Progress", tone: "warning", bucket: "Today" },
      { id: "t4", name: "Brand Launch 3D Assets Delivery", project: "Brand Launch", priority: "High", time: "Tomorrow, 12:00 PM", status: "To Do", tone: "neutral", bucket: "Upcoming" },
      { id: "t5", name: "Homepage Animation", project: "Blaze Media", priority: "High", time: "Due yesterday", status: "Overdue", tone: "danger", bucket: "Overdue" },
    ],
    reviewQueue: [
      { id: "r1", title: "Summer Campaign Film", version: "V3 · In review", project: "Summer Campaign", stage: "In review", age: "2h ago", tone: "blue", href: "/review", createdAt: "2024-10-24T08:00:00Z" },
      { id: "r2", title: "Product Teaser", version: "V2 · Revision", project: "Product Launch", stage: "Revision", age: "4h ago", tone: "warning", href: "/review", createdAt: "2024-10-24T06:00:00Z" },
      { id: "r3", title: "Brand Hero Visual", version: "V1 · Approval", project: "Studio Rebrand", stage: "Approval", age: "1h ago", tone: "success", href: "/review", createdAt: "2024-10-24T09:00:00Z" },
    ],
    projects: [
      { id: "p1", title: "Aurora Fall Campaign", status: "In review", tone: "blue", priority: "High", date: "Nov 02", tasks: "8/12", percent: 66, href: "/projects" },
      { id: "p2", title: "Summer Campaign", status: "Revisions", tone: "warning", priority: "High", date: "Oct 28", tasks: "10/14", percent: 71, href: "/projects" },
      { id: "p3", title: "Atlas Product Launch", status: "In progress", tone: "neutral", priority: "Medium", date: "Nov 15", tasks: "4/11", percent: 36, href: "/projects" },
      { id: "p4", title: "Studio Rebrand", status: "Planning", tone: "neutral", priority: "Medium", date: "Dec 01", tasks: "3/9", percent: 33, href: "/projects" },
    ],
    deadlines: [
      { id: "d1", day: "Today", date: "24", title: "Final Color Pass & ACES Rec.709 Lut Conform", project: "Northwind Brand Film · 5:00 PM", priority: "Critical", tone: "danger" },
      { id: "d2", day: "Fri", date: "25", title: "Brand Launch 3D Assets Delivery", project: "Brand Launch · 12:00 PM", priority: "Normal", tone: "neutral" },
      { id: "d3", day: "Mon", date: "28", title: "Summer Campaign Film Client Master Delivery", project: "Summer Campaign · 6:00 PM", priority: "Priority", tone: "warning" },
    ],
    activity: [
      { id: "v1", initials: "AR", tone: "accent", text: "Alex uploaded V3 of Summer Campaign Film", detail: "2h ago · ProRes 422 (2.4 GB)" },
      { id: "v2", initials: "CL", tone: "warning", text: "Client requested changes on Product Teaser", detail: "4h ago · 5 notes pinned to markers" },
      { id: "v3", initials: "MC", tone: "success", text: "Marcus approved color pass on Aurora Athletics Hero", detail: "6h ago · Ready for final export" },
    ],
    notice,
  };
}
