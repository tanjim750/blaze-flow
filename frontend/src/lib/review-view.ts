import { listMediaVersions, listProjects, listReviewComments, listWorkspaces } from "./api";
import type { MediaVersion, ReviewComment } from "./api";
import { timecode } from "./timecode";

/** One selectable cut in the version rail. */
export type VersionOption = { id: string; label: string; title: string; stage: string; selected: boolean };

/** A comment as the review sidebar renders it, flattened from the API's parent/child rows. */
export type ReviewNote = {
  id: string;
  author: string;
  initials: string;
  /** `mm:ss` when the note is pinned to a timecode, else null for a general note. */
  timecode: string | null;
  startMs: number | null;
  text: string;
  age: string;
  resolved: boolean;
  replies: ReviewNote[];
};

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
  /** Non-null when the API could not supply the page and demo content is shown instead. */
  notice: string | null;
};

function relativeAge(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";
  return `${first}${last}`.toUpperCase();
}

function toNote(comment: ReviewComment): ReviewNote {
  const name = comment.author?.name?.trim() || comment.author?.email || "Unknown";
  return {
    id: comment.id,
    author: name,
    initials: initialsFrom(name),
    timecode: comment.start_time_ms === null ? null : timecode(comment.start_time_ms),
    startMs: comment.start_time_ms,
    text: comment.text ?? "",
    age: relativeAge(comment.created_at),
    resolved: comment.resolved,
    replies: [],
  };
}

/**
 * Nests replies under their parent. The API returns one flat list ordered by
 * `created_at`, and a reply's `parent_comment_id` always refers to a comment on the same
 * media version, so a single pass is enough. A reply whose parent is missing (resolved
 * away or deleted) is promoted to a top-level note rather than dropped.
 */
export function nestNotes(comments: ReviewComment[]): ReviewNote[] {
  const notes = new Map<string, ReviewNote>();
  for (const comment of comments) notes.set(comment.id, toNote(comment));
  const roots: ReviewNote[] = [];
  for (const comment of comments) {
    const note = notes.get(comment.id)!;
    const parent = comment.parent_comment_id ? notes.get(comment.parent_comment_id) : undefined;
    if (parent) parent.replies.push(note);
    else roots.push(note);
  }
  return roots;
}

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
  const workspace = workspaces.data[0];
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
    const comments = await listReviewComments(workspace.id, project.id, version.id);

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
      notice: comments.ok ? null : `Comments unavailable: ${comments.error.detail}`,
    };
  }

  return { ...EMPTY_VIEW, workspaceId: workspace.id, projectName: candidates[0]?.name ?? "" };
}

/** Nothing uploaded yet — a real, signed-in, empty state rather than a failure. */
const EMPTY_VIEW: ReviewView = {
  workspaceId: null, projectId: null, projectName: "", version: null, versions: [],
  notes: [], previewSrc: null, canComment: false, notice: null,
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
      { id: "d1", author: "Aaron Jackson", initials: "AJ", timecode: "00:08", startMs: 8000, text: "Push the cyan and magenta contrast slightly on the wet street.", age: "12m ago", resolved: false, replies: [] },
      { id: "d2", author: "Sarah Lin", initials: "SL", timecode: "00:19", startMs: 19000, text: "The pacing feels right with the revised music edit.", age: "40m ago", resolved: false, replies: [] },
      { id: "d3", author: "Elena Rostova", initials: "ER", timecode: "00:26", startMs: 26000, text: "Check the low-end hit when the title lands.", age: "1h ago", resolved: true, replies: [] },
    ],
    previewSrc: null,
    canComment: false,
    notice,
  };
}
