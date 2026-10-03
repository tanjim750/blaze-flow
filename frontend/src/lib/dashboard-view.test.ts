import { describe, expect, it, vi } from "vitest";
import type { MediaVersion, Project, Task } from "./api";
import type { ActivityEntry } from "./activity";
import {
  awaitsReview, buildActivity, buildDashboardView, buildReviewQueue, countActiveProjects,
  failureView, isMine, openProjects,
} from "./dashboard-view";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const NOW = new Date("2026-10-03T12:00:00");
const iso = (offsetHours: number) => new Date(NOW.getTime() + offsetHours * 3600000).toISOString();

const project = (id: string, status: string, due_at: string | null = null): Project => ({
  id, workspace_id: "ws", client_team_id: null, name: `Project ${id}`, description: null, status, priority: "MEDIUM",
  start_at: null, due_at, created_at: iso(-100), updated_at: iso(-100),
});
const task = (id: string, assignee: string | null, due_at: string | null, status = "TODO"): Task => ({
  id, workspace_id: "ws", client_team_id: null, project_id: "p1", task_stage_id: null, title: `Task ${id}`,
  description: null, status, priority: "HIGH", start_at: null, due_at, completed_at: null, sort_order: 0,
  created_at: iso(-100), updated_at: iso(-100),
  assignees: assignee ? [{ id: assignee, name: "Someone", email: "s@example.com" }] : [],
});
const stage = (name: string, slug: string) => ({ id: slug, name, slug });
const media = (id: string, stageRef: ReturnType<typeof stage> | null, poster: MediaVersion["poster"] = null, created = -1): MediaVersion => ({
  id, project_id: "p1", version_number: 2, title: `Cut ${id}`, note: null, priority: "MEDIUM", allow_download: false,
  status: "READY", file: { id: `file-${id}`, name: "cut.mp4", mime_type: "video/mp4", size_bytes: 1 },
  current_stage: stageRef, preview_status: "READY", created_at: iso(created), poster,
});
const entry = (action: string, extra: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id: `a-${action}`, created_at: iso(-2), action, category: "tasks",
  actor: { type: "user", id: "u", name: "Maya Chen", initials: "MC", avatar_url: null },
  verb: "", object: { type: "task", id: "t9", label: "Hero 30s", href: "/tasks?task=t9" },
  project: { id: "p1", name: "Spring Launch" }, before: null, after: null, detail: {}, team_only: false, summary: "", ...extra,
});

const baseInput = () => ({
  greetingName: "Alex",
  now: NOW,
  workspace: { id: "ws", name: "Studio", my_membership_id: "me" },
  projects: [project("p1", "ACTIVE"), project("p2", "DRAFT"), project("p3", "ARCHIVED"), project("p4", "ACTIVE")],
  tasks: [task("mine-today", "me", iso(3)), task("mine-late", "me", iso(-30)), task("theirs-today", "other", iso(2)), task("theirs-late", "other", iso(-5))],
  activity: [] as ActivityEntry[],
  scanned: [] as { project: Project; media: MediaVersion[] }[],
});

describe("active projects", () => {
  it("counts only ACTIVE-status projects, not every project", () => {
    expect(countActiveProjects([project("a", "ACTIVE"), project("b", "DRAFT"), project("c", "ON_HOLD"), project("d", "ACTIVE")])).toBe(2);
    expect(buildDashboardView(baseInput()).counts.activeProjects).toBe(2);
  });

  it("lists open projects, ACTIVE first, and leaves closed ones out", () => {
    const ordered = openProjects([project("d1", "DRAFT", iso(10)), project("a1", "ACTIVE", iso(50)), project("x", "COMPLETED"), project("a0", "ACTIVE", iso(5))]);
    expect(ordered.map((item) => item.id)).toEqual(["a0", "a1", "d1"]);
  });
});

