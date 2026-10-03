import { describe, expect, it, vi } from "vitest";
import type { MediaVersion, Notification, Project, Task } from "./api";
import {
  awaitsReview, buildActivity, buildDashboardView, buildReviewQueue, countActiveProjects,
  describeNotification, failureView, isMine, openProjects,
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
const notification = (kind: string, payload: Record<string, unknown>, extra: Partial<Notification> = {}): Notification => ({
  id: `n-${kind}`, kind, workspace_id: "ws", actor: { id: "u", email: "maya@example.com", name: "Maya Chen" },
  entity_type: null, entity_id: null, payload, unread: true, read_at: null, created_at: iso(-2), ...extra,
});

const baseInput = () => ({
  greetingName: "Alex",
  now: NOW,
  workspace: { id: "ws", name: "Studio", my_membership_id: "me" },
  projects: [project("p1", "ACTIVE"), project("p2", "DRAFT"), project("p3", "ARCHIVED"), project("p4", "ACTIVE")],
  tasks: [task("mine-today", "me", iso(3)), task("mine-late", "me", iso(-30)), task("theirs-today", "other", iso(2)), task("theirs-late", "other", iso(-5))],
  notifications: [] as Notification[],
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
  it("words a mention as a mention, with its excerpt and a deep link", () => {
    const item = describeNotification(notification("REVIEW_COMMENT_MENTION", { project_id: "p1", media_version_id: "mv", excerpt: "Logo lands late" }), NOW);
    expect(item).toMatchObject({ actor: "Maya Chen", action: "mentioned you in a review note", href: "/review?project=p1&version=mv", initials: "MC" });
    expect(item.detail).toBe("2h ago · “Logo lands late”");
  });

  it("words a client-ready task as a hand-off, not a mention", () => {
    const item = describeNotification(notification("TASK_CLIENT_READY", { task_id: "t9", title: "Hero 30s v2" }), NOW);
    expect(item.action).toBe("marked “Hero 30s v2” ready for your review");
    expect(item.action).not.toMatch(/mention/);
    expect(item.href).toBe("/tasks?task=t9");
  });

  it("never borrows another kind's sentence for an unknown kind", () => {
    const item = describeNotification(notification("MEDIA_VERSION_UPLOADED", {}), NOW);
    expect(item.action).not.toMatch(/mention/);
    expect(item.action).toContain("media version uploaded");
    expect(item.href).toBeNull();
  });

  it("keeps to the current workspace", () => {
    const rows = buildActivity([
      notification("REVIEW_COMMENT_MENTION", {}, { id: "here" }),
      notification("REVIEW_COMMENT_MENTION", {}, { id: "elsewhere", workspace_id: "other" }),
    ], "ws", NOW);
    expect(rows.map((row) => row.id)).toEqual(["here"]);
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
