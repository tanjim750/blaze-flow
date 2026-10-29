/**
 * The Solo editor dashboard: one person running their own clients. It shows only what a
 * Solo workspace has (tasks, projects, client review, invoicing) and no team, editor or
 * payout widgets. The builder is pure (unit-tested); the loader fetches just what it needs.
 */
import { listActivity, listAssetFiles, listClientTeams, listNotesToAddress, listProjects, listTaskStages, listTasks } from "./api";
import type { ApiFailure, ClientTeam, NoteToAddress, Project, ProjectFile, Task, TaskStage, Workspace } from "./api";
import { DASHBOARD_ACTIVITY_LIMIT, buildActivity, dueLabel, failureView, isOpen, openProjects, startOfDay, todayLabel } from "./dashboard-view";
import type { ActivityItem, DashboardFailure, Tone } from "./dashboard-view";
import type { ActivityEntry } from "./activity";
import { getMoneySummary } from "./billing-api";
import type { MoneySummary } from "./money-view";
import { toMinor } from "./money";
import { buildApprovals, buildNotes, type ApprovalItem, type NoteRow } from "./role-dashboard-view";

const DAY_MS = 86400000;
const isFailure = (value: unknown): value is ApiFailure =>
  typeof value === "object" && value !== null && "status" in value && "detail" in value && !Array.isArray(value);
const problem = (what: string, value: unknown) => (isFailure(value) ? `${what} could not be loaded: ${value.detail}` : null);

export type SoloTask = { id: string; title: string; project: string | null; due: string; overdue: boolean; href: string };
export type SoloProject = { id: string; name: string; client: string | null; due: string; tone: Tone; openTasks: number; href: string };
/** Money in the workspace currency, as strings the API sent (formatted by the component). */
export type SoloMoney = { currency: string; unpaid: string; unpaidCount: number; paidThisMonth: string; overdue: string; overdueCount: number };

export type SoloDashboard = {
  status: "ready";
  layout: "solo";
  greetingName: string;
  workspaceName: string;
  today: string;
  /** One line under the greeting: what needs doing first. */
  headline: string;
  tasks: { today: SoloTask[]; overdue: SoloTask[] };
  projects: SoloProject[];
  awaiting: ApprovalItem[];
  feedback: NoteRow[];
  money: SoloMoney | null;
  activity: ActivityItem[];
  problems: { tasks: string | null; review: string | null; feedback: string | null; money: string | null; activity: string | null };
};

export type SoloInput = {
  greetingName: string; now: Date; workspace: Pick<Workspace, "name">;
  projects: Project[]; tasks: Task[] | ApiFailure; clients: ClientTeam[] | ApiFailure;
  files: ProjectFile[] | ApiFailure; stages: Pick<TaskStage, "id" | "name" | "kind">[] | ApiFailure;
  notes: { results: NoteToAddress[] } | ApiFailure; activity: ActivityEntry[] | ApiFailure;
  money: MoneySummary | ApiFailure | null;
};

const sum = (values: string[]) => (values.reduce((total, value) => total + toMinor(value), 0) / 100).toFixed(2);

export function buildSoloMoney(summary: MoneySummary, now: Date): SoloMoney {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const live = summary.invoices.filter((invoice) => invoice.currency === summary.currency);
  const unpaid = live.filter((invoice) => toMinor(invoice.outstanding) > 0 && invoice.status !== "draft");
  const overdue = unpaid.filter((invoice) => invoice.display_status === "overdue");
  const paidThisMonth = live.filter((invoice) => invoice.paid_at && new Date(invoice.paid_at).getTime() >= monthStart);
  return {
    currency: summary.currency,
    unpaid: summary.totals.clients_owe,
    unpaidCount: unpaid.length,
    paidThisMonth: sum(paidThisMonth.map((invoice) => invoice.paid)),
    overdue: summary.totals.overdue,
    overdueCount: overdue.length,
  };
}

