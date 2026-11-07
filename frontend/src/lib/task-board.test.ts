import { describe, expect, it } from "vitest";
import type { Task, TaskStage } from "./api";
import {
  activeFilterCount, applyMove, DEFAULT_STAGES, dueState, EMPTY_FILTERS, formatDue, groupByStage, matchesDue, matchTask, moveGuard, parseFilters, positionOf,
  stageIdOf, stageTone, toBoardStages, writeFilters, type FilterContext,
} from "./task-board";

const stages = [...DEFAULT_STAGES];
const [todo, inProgress, review, clientReview, revisions, approved] = stages;
let n = 0;
const task = (patch: Partial<Task> = {}): Task => ({
  id: `t${++n}`, workspace_id: "w", client_team_id: "c", project_id: "p", task_stage_id: todo.id, title: `Task ${n}`, description: null, status: "TODO", priority: "MEDIUM",
  start_at: null, due_at: null, completed_at: null, sort_order: 0, created_at: "2026-09-01", updated_at: "2026-09-01", assignees: [], ...patch,
});
const apiStage = (patch: Partial<TaskStage>): TaskStage => ({ id: "s", name: "Stage", color: "#123456", sort_order: 0, wip_limit: null, is_done: false, automation_enabled: false, task_count: 0, ...patch });

describe("stages", () => {
  it("ships the six stages in workflow order with Approved as the only done stage", () => {
    expect(stages.map((stage) => stage.name)).toEqual(["To Do", "In Progress", "Review", "Client Review", "Revisions", "Approved"]);
    expect(stages.filter((stage) => stage.isDone).map((stage) => stage.name)).toEqual(["Approved"]);
  });

  it("infers kinds for older payloads, including the pre-rename names, and never assigns a kind twice", () => {
    const board = toBoardStages([
      apiStage({ id: "a", name: "Internal QA", sort_order: 1 }), apiStage({ id: "b", name: "Client", sort_order: 2 }),
      apiStage({ id: "c", name: "To Do", sort_order: 0 }), apiStage({ id: "d", name: "Review", sort_order: 3 }), apiStage({ id: "e", name: "Colour", sort_order: 4, kind: "custom" }),
    ]);
    expect(board.map((stage) => [stage.name, stage.kind])).toEqual([["To Do", "todo"], ["Internal QA", "review"], ["Client", "client_review"], ["Review", "custom"], ["Colour", "custom"]]);
  });

  it("uses design-system tones for built-in stages and a dot-only hex for custom ones", () => {
    expect(stageTone(clientReview)).toEqual({ dot: "var(--tb-stage-client-review)", tone: "var(--tb-stage-client-review)" });
    expect(stageTone(review).tone).toBe("var(--tb-stage-review)");
    expect(stageTone({ kind: "custom", color: "#ff00aa" })).toEqual({ dot: "#ff00aa", tone: null });
  });

  it("puts a task whose stage is gone into the first column", () => {
    expect(stageIdOf({ task_stage_id: "deleted" }, stages)).toBe(todo.id);
    expect(stageIdOf({ task_stage_id: null }, stages)).toBe(todo.id);
  });
});

describe("grouping and moves", () => {
  it("groups by stage in sort order, with every stage present", () => {
    const a = task({ sort_order: 1 }), b = task({ sort_order: 0 }), c = task({ task_stage_id: review.id });
    const groups = groupByStage([a, b, c], stages);
    expect(groups.get(todo.id)!.map((item) => item.id)).toEqual([b.id, a.id]);
    expect(groups.get(review.id)!.map((item) => item.id)).toEqual([c.id]);
    expect(groups.get(approved.id)).toEqual([]);
  });

  it("breaks sort ties by creation time, like the move endpoint", () => {
    const later = task({ created_at: "2026-09-02" }), earlier = task({ created_at: "2026-09-01T10:00:00Z", updated_at: "2026-09-20" });
    expect(groupByStage([later, earlier], stages).get(todo.id)!.map((item) => item.id)).toEqual([earlier.id, later.id]);
  });

  it("moves across columns, renumbering both densely", () => {
    const a = task({ sort_order: 0 }), b = task({ sort_order: 1 }), c = task({ sort_order: 2 });
    const x = task({ task_stage_id: inProgress.id, sort_order: 0 }), y = task({ task_stage_id: inProgress.id, sort_order: 1 });
    const next = applyMove([a, b, c, x, y], b.id, inProgress.id, 1, stages);
    const order = (stageId: string) => groupByStage(next, stages).get(stageId)!.map((item) => [item.id, item.sort_order]);
    expect(order(todo.id)).toEqual([[a.id, 0], [c.id, 1]]);
    expect(order(inProgress.id)).toEqual([[x.id, 0], [b.id, 1], [y.id, 2]]);
  });

  it("reorders within a column like arrayMove", () => {
    const a = task({ sort_order: 0 }), b = task({ sort_order: 1 }), c = task({ sort_order: 2 });
    const next = applyMove([a, b, c], a.id, todo.id, 2, stages);
    expect(groupByStage(next, stages).get(todo.id)!.map((item) => item.id)).toEqual([b.id, c.id, a.id]);
    expect(positionOf(next, a.id, stages)).toEqual({ stageId: todo.id, index: 2, size: 3 });
  });

  it("appends when no index is given and sets done state on approve and reopen", () => {
    const a = task({ task_stage_id: approved.id }), b = task();
    const approvedNow = applyMove([a, b], b.id, approved.id, null, stages).find((item) => item.id === b.id)!;
    expect(approvedNow).toMatchObject({ task_stage_id: approved.id, status: "APPROVED", sort_order: 1 });
    expect(approvedNow.completed_at).not.toBeNull();
    const reopened = applyMove([approvedNow], b.id, revisions.id, null, stages)[0];
    expect(reopened).toMatchObject({ status: "TODO", completed_at: null });
  });
});

