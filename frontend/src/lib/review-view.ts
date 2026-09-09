import { listAnnotations, listGuestInvites, listMediaVersions, listProjects, listReviewComments, listWorkflowStages, listWorkspaces } from "./api";
import type { Annotation, GuestInvite, MediaVersion } from "./api";
import { nestNotes, type ReviewNote } from "./review-notes";
import { selectWorkspace } from "./workspace";

/** One selectable cut in the version rail. */
export type VersionOption = { id: string; label: string; title: string; stage: string; selected: boolean };

export type { ReviewNote } from "./review-notes";
export { nestNotes } from "./review-notes";

export type ReviewView = {
  workspaceId: string | null;
  projectId: string | null;
  projectName: string;
  version: MediaVersion | null;
  versions: VersionOption[];
  notes: ReviewNote[];
  /** Streams the H.264 proxy through the Next rewrite; null when there is no media. */
  previewSrc: string | null;
  canComment: boolean;
  stages: { id: string; name: string; isApproval: boolean }[];
  annotations: Annotation[];
  /** Client review links for this project, empty when the viewer cannot manage them. */
  guestInvites: GuestInvite[];
  /** False when the invite list came back 403 — read access without share rights. */
  canManageGuests: boolean;
  /** Non-null when the API could not supply the page and demo content is shown instead. */
  notice: string | null;
};

const describe = (status: number, detail: string) =>
  status === 0
    ? `${detail} Showing demo content until the API is running.`
    : `The API returned ${status}: ${detail}. Showing demo content.`;

/**
 * Loads the review workspace: a project's media versions, the selected cut, and its
 * comments.
 *
 * Selection falls back left to right — the requested version, else the newest cut in the
 * requested project, else the first project that actually has media. That last step
 * matters because most projects in a workspace have no uploads, and landing on an empty
 * viewer looks broken.
 */
export async function loadReviewView(params: { projectId?: string; versionId?: string }): Promise<ReviewView> {
  const workspaces = await listWorkspaces();
  if (!workspaces.ok) return demoView(describe(workspaces.error.status, workspaces.error.detail));
  const workspace = await selectWorkspace(workspaces.data);
  if (!workspace) return demoView("This account has no workspace yet, so demo content is shown.");

  const projects = await listProjects(workspace.id);
  if (!projects.ok) return demoView(describe(projects.error.status, projects.error.detail));
  if (!projects.data.length) return { ...EMPTY_VIEW, workspaceId: workspace.id };

  const requested = projects.data.find((project) => project.id === params.projectId);
  const candidates = requested ? [requested] : projects.data;

  for (const project of candidates) {
    const media = await listMediaVersions(workspace.id, project.id);
    if (!media.ok) continue;
    if (!media.data.length) continue;

    // The list arrives oldest-first; the newest cut is the one worth opening on.
    const ordered = [...media.data].reverse();
    const version = ordered.find((item) => item.id === params.versionId) ?? ordered[0];
    const [comments, stages, annotations, guestInvites] = await Promise.all([
      listReviewComments(workspace.id, project.id, version.id),
      listWorkflowStages(workspace.id),
      listAnnotations(workspace.id, project.id, version.id),
      listGuestInvites(workspace.id, project.id),
    ]);

    return {
      workspaceId: workspace.id,
      projectId: project.id,
      projectName: project.name,
      version,
      versions: ordered.map((item) => ({
        id: item.id,
        label: `V${item.version_number}`,
        title: item.title,
        stage: item.current_stage?.name ?? item.status.replace(/_/g, " ").toLowerCase(),
        selected: item.id === version.id,
      })),
      notes: comments.ok ? nestNotes(comments.data) : [],
      previewSrc: `/api/workspaces/${workspace.id}/projects/${project.id}/media-versions/${version.id}/preview/`,
      // A 403 on the comment list means read access without comment rights.
      canComment: comments.ok,
      stages: stages.ok ? stages.data.map((stage) => ({
        id: stage.id, name: stage.name,
        isApproval: /approv|done|complete|deliver/i.test(`${stage.name} ${stage.slug}`),
      })) : [],
      annotations: annotations.ok ? annotations.data : [],
      // A 403 here means review access without permission to share the project out.
      guestInvites: guestInvites.ok ? guestInvites.data : [],
      canManageGuests: guestInvites.ok,
      notice: comments.ok ? null : `Comments unavailable: ${comments.error.detail}`,
    };
  }

  return { ...EMPTY_VIEW, workspaceId: workspace.id, projectName: candidates[0]?.name ?? "" };
}

/** Nothing uploaded yet — a real, signed-in, empty state rather than a failure. */
const EMPTY_VIEW: ReviewView = {
  workspaceId: null, projectId: null, projectName: "", version: null, versions: [],
  notes: [], previewSrc: null, canComment: false, notice: null,
  stages: [],
  annotations: [],
  guestInvites: [],
  canManageGuests: false,
};

/** Content from the Stitch reference, used only when the API cannot answer. */
function demoView(notice: string): ReviewView {
  return {
    workspaceId: null,
    projectId: null,
    projectName: "Aurora campaign",
    version: null,
    versions: [
      { id: "d3", label: "V4", title: "Hero film V4", stage: "In Review", selected: true },
      { id: "d2", label: "V3", title: "Hero film V3", stage: "Revisions", selected: false },
      { id: "d1", label: "V2", title: "Hero film V2", stage: "Approved", selected: false },
    ],
    notes: [
      { id: "d1", author: "Aaron Jackson", authorId: null, guestSessionId: null, initials: "AJ", timecode: "00:08", startMs: 8000, text: "Push the cyan and magenta contrast slightly on the wet street.", age: "12m ago", resolved: false, reactions: [], attachments: [], replies: [] },
      { id: "d2", author: "Sarah Lin", authorId: null, guestSessionId: null, initials: "SL", timecode: "00:19", startMs: 19000, text: "The pacing feels right with the revised music edit.", age: "40m ago", resolved: false, reactions: [], attachments: [], replies: [] },
      { id: "d3", author: "Elena Rostova", authorId: null, guestSessionId: null, initials: "ER", timecode: "00:26", startMs: 26000, text: "Check the low-end hit when the title lands.", age: "1h ago", resolved: true, reactions: [], attachments: [], replies: [] },
    ],
    previewSrc: null,
    canComment: false,
    stages: [],
    annotations: [],
    guestInvites: [],
    canManageGuests: false,
    notice,
  };
}
