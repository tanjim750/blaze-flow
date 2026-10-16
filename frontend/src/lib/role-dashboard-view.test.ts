import { describe, expect, it, vi } from "vitest";
import type { MediaVersion, MyCut, NoteToAddress, Project, ProjectFile, Task, TeamWorkload } from "./api";
import type { DashboardReady } from "./dashboard-view";
import {
  buildApprovals, buildClientDashboard, buildClientPortal, buildDelivered, buildEditorDashboard, buildEditorTasks, buildMyCutsInReview,
  buildNotes, buildOwnerDashboard, buildProjectHealth, buildWorkload, inReviewLoop,
} from "./role-dashboard-view";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const NOW = new Date("2026-10-03T12:00:00");
const iso = (hours: number) => new Date(NOW.getTime() + hours * 3600000).toISOString();

const project = (id: string, status: string, due_at: string | null, client_team_id: string | null = null): Project => ({
  id, workspace_id: "ws", client_team_id, name: `Project ${id}`, description: null, status, priority: "MEDIUM",
  start_at: null, due_at, created_at: iso(-200), updated_at: iso(-200),
});
const task = (id: string, assignee: string | null, due_at: string | null, extra: Partial<Task> = {}): Task => ({
  id, workspace_id: "ws", client_team_id: null, project_id: "p1", task_stage_id: null, title: `Task ${id}`,
  description: null, status: "TODO", priority: "HIGH", start_at: null, due_at, completed_at: null, sort_order: 0,
  created_at: iso(-100), updated_at: iso(-100),
  assignees: assignee ? [{ id: assignee, name: "Someone", email: "s@example.com" }] : [], ...extra,
});
const file = (id: string, stageId: string | null, extra: Partial<ProjectFile> = {}): ProjectFile => ({
  id, workspace_id: "ws", client_team_id: "c1", project_id: "p1", folder_id: null, task_stage_id: stageId,
  file: { id: `f-${id}`, name: `${id}.mp4`, mime_type: "video/mp4", size_bytes: 1, checksum_sha256: "", status: "READY", duration_ms: 1000 },
  added_by: null, poster: { width: 1920, height: 1080 }, comment_count: 0, version_number: 1,
  media_asset: { id: `a-${id}`, name: `Asset ${id}`, version_count: 1, is_latest: true }, created_at: iso(-10), ...extra,
});
const STAGES = [
  { id: "s-review", name: "Review", kind: "review" as const },
  { id: "s-client", name: "Client Review", kind: "client_review" as const },
  { id: "s-todo", name: "To Do", kind: "todo" as const },
];
const media = (id: string, stage: { name: string; slug: string; entered_at?: string } | null, extra: Partial<MediaVersion> = {}): MediaVersion => ({
  id, project_id: "p1", version_number: 2, title: `Cut ${id}`, note: null, priority: "MEDIUM", allow_download: false,
  status: "ACTIVE", file: { id: `file-${id}`, name: "cut.mp4", mime_type: "video/mp4", size_bytes: 1 },
  current_stage: stage ? { id: stage.slug, ...stage } : null, preview_status: "READY", created_at: iso(-30), poster: null, ...extra,
});
const myCut = (id: string, stage: { name: string; slug: string } | null, open_notes = 0): MyCut => ({
  id, title: `Cut ${id}`, version_number: 1, file_id: `file-${id}`, project: { id: "p1", name: "Spring" },
  stage: stage ? { id: stage.slug, entered_at: iso(-2), ...stage } : null, created_at: iso(-20), reasons: ["uploaded"],
  open_notes, href: `/review?media=file-${id}`, poster: null,
});
const note = (id: string, extra: Partial<NoteToAddress> = {}): NoteToAddress => ({
  id, text: "Pull saturation 10%", start_time_ms: 65_000, end_time_ms: null, visibility: "client",
  author: { type: "user", id: "u2", name: "Priya Raman", initials: "PR", avatar_url: null }, reply_count: 2,
  created_at: iso(-3), reasons: ["assigned"],
  media: { id: "m1", title: "Hero 30s", version_number: 2, file_id: "f1", project: { id: "p1", name: "Spring" }, stage: null },
  href: "/review?media=f1&comment=n1&t=65000", ...extra,
});

