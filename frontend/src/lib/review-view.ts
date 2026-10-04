import { listAnnotations, listGuestInvites, listMediaDecisions, listReviewComments, listTaskAttachments, listTasks, listWorkflowStages, listWorkspaceMembers } from "./api";
import type { Annotation, DashboardRole, GuestInvite, TaskStage } from "./api";
import { NO_DECISIONS, type DecisionViewer, type ReviewDecision } from "./review-decisions";
import { nestNotes, type ReviewNote } from "./review-notes";
import { normalizeSpecs, specChips, type DeliverableSpecs } from "./project-brief";
import { approvalStageId } from "./review-stages";
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
  /** "client" when the viewer is in the workspace only through a client team. */
  role: DashboardRole | null;
  /** Client decisions recorded on the cut on screen, newest first (the proof of delivery). */
  decisions: ReviewDecision[];
  /** Which decision buttons the viewer may use; nothing until the API says so. */
  decisionViewer: DecisionViewer;
  /**
   * The second cut, when the page is comparing two. Its notes are loaded separately and
   * kept separately: the whole point of comparing is seeing which feedback belongs to
   * which version, so they are never merged into one list.
   */
  comparison: { version: ReviewVersion; notes: ReviewNote[]; annotations: Annotation[] } | null;
  /** The project's deliverable specs, when it has any, for the header's mismatch chip. */
  specs: DeliverableSpecs | null;
  notice: string | null;
};

const EMPTY: ReviewView = {
  workspaceId: null, asset: null, version: null, target: null, notes: [], annotations: [],
  stages: [], taskStages: [], linkedTasks: [], members: [], guestInvites: [],
  canManageGuests: false, canComment: false, comparison: null, specs: null, notice: null,
  role: null, decisions: [], decisionViewer: NO_DECISIONS,
};

/**
 * Loads the review workspace for one cut.
 *
 * Selection is by `File` id (`?media=`), which is what every entry point links with — see
 * `review-media.ts`. `?project=` and `?version=` are still honoured so that links made
 * before this feature, and the ones the dashboard still builds, keep working.
 */
export async function loadReviewView(params: { mediaId?: string; projectId?: string; versionId?: string; compareId?: string }): Promise<ReviewView> {
  const catalogue = await loadMediaCatalogue();
  if (!catalogue.workspaceId) return { ...EMPTY, notice: catalogue.notice };
  const client = catalogue.role === "client";

  const found =
    locate(catalogue.assets, params.mediaId)
    ?? locateByTarget(catalogue.assets, params.projectId, params.versionId)
    ?? defaultSelection(catalogue.assets);

  const base: ReviewView = {
    ...EMPTY,
    workspaceId: catalogue.workspaceId,
    role: catalogue.role,
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
    // Tasks are the studio's internal board: a client-team member cannot read them.
    linkedTasks: client ? [] : await linkedTasks(catalogue.workspaceId, asset.projectId, version.id),
    members: members.ok
      ? members.data.flatMap((row) => row.user ? [{ id: row.user.id, name: `${row.user.first_name} ${row.user.last_name}`.trim() || row.user.email, email: row.user.email }] : [])
      : [],
    stages: stages.ok ? withApproval(stages.data) : [],
    specs: projectSpecs(catalogue.projects.find((project) => project.id === asset.projectId)?.deliverable_specs),
  };

  const comparison = params.compareId
    ? asset.versions.find((item) => item.id === params.compareId && item.id !== version.id) ?? null
    : null;
  const comparisonData = comparison ? await loadVersionReview(comparison) : null;
  const withComparison: ReviewView = comparison && comparisonData
    ? { ...view, comparison: { version: comparison, ...comparisonData } }
    : view;

  if (!version.target) return withComparison;

  const { workspaceId, projectId, versionId } = version.target;
  const [comments, annotations, guestInvites, decisions] = await Promise.all([
    listReviewComments(workspaceId, projectId, versionId),
    listAnnotations(workspaceId, projectId, versionId),
    // Sharing links out is a studio job; clients are never offered the share panel.
    client ? null : listGuestInvites(workspaceId, projectId),
    listMediaDecisions(workspaceId, projectId, versionId),
  ]);

  return {
    ...withComparison,
    notes: comments.ok ? nestNotes(comments.data) : [],
    annotations: annotations.ok ? annotations.data : [],
    // A 403 on the comment list means read access without comment rights.
    canComment: comments.ok,
    // A 403 here means review access without permission to share the project out.
    guestInvites: guestInvites?.ok ? guestInvites.data : [],
    canManageGuests: Boolean(guestInvites?.ok),
    decisions: decisions.ok ? decisions.data.results : [],
    // If the decisions call itself fails, team members keep the buttons they always had
    // (the server still checks); client members get none.
    decisionViewer: decisions.ok ? decisions.data.viewer
      : client ? { ...NO_DECISIONS, kind: "client" } : { ...NO_DECISIONS, can_transition: true, can_request_changes: true },
    // A 403 on comments is "read access without comment rights", not an error worth a banner.
    notice: comments.ok || comments.error.status === 403 ? view.notice : `Comments unavailable: ${comments.error.detail}`,
  };
}

/** Marks exactly one stage — the one Approve moves the cut into — as the approval target. */
function withApproval(stages: { id: string; name: string; slug: string }[]): ReviewView["stages"] {
  const approvedId = approvalStageId(stages);
  return stages.map((stage) => ({ id: stage.id, name: stage.name, isApproval: stage.id === approvedId }));
}

/**
 * Loads one cut's review data.
 *
 * A cut with no project media version has no server-side notes at all — those live on the
 * device — so this returns empty rather than pretending otherwise.
 */
async function loadVersionReview(version: ReviewVersion): Promise<{ notes: ReviewNote[]; annotations: Annotation[] }> {
  if (!version.target) return { notes: [], annotations: [] };
  const { workspaceId, projectId, versionId } = version.target;
  const [comments, annotations] = await Promise.all([
    listReviewComments(workspaceId, projectId, versionId),
    listAnnotations(workspaceId, projectId, versionId),
  ]);
  return {
    notes: comments.ok ? nestNotes(comments.data) : [],
    annotations: annotations.ok ? annotations.data : [],
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

function projectSpecs(raw: unknown): DeliverableSpecs | null {
  const specs = normalizeSpecs(raw);
  return specChips(specs).length ? specs : null;
}

/** `?t=` from a deep link: whole non-negative milliseconds, else null. */
export function timeParam(raw: string | undefined): number | null {
  if (!raw || !/^\d{1,10}$/.test(raw)) return null;
  return Number(raw);
}