describe("move guards", () => {
  const withCut = task({ attachment_file_ids: ["f1"] });
  it("is silent for ordinary moves and reorders", () => {
    expect(moveGuard(withCut, todo, inProgress, { clientId: "c" }).kind).toBe("silent");
    expect(moveGuard(withCut, review, review, { clientId: null }).kind).toBe("silent");
  });
  it("confirms approving and reopening", () => {
    expect(moveGuard(withCut, review, approved, { clientId: "c" })).toMatchObject({ kind: "confirm", dialog: "approve" });
    expect(moveGuard(withCut, approved, revisions, { clientId: "c" })).toMatchObject({ kind: "confirm", dialog: "reopen" });
  });
  it("blocks Client Review without a client and confirms it without a cut", () => {
    expect(moveGuard(withCut, review, clientReview, { clientId: null }).kind).toBe("blocked");
    expect(moveGuard(task(), review, clientReview, { clientId: "c" })).toMatchObject({ kind: "confirm", dialog: "client" });
    expect(moveGuard(withCut, review, clientReview, { clientId: "c" }).kind).toBe("silent");
  });
});

describe("due dates", () => {
  const now = new Date(2026, 8, 26, 10, 0).getTime();
  const at = (days: number, hour = 12) => new Date(2026, 8, 26 + days, hour).toISOString();
  it("classifies relative to the local day and never marks done work overdue", () => {
    expect(dueState(null, false, now)).toBe("none");
    expect(dueState(at(-1), false, now)).toBe("overdue");
    expect(dueState(at(0, 9), false, now)).toBe("overdue");
    expect(dueState(at(-1), true, now)).toBe("today");
    expect(dueState(at(0), false, now)).toBe("today");
    expect(dueState(at(2), false, now)).toBe("soon");
    expect(dueState(at(5), false, now)).toBe("later");
  });
  it("formats as Today / Tomorrow / Yesterday or a short date", () => {
    expect(formatDue(at(0), now)).toBe("Today");
    expect(formatDue(at(1), now)).toBe("Tomorrow");
    expect(formatDue(at(-1), now)).toBe("Yesterday");
    expect(formatDue(at(10), now)).toBe("6 Oct");
    expect(formatDue(new Date(2027, 0, 3).toISOString(), now)).toBe("3 Jan 2027");
  });
  it("filters by due window", () => {
    expect(matchesDue(at(3), "week", now)).toBe(true);
    expect(matchesDue(at(9), "week", now)).toBe(false);
    expect(matchesDue(null, "none", now)).toBe(true);
    expect(matchesDue(at(0), "today", now)).toBe(true);
  });
});

describe("filters", () => {
  it("round-trips through the URL and leaves other keys alone", () => {
    const params = new URLSearchParams("task=abc&q=old");
    const filters = { ...EMPTY_FILTERS, q: "hero cut", assignee: ["m1", "none"], priority: ["HIGH", "LOW"], due: "overdue" as const };
    writeFilters(filters, params);
    expect(params.get("task")).toBe("abc");
    expect(params.get("priority")).toBe("high,low");
    expect(parseFilters(params)).toEqual(filters);
    expect(activeFilterCount(filters)).toBe(6);
    expect(parseFilters(new URLSearchParams("due=bogus")).due).toBe("");
  });

  it("matches search across title, project, client and assignee, plus facets", () => {
    const context: FilterContext = { clientOf: (item) => item.client_team_id, projectName: () => "Summer Campaign", clientName: () => "Acme", isDone: (item) => item.task_stage_id === approved.id };
    const t = task({ title: "Grade", priority: "HIGH", assignees: [{ id: "m1", name: "Priya Rao", email: "p@x" }] });
    expect(matchTask(t, { ...EMPTY_FILTERS, q: "summer" }, context)).toBe(true);
    expect(matchTask(t, { ...EMPTY_FILTERS, q: "acme" }, context)).toBe(true);
    expect(matchTask(t, { ...EMPTY_FILTERS, q: "priya" }, context)).toBe(true);
    expect(matchTask(t, { ...EMPTY_FILTERS, q: "zebra" }, context)).toBe(false);
    expect(matchTask(t, { ...EMPTY_FILTERS, priority: ["LOW"] }, context)).toBe(false);
    expect(matchTask(t, { ...EMPTY_FILTERS, assignee: ["none"] }, context)).toBe(false);
    expect(matchTask(task(), { ...EMPTY_FILTERS, assignee: ["none"] }, context)).toBe(true);
    expect(matchTask(t, { ...EMPTY_FILTERS, client: ["other"] }, context)).toBe(false);
    const lateDone = task({ task_stage_id: approved.id, due_at: "2020-01-01T00:00:00Z" });
    expect(matchTask(lateDone, { ...EMPTY_FILTERS, due: "overdue" }, context)).toBe(false);
  });
});