describe("owner: approvals waiting", () => {
  it("lists latest cuts in Client Review then Review, by stage kind, oldest first", () => {
    const items = buildApprovals([
      file("internal", "s-review", { created_at: iso(-50) }),
      file("client-new", "s-client", { created_at: iso(-5) }),
      file("client-old", "s-client", { created_at: iso(-40) }),
      file("todo", "s-todo"),
      file("none", null),
      file("superseded", "s-client", { media_asset: { id: "a", name: "Old", version_count: 2, is_latest: false } }),
    ], STAGES, [project("p1", "ACTIVE", null)], [{ id: "c1", name: "Northlight" }], NOW);
    expect(items.map((item) => item.id)).toEqual(["client-old", "client-new", "internal"]);
    expect(items[0]).toMatchObject({ stage: "Client Review", client: "Northlight", project: "Project p1", tone: "accent", href: "/review?media=f-client-old" });
    expect(items[0].poster).toBe("/api/workspaces/ws/asset-files/client-old/poster/");
  });

  it("follows a renamed stage by its kind", () => {
    const items = buildApprovals([file("x", "s-client")], [{ id: "s-client", name: "With the client", kind: "client_review" }], [], [], NOW);
    expect(items[0]).toMatchObject({ stage: "With the client", kind: "client_review", project: "No project", client: null });
  });
});

describe("owner: project health", () => {
  it("flags on hold, overdue and due this week once each, and counts the rest as healthy", () => {
    const health = buildProjectHealth([
      project("late", "ACTIVE", iso(-30)),
      project("soon", "ACTIVE", iso(48)),
      project("paused", "ON_HOLD", iso(-100)),
      project("fine", "ACTIVE", iso(24 * 20)),
      project("undated", "DRAFT", null),
      project("done", "COMPLETED", iso(-100)),
    ], [task("t1", null, iso(-5), { project_id: "late" }), task("t2", null, iso(5), { project_id: "late" }), task("t3", null, iso(-5), { project_id: "late", status: "COMPLETED" })], [], NOW);
    expect(health.counts).toEqual({ overdue: 1, due_week: 1, on_hold: 1 });
    expect(health.healthy).toBe(2);
    expect(health.rows.map((row) => row.flag)).toEqual(["overdue", "due_week", "on_hold"]);
    expect(health.rows[0]).toMatchObject({ id: "late", due: "Due yesterday", openTasks: 2, overdueTasks: 1, tone: "danger" });
    expect(health.rows[1]).toMatchObject({ due: "Due Oct 5" });
  });
});

describe("owner: workload", () => {
  const data: TeamWorkload = {
    results: [
      { membership_id: "m1", user: { id: "u1", name: "Maya", initials: "M", avatar_url: null }, open: 4, overdue: 3, due_this_week: 1 },
      { membership_id: "m2", user: { id: "u2", name: "Theo", initials: "T", avatar_url: null }, open: 2, overdue: 0, due_this_week: 0 },
      { membership_id: "m3", user: { id: "u3", name: "Jordan", initials: "J", avatar_url: null }, open: 0, overdue: 0, due_this_week: 0 },
    ],
    unassigned: { open: 1, overdue: 1 }, total_open: 7, generated_at: iso(0),
  };

  it("scales bars to the busiest person, with the overdue share on top", () => {
    const view = buildWorkload(data);
    expect(view.rows.map((row) => [row.name, row.percent, row.overduePercent])).toEqual([["Maya", 100, 75], ["Theo", 50, 0], ["Jordan", 0, 0]]);
    expect(view.rows[0].href).toBe("/tasks?assignee=m1");
    expect(view.unassigned).toEqual({ open: 1, overdue: 1 });
    expect(buildWorkload(data, 1).rows).toHaveLength(1);
  });

  it("does not divide by zero when nobody has work", () => {
    const view = buildWorkload({ ...data, results: [{ ...data.results[2] }] });
    expect(view.rows[0].percent).toBe(0);
  });
});

