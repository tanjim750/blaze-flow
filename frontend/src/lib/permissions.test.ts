import { describe, expect, it } from "vitest";
import { FULL_TASK_ACCESS, isReadOnlyTasks, reviewAccess, taskAccess, type PermissionsAnswer } from "./permissions";

const answer = (permissions: string[], project: string[] | null = null, role: PermissionsAnswer["dashboard_role"] = "editor"): PermissionsAnswer => ({
  workspace_id: "ws", dashboard_role: role, permissions, project: project ? { id: "p", permissions: project } : null,
});

describe("taskAccess", () => {
  it("is never writable for a client, whatever the permission list says", () => {
    const access = taskAccess(answer(["task.create", "task.update"], null, "client"));
    expect(access.client).toBe(true);
    expect(isReadOnlyTasks(access)).toBe(true);
  });
  it("maps task permissions for team members", () => {
    expect(taskAccess(answer(["task.read", "task.update"]))).toEqual({ create: false, update: true, delete: false, manageStages: false, client: false });
    expect(isReadOnlyTasks(taskAccess(answer(["task.read"])))).toBe(true);
  });
  it("falls back to full access when the answer is unknown, leaving the server to decide", () => {
    expect(taskAccess(null)).toEqual(FULL_TASK_ACCESS);
    expect(taskAccess(null, "client").client).toBe(true);
  });
});

describe("reviewAccess", () => {
  it("reads the project's permissions", () => {
    expect(reviewAccess(answer([], ["review.comment.read"]))).toEqual({ comment: false, resolve: false, annotate: false, react: false });
    expect(reviewAccess(answer([], ["review.comment.create", "review.comment.manage", "annotation.create", "review.reaction.create"])))
      .toEqual({ comment: true, resolve: true, annotate: true, react: true });
  });
  it("is unknown without a project", () => {
    expect(reviewAccess(answer(["task.read"]))).toBeNull();
    expect(reviewAccess(null)).toBeNull();
  });
});
