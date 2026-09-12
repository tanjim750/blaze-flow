import { listAnnotations, listGuestInvites, listReviewComments, listTaskAttachments, listTasks, listWorkflowStages, listWorkspaceMembers } from "./api";
import type { Annotation, GuestInvite, TaskStage } from "./api";
import { nestNotes, type ReviewNote } from "./review-notes";
import { defaultSelection, loadMediaCatalogue, locate, locateByTarget, type ReviewAsset, type ReviewTarget, type ReviewVersion } from "./review-media";

export type { ReviewNote } from "./review-notes";
export { nestNotes } from "./review-notes";
export type { ReviewAsset, ReviewTarget, ReviewVersion } from "./review-media";

/** A task this media is attached to. Real: `TaskAttachment.file` is the same `File` row. */
export type LinkedTask = { id: string; title: string; stageName: string | null };
export type Mentionable = { id: string; name: string; email: string };

export type ReviewView = {
  workspaceId: string | null;
  /** The version line being reviewed, with every cut in it. */
  asset: ReviewAsset | null;
  /** The cut on screen. */
  version: ReviewVersion | null;
  /**
   * Where this cut's review data lives, or null when it has none.
   *
   * A library file that was never published as a project media version has nowhere on the
   * server to keep a note, so the page keeps them on the device and says so. Everything
   * else about the experience is identical, which is the point.
   */
  target: ReviewTarget | null;
  notes: ReviewNote[];
  annotations: Annotation[];
  /** Media workflow stages — what Approve / Request changes move the cut between. */
  stages: { id: string; name: string; isApproval: boolean }[];
  /** Workspace task stages — the status a library file carries, shared with the board. */
  taskStages: TaskStage[];
  linkedTasks: LinkedTask[];
  members: Mentionable[];
  guestInvites: GuestInvite[];
  canManageGuests: boolean;
  canComment: boolean;
  notice: string | null;
};

const EMPTY: ReviewView = {
  workspaceId: null, asset: null, version: null, target: null, notes: [], annotations: [],
  stages: [], taskStages: [], linkedTasks: [], members: [], guestInvites: [],
  canManageGuests: false, canComment: false, notice: null,
};

/**
 * Loads the review workspace for one cut.
 *
 * Selection is by `File` id (`?media=`), which is what every entry point links with — see
 * `review-media.ts`. `?project=` and `?version=` are still honoured so that links made
 * before this feature, and the ones the dashboard still builds, keep working.
 */
export async function loadReviewView(params: { mediaId?: string; projectId?: string; versionId?: string }): Promise<ReviewView> {
  const catalogue = await loadMediaCatalogue();
  if (!catalogue.workspaceId) return { ...EMPTY, notice: catalogue.notice };

  const found =
    locate(catalogue.assets, params.mediaId)
    ?? locateByTarget(catalogue.assets, params.projectId, params.versionId)
    ?? defaultSelection(catalogue.assets);

  const base: ReviewView = {
    ...EMPTY,
    workspaceId: catalogue.workspaceId,
    taskStages: catalogue.stages,
    notice: params.mediaId && !locate(catalogue.assets, params.mediaId)
      ? "That media is not in this workspace, so the most recent cut is shown instead."
      : catalogue.notice,
  };
  if (!found) return base;

  const { asset, version } = found;
  const [stages, members] = await Promise.all([
    listWorkflowStages(catalogue.workspaceId),
    listWorkspaceMembers(catalogue.workspaceId),
  ]);

  const view: ReviewView = {
    ...base,
    asset,
    version,
    target: version.target,
    linkedTasks: await linkedTasks(catalogue.workspaceId, asset.projectId, version.id),
    members: members.ok
      ? members.data.flatMap((row) => row.user ? [{ id: row.user.id, name: `${row.user.first_name} ${row.user.last_name}`.trim() || row.user.email, email: row.user.email }] : [])
      : [],
    stages: stages.ok
      ? stages.data.map((stage) => ({ id: stage.id, name: stage.name, isApproval: /approv|done|complete|deliver/i.test(`${stage.name} ${stage.slug}`) }))
      : [],
  };

  if (!version.target) return view;

  const { workspaceId, projectId, versionId } = version.target;
  const [comments, annotations, guestInvites] = await Promise.all([
    listReviewComments(workspaceId, projectId, versionId),
    listAnnotations(workspaceId, projectId, versionId),
    listGuestInvites(workspaceId, projectId),
  ]);

  return {
    ...view,
    notes: comments.ok ? nestNotes(comments.data) : [],
    annotations: annotations.ok ? annotations.data : [],
    // A 403 on the comment list means read access without comment rights.
    canComment: comments.ok,
    // A 403 here means review access without permission to share the project out.
    guestInvites: guestInvites.ok ? guestInvites.data : [],
    canManageGuests: guestInvites.ok,
    notice: comments.ok ? view.notice : `Comments unavailable: ${comments.error.detail}`,
  };
}

/**
 * Finds the tasks this media hangs off.
 *
 * Only tasks in the same project are scanned: a task attachment can technically be any
 * file in the workspace, but checking every task's attachments to render one breadcrumb is
 * not worth the request count.
 */
async function linkedTasks(workspaceId: string, projectId: string | null, fileId: string): Promise<LinkedTask[]> {
  if (!projectId) return [];
  const tasks = await listTasks(workspaceId);
  if (!tasks.ok) return [];
  const candidates = tasks.data.filter((task) => task.project_id === projectId);
  const scans = await Promise.all(candidates.map(async (task) => ({ task, attachments: await listTaskAttachments(workspaceId, task.id) })));
  return scans
    .filter(({ attachments }) => attachments.ok && attachments.data.some((item) => item.file.id === fileId))
    .map(({ task }) => ({ id: task.id, title: task.title, stageName: null }));
}