describe("my tasks", () => {
  it("matches tasks by the viewer's membership id", () => {
    expect(isMine(task("t", "me", null), "me")).toBe(true);
    expect(isMine(task("t", "other", null), "me")).toBe(false);
    expect(isMine(task("t", "me", null), null)).toBe(false);
  });

  it("flags the viewer's tasks and scopes the strip's task counts to them", () => {
    const view = buildDashboardView(baseInput());
    expect(view.tasks.filter((item) => item.mine).map((item) => item.id).sort()).toEqual(["mine-late", "mine-today"]);
    expect(view.tasks).toHaveLength(4); // "Everyone" still has the rest.
    expect(view.counts).toMatchObject({ dueToday: 1, overdue: 1, taskScope: "mine" });
    expect(view.membershipId).toBe("me");
  });

  it("falls back to workspace counts when the viewer has no membership", () => {
    const view = buildDashboardView({ ...baseInput(), workspace: { id: "ws", name: "Studio", my_membership_id: null } });
    expect(view.counts).toMatchObject({ dueToday: 2, overdue: 2, taskScope: "workspace" });
    expect(view.tasks.every((item) => !item.mine)).toBe(true);
  });

  it("shows unknown task counts as null (a dash), not zero, when tasks fail to load", () => {
    const view = buildDashboardView({ ...baseInput(), tasks: { status: 500, detail: "boom" } });
    expect(view.counts.dueToday).toBeNull();
    expect(view.counts.overdue).toBeNull();
    expect(view.problems.tasks).toContain("boom");
  });
});

describe("review queue", () => {
  it("counts review and approval stages but not approved", () => {
    expect(awaitsReview(media("a", stage("In review", "in-review")))).toBe(true);
    expect(awaitsReview(media("b", stage("Approval", "approval")))).toBe(true);
    expect(awaitsReview(media("c", stage("Approved", "approved")))).toBe(false);
    expect(awaitsReview(media("d", stage("In progress", "in-progress")))).toBe(false);
    expect(awaitsReview(media("e", null))).toBe(false);
  });

  it("carries the real poster URL, newest first, and only cuts awaiting review", () => {
    const queue = buildReviewQueue([{ project: project("p1", "ACTIVE"), media: [
      media("old", stage("In review", "in-review"), { url: "/api/poster/old/", width: 1920, height: 1080 }, -48),
      media("new", stage("Approval", "approval"), null, -1),
      media("done", stage("Approved", "approved"), { url: "/api/poster/done/", width: 1, height: 1 }, 0),
    ] }], NOW);
    expect(queue.map((item) => item.id)).toEqual(["new", "old"]);
    expect(queue[1].poster).toBe("/api/poster/old/");
    expect(queue[0].poster).toBeNull();
    expect(queue[0]).toMatchObject({ version: "V2", stage: "Approval", href: "/review?media=file-new", age: "1h ago" });
  });

  it("reports projects whose cuts failed to load", () => {
    const view = buildDashboardView({ ...baseInput(), scanned: [{ project: project("p1", "ACTIVE"), media: { status: 500, detail: "x" } }] });
    expect(view.problems.reviews).toMatch(/1 project's cuts could not be loaded/);
    expect(view.counts.awaitingReview).toBe(0);
  });
});

describe("recent activity", () => {
  it("is the workspace feed, worded the same as the project timeline", () => {
    const [row] = buildActivity([entry("task.stage.moved", { before: "Review", after: "Client Review" })], NOW);
    expect(row).toMatchObject({ actor: "Maya Chen", action: "moved 'Hero 30s' from Review → Client Review", initials: "MC", href: "/tasks?task=t9" });
    expect(row.detail).toBe("2 hours ago · Spring Launch");
  });

  it("keeps to the latest six", () => {
    const rows = Array.from({ length: 9 }, (_, index) => entry("task.created", { id: `a${index}` }));
    expect(buildActivity(rows, NOW).map((row) => row.id)).toEqual(["a0", "a1", "a2", "a3", "a4", "a5"]);
  });

  it("says when the feed failed instead of looking empty", () => {
    const view = buildDashboardView({ ...baseInput(), activity: { status: 500, detail: "boom" } });
    expect(view.status === "ready" && view.problems.activity).toBe("Activity could not be loaded: boom");
  });
});

describe("failure", () => {
  it("is an error state with no numbers at all", () => {
    const view = failureView("Alex", NOW, { status: 0, detail: "fetch failed" });
    expect(view.status).toBe("error");
    expect(view.title).toMatch(/Can't reach/);
    // Only words: no counts, tasks, projects or sample content to fall back on.
    expect(Object.keys(view).sort()).toEqual(["detail", "greetingName", "status", "title", "today"]);
  });

  it("names the status when the server answered", () => {
    expect(failureView("Alex", NOW, { status: 502, detail: "Bad gateway" }).detail).toBe("The server answered 502: Bad gateway");
  });
});