describe("editor: my tasks", () => {
  it("keeps my open tasks: overdue (most overdue first), then due in the next week; counts the rest", () => {
    const groups = buildEditorTasks([
      task("late-1", "me", iso(-2)),
      task("late-9", "me", iso(-200)),
      task("today", "me", iso(3)),
      task("in-5d", "me", iso(24 * 5)),
      task("in-20d", "me", iso(24 * 20)),
      task("undated", "me", null),
      task("closed", "me", iso(-5), { status: "COMPLETED" }),
      task("theirs", "other", iso(-5)),
    ], "me", new Map([["p1", "Spring"]]), NOW);
    expect(groups.overdue.map((item) => item.id)).toEqual(["late-9", "late-1"]);
    expect(groups.dueSoon.map((item) => item.id)).toEqual(["today", "in-5d"]);
    expect(groups.dueSoon[0]).toMatchObject({ tone: "warning", when: expect.stringMatching(/^Today/), project: "Spring", href: "/tasks?task=today" });
    expect([groups.later, groups.undated, groups.total]).toEqual([1, 1, 6]);
  });

  it("has nothing of its own without a membership", () => {
    expect(buildEditorTasks([task("x", "me", iso(-1))], null, new Map(), NOW).total).toBe(0);
  });
});

describe("editor: notes and cuts", () => {
  it("formats a note with its timecode and deep link", () => {
    const [row] = buildNotes([note("n1")], NOW);
    expect(row).toMatchObject({ author: "Priya Raman", timecode: "01:05", cut: "Hero 30s · V2", project: "Spring", replies: 2, team: false, href: "/review?media=f1&comment=n1&t=65000" });
    const [plain] = buildNotes([note("n2", { start_time_ms: null, text: null, visibility: "team", author: { type: "guest", id: null, name: "Rachel", initials: "R", avatar_url: null } })], NOW);
    expect(plain).toMatchObject({ timecode: null, text: "(attachment only)", team: true, guest: true });
  });

  it("shows only cuts between going up for review and approval", () => {
    expect(inReviewLoop({ name: "In Review", slug: "in-review" })).toBe(true);
    expect(inReviewLoop({ name: "Revision", slug: "revision" })).toBe(true);
    expect(inReviewLoop({ name: "Approval", slug: "approval" })).toBe(true);
    expect(inReviewLoop({ name: "Approved", slug: "approved" })).toBe(false);
    expect(inReviewLoop({ name: "Queued", slug: "queued" })).toBe(false);
    expect(inReviewLoop(null)).toBe(false);
    const rows = buildMyCutsInReview([myCut("a", { name: "In Review", slug: "in-review" }, 3), myCut("b", { name: "Approved", slug: "approved" }), myCut("c", null)], NOW);
    expect(rows.map((row) => [row.id, row.stage, row.openNotes, row.tone])).toEqual([["a", "In Review", 3, "blue"]]);
    expect(rows[0].age).toBe("2h ago");
  });

  it("builds the editor strip and reports failures per panel", () => {
    const view = buildEditorDashboard({
      greetingName: "Maya", now: NOW, workspace: { name: "Studio", my_membership_id: "me" },
      projects: [project("p1", "ACTIVE", null)], tasks: [task("today", "me", iso(2)), task("late", "me", iso(-2))],
      notes: { results: [note("n1")], count: 9 }, cuts: { status: 500, detail: "boom" }, activity: [],
    });
    expect(view.layout).toBe("editor");
    expect(view.strip.map((item) => [item.label, item.value])).toEqual([
      ["My tasks due today", 1], ["My overdue tasks", 1], ["Notes to address", 9], ["My cuts in review", null],
    ]);
    expect(view.problems.cuts).toBe("Your cuts could not be loaded: boom");
    expect(view.problems.notes).toBeNull();
  });
});