export function buildSoloDashboard(input: SoloInput): SoloDashboard {
  const { now } = input;
  const tasks = isFailure(input.tasks) ? [] : input.tasks;
  const clients = isFailure(input.clients) ? [] : input.clients;
  const projectName = new Map(input.projects.map((project) => [project.id, project.name]));
  const clientName = new Map(clients.map((client) => [client.id, client.name]));
  const endOfToday = startOfDay(now) + DAY_MS;
  const startToday = startOfDay(now);
  const row = (task: Task): SoloTask => ({
    id: task.id, title: task.title, project: task.project_id ? projectName.get(task.project_id) ?? null : null,
    due: dueLabel(task, now), overdue: Boolean(task.due_at && new Date(task.due_at).getTime() < startToday),
    href: task.project_id ? `/tasks?project=${task.project_id}` : "/tasks",
  });
  const open = tasks.filter(isOpen).filter((task) => task.due_at);
  const byDue = (a: Task, b: Task) => new Date(a.due_at!).getTime() - new Date(b.due_at!).getTime();
  const overdue = open.filter((task) => new Date(task.due_at!).getTime() < startToday).sort(byDue).map(row);
  const today = open.filter((task) => { const t = new Date(task.due_at!).getTime(); return t >= startToday && t < endOfToday; }).sort(byDue).map(row);

  const openByProject = new Map<string, number>();
  for (const task of tasks.filter(isOpen)) if (task.project_id) openByProject.set(task.project_id, (openByProject.get(task.project_id) ?? 0) + 1);
  const projects = openProjects(input.projects).filter((project) => project.status === "ACTIVE" || project.status === "DRAFT").slice(0, 6).map((project): SoloProject => {
    const due = project.due_at ? new Date(project.due_at).getTime() : null;
    const tone: Tone = due === null ? "neutral" : due < startToday ? "danger" : due < startToday + 7 * DAY_MS ? "warning" : "success";
    return {
      id: project.id, name: project.name, client: project.client_team_id ? clientName.get(project.client_team_id) ?? null : null,
      due: project.due_at ? dueLabel(project, now) : "No due date", tone, openTasks: openByProject.get(project.id) ?? 0, href: `/projects/${project.id}`,
    };
  });

  const reviewFailed = isFailure(input.files) || isFailure(input.stages);
  const awaiting = reviewFailed ? [] : buildApprovals(input.files as ProjectFile[], input.stages as TaskStage[], input.projects, clients, now)
    .filter((item) => item.kind === "client_review");
  const feedback = isFailure(input.notes) ? [] : buildNotes(input.notes.results, now).filter((note) => note.client).slice(0, 4);
  const money = input.money && !isFailure(input.money) ? buildSoloMoney(input.money, now) : null;

  const parts: string[] = [];
  if (overdue.length) parts.push(`${overdue.length} overdue ${overdue.length === 1 ? "task" : "tasks"}`);
  if (today.length) parts.push(`${today.length} due today`);
  if (awaiting.length) parts.push(`${awaiting.length} ${awaiting.length === 1 ? "cut" : "cuts"} with clients`);
  const headline = parts.length ? `You have ${parts.join(", ")}.` : "You're all caught up. Nothing is overdue or waiting on a client.";

  return {
    status: "ready", layout: "solo",
    greetingName: input.greetingName, workspaceName: input.workspace.name, today: todayLabel(now), headline,
    tasks: { today, overdue }, projects, awaiting, feedback, money,
    activity: isFailure(input.activity) ? [] : buildActivity(input.activity, now),
    problems: {
      tasks: problem("Tasks", input.tasks),
      review: problem("Files", input.files) ?? problem("Stages", input.stages),
      feedback: problem("Client feedback", input.notes),
      money: input.money && isFailure(input.money) ? `Invoices could not be loaded: ${input.money.detail}` : null,
      activity: problem("Activity", input.activity),
    },
  };
}

export async function loadSoloDashboard(greetingName: string, workspace: Workspace): Promise<SoloDashboard | DashboardFailure> {
  const now = new Date();
  const [projects, tasks, clients, files, stages, notes, activity, money] = await Promise.all([
    listProjects(workspace.id), listTasks(workspace.id), listClientTeams(workspace.id), listAssetFiles(workspace.id),
    listTaskStages(workspace.id), listNotesToAddress(workspace.id, 12), listActivity(workspace.id, { pageSize: DASHBOARD_ACTIVITY_LIMIT }),
    workspace.billing?.view ? getMoneySummary(workspace.id) : Promise.resolve(null),
  ]);
  if (!projects.ok) return failureView(greetingName, now, projects.error);
  const settle = <T,>(result: { ok: true; data: T } | { ok: false; error: ApiFailure }): T | ApiFailure => (result.ok ? result.data : result.error);
  return buildSoloDashboard({
    greetingName, now, workspace, projects: projects.data,
    tasks: settle(tasks), clients: settle(clients), files: settle(files),
    stages: stages.ok ? stages.data.stages : stages.error, notes: settle(notes),
    activity: activity.ok ? activity.data.results : activity.error,
    money: money ? settle(money) : null,
  });
}
