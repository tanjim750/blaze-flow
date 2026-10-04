/**
 * What the viewer may do, from `GET /api/workspaces/<id>/permissions/`.
 *
 * Pages used to find out by failing: a write control was shown, the server refused it, and
 * the page said so afterwards. These helpers turn the API's answer into the few yes/no
 * questions screens actually ask, so a read-only member or a client never meets a control
 * that can only fail. Unknown (the call itself failed) means "show it and let the server
 * decide", which is what the pages did before.
 */
import type { DashboardRole } from "./api";

export type PermissionsAnswer = {
  workspace_id: string;
  dashboard_role: DashboardRole | null;
  permissions: string[];
  project: { id: string; permissions: string[] } | null;
};

/** Tasks: what the board, the list, the detail sheet and review's task panel offer. */
export type TaskAccess = {
  create: boolean;
  update: boolean;
  delete: boolean;
  /** Customize stages (a workspace setting). */
  manageStages: boolean;
  /** In the workspace only through a client team: the board is the studio's, never theirs to change. */
  client: boolean;
};

export const FULL_TASK_ACCESS: TaskAccess = { create: true, update: true, delete: true, manageStages: true, client: false };

export function taskAccess(answer: PermissionsAnswer | null, role: DashboardRole | null = answer?.dashboard_role ?? null): TaskAccess {
  if (role === "client") return { create: false, update: false, delete: false, manageStages: false, client: true };
  if (!answer) return FULL_TASK_ACCESS;
  const has = new Set(answer.permissions);
  return {
    create: has.has("task.create"),
    update: has.has("task.update"),
    delete: has.has("task.delete"),
    manageStages: has.has("workspace.manage"),
    client: false,
  };
}

export const isReadOnlyTasks = (access: TaskAccess) => !access.create && !access.update && !access.delete;

/** Review: whether the comment composer, Resolve and drawing are real options on this cut. */
export type ReviewAccess = { comment: boolean; resolve: boolean; annotate: boolean; react: boolean };

export function reviewAccess(answer: PermissionsAnswer | null): ReviewAccess | null {
  if (!answer?.project) return null;
  const has = new Set(answer.project.permissions);
  return {
    comment: has.has("review.comment.create"),
    resolve: has.has("review.comment.manage"),
    annotate: has.has("annotation.create"),
    react: has.has("review.reaction.create"),
  };
}