describe("owner view", () => {
  const base = {
    status: "ready", greetingName: "Alex", workspaceName: "Studio", today: "Sat, Oct 3",
    counts: { activeProjects: 2, awaitingReview: 1, dueToday: 0, overdue: 0, taskScope: "mine" },
    attention: [], tasks: [], membershipId: "me", reviewQueue: [], reviewTotal: 0, projects: [], openProjectCount: 2,
    deadlines: [], activity: [], problems: { tasks: null, reviews: null, activity: null },
  } as DashboardReady;

  it("puts approvals, health and workload together, and explains a 403 on workload", () => {
    const view = buildOwnerDashboard({
      base, now: NOW, projects: [project("p1", "ACTIVE", iso(-5))],
      tasks: [task("late", "x", iso(-1)), task("ok", "x", iso(50))],
      files: [file("c", "s-client")], stages: STAGES as never, clients: [],
      workload: { status: 403, detail: "no" },
    });
    expect(view.layout).toBe("owner");
    expect(view.strip.map((item) => [item.label, item.value])).toEqual([
      ["Active projects", 2], ["Waiting on approval", 1], ["Projects at risk", 1], ["Overdue tasks", 1],
    ]);
    expect(view.workload).toBeNull();
    expect(view.problems.workload).toMatch(/Only owners and admins/);
  });
});

describe("client view", () => {
  it("shows projects, cuts to review and approved work — and nothing about tasks or notes", () => {
    const projects = [project("p1", "ACTIVE", iso(48)), project("p2", "DRAFT", null)];
    const view = buildClientDashboard({
      greetingName: "Sam", now: NOW, workspace: { name: "Studio" }, projects,
      scanned: [
        { project: projects[0], media: [
          media("waiting", { name: "In Review", slug: "in-review" }),
          media("approved", { name: "Approved", slug: "approved", entered_at: iso(-5) }, { allow_download: true }),
          media("queued", { name: "Queued", slug: "queued" }),
        ] },
        { project: projects[1], media: { status: 500, detail: "x" } },
      ],
    });
    expect(view.layout).toBe("client");
    expect(view.waiting.map((item) => item.id)).toEqual(["waiting"]);
    expect(view.delivered.map((item) => [item.id, item.downloadable, item.age])).toEqual([["approved", true, "5h ago"]]);
    expect(view.delivered[0].downloadHref).toBe("/api/workspaces/ws/projects/p1/media-versions/approved/download/");
    expect(view.projects.map((item) => [item.id, item.waiting])).toEqual([["p1", 1], ["p2", 0]]);
    expect(view.strip.map((item) => item.value)).toEqual([2, 1, 1]);
    expect(view.problems.reviews).toMatch(/1 project's cuts/);
    expect(Object.keys(view)).not.toEqual(expect.arrayContaining(["tasks"]));
    expect(JSON.stringify(view)).not.toMatch(/notes|workload/i);
  });

  it("orders approved cuts by when they were approved", () => {
    const p = project("p1", "ACTIVE", null);
    const rows = buildDelivered([{ project: p, media: [
      media("older", { name: "Approved", slug: "approved", entered_at: iso(-50) }),
      media("newer", { name: "Approved", slug: "approved", entered_at: iso(-1) }),
    ] }], NOW);
    expect(rows.map((row) => row.id)).toEqual(["newer", "older"]);
  });
});

describe("client portal additions", () => {
  const portal = {
    projects: [{ id: "p1", name: "Spring", status: "ACTIVE" }], max_file_bytes: 100, accept: ["video/*"],
    recent_uploads: Array.from({ length: 9 }, (_, index) => ({ id: `u${index}` })) as never[],
  };

  it("builds the upload area only when there is a project to send to", () => {
    expect(buildClientPortal("w1", portal)).toMatchObject({ workspaceId: "w1", maxBytes: 100, projects: portal.projects });
    expect(buildClientPortal("w1", portal)?.recent).toHaveLength(6);
    expect(buildClientPortal("w1", { ...portal, projects: [] })).toBeUndefined();
    expect(buildClientPortal("w1", { status: 500, detail: "x" })).toBeUndefined();
    expect(buildClientPortal("w1", null)).toBeUndefined();
  });

  it("adds recent activity when it was loaded, and reports a failed load", () => {
    const base = { greetingName: "Sam", now: NOW, workspace: { name: "Studio" }, projects: [], scanned: [] };
    expect(buildClientDashboard(base).activity).toBeUndefined();
    const failedLoad = buildClientDashboard({ ...base, activity: { status: 500, detail: "down" } });
    expect(failedLoad.activity).toEqual([]);
    expect(failedLoad.problems.activity).toBe("Activity could not be loaded: down");
    const ok = buildClientDashboard({ ...base, activity: [] });
    expect(ok.activity).toEqual([]);
    expect(ok.problems.activity).toBeNull();
  });
});
