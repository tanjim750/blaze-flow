/**
 * "Publish to project": turning a library file into a project review version.
 *
 * A library file has no `MediaVersion`, so the review page keeps its notes on the device
 * (see `review-local.ts`). Publishing creates the media version on the same `File` and
 * saves those notes as real comments, so these helpers do two pure jobs, both unit-tested:
 *
 * - `publishChoices` — which projects, folders and existing assets the dialog offers.
 * - `publishPayload` — the session's notes and drawings in the shape the API takes, plus
 *   the recordings that have to be uploaded as attachments once their comments exist.
 */
import type { AnnotationElement } from "./api";
import type { LocalAnnotation } from "./review-local";
import type { ReviewNote } from "./review-notes";
import type { MediaKind, ReviewAsset } from "./review-media";

export type PublishProject = { id: string; name: string; clientName: string | null };
export type PublishFolder = { id: string; name: string; projectId: string; parentId: string | null };
export type PublishAsset = { assetFileId: string; name: string; projectId: string; kind: MediaKind; label: string };

/** What the dialog can offer; null when this viewer or this file cannot be published. */
export type PublishOptions = {
  assetFileId: string;
  defaultProjectId: string | null;
  defaultFolderId: string | null;
  /** Only a file that is its own asset can join another one (the API refuses the rest). */
  canBeVersion: boolean;
  kind: MediaKind;
  projects: PublishProject[];
  folders: PublishFolder[];
  assets: PublishAsset[];
};

type ChoicesInput = {
  asset: ReviewAsset;
  assetFileId: string;
  assets: ReviewAsset[];
  projects: { id: string; name: string; client_team_id: string | null }[];
  clients: { id: string; name: string }[];
  folders: { id: string; name: string; project_id: string | null; parent_folder_id: string | null }[];
};

export function publishChoices({ asset, assetFileId, assets, projects, clients, folders }: ChoicesInput): PublishOptions {
  const clientName = new Map(clients.map((client) => [client.id, client.name]));
  return {
    assetFileId,
    defaultProjectId: asset.projectId,
    defaultFolderId: asset.folderId,
    canBeVersion: asset.versions.length === 1,
    kind: asset.kind,
    projects: projects
      .map((project) => ({ id: project.id, name: project.name, clientName: project.client_team_id ? clientName.get(project.client_team_id) ?? null : null }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    folders: folders.flatMap((folder) => folder.project_id ? [{ id: folder.id, name: folder.name, projectId: folder.project_id, parentId: folder.parent_folder_id }] : []),
    // Existing assets a cut could become the next version of: same kind, same project, a
    // library row to attach to, and not the file's own asset.
    assets: assets.flatMap((other) => {
      const newest = other.versions[other.versions.length - 1];
      if (other.key === asset.key || !other.projectId || !newest?.assetFileId || other.kind !== asset.kind) return [];
      return [{ assetFileId: newest.assetFileId, name: other.name, projectId: other.projectId, kind: other.kind, label: `${newest.label} → V${newest.number + 1}` }];
    }).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Folders of one project, parents before children, with their depth for indenting. */
export function folderOptions(folders: PublishFolder[], projectId: string | null): { id: string; name: string; depth: number }[] {
  if (!projectId) return [];
  const mine = folders.filter((folder) => folder.projectId === projectId);
  const out: { id: string; name: string; depth: number }[] = [];
  const known = new Set(mine.map((folder) => folder.id));
  const byName = (a: PublishFolder, b: PublishFolder) => a.name.localeCompare(b.name);
  const walk = (children: PublishFolder[], depth: number) => children.sort(byName).forEach((folder) => {
    out.push({ id: folder.id, name: folder.name, depth });
    walk(mine.filter((item) => item.parentId === folder.id), depth + 1);
  });
  // Roots are top-level folders, plus any whose parent this viewer cannot see.
  walk(mine.filter((folder) => !folder.parentId || !known.has(folder.parentId)), 0);
  return out;
}

export type PublishNote = {
  key: string; text: string; start_time_ms: number | null; resolved: boolean;
  /** The out point of an in/out range note. */
  end_time_ms: number | null;
  /** How long the note's drawing stays on screen (its annotation's end). */
  annotation_end_time_ms: number | null;
  mentioned_user_ids: string[]; elements: AnnotationElement[];
  replies: { key: string; text: string; mentioned_user_ids: string[] }[];
};
export type PublishRecording = { key: string; url: string; mimeType: string; kind: "voice" | "screen" };
export type PublishPayload = {
  notes: PublishNote[];
  annotations: { start_time_ms: number | null; end_time_ms: number | null; elements: AnnotationElement[] }[];
  recordings: PublishRecording[];
};

/** Drawn elements without their local ids: the server assigns its own. */
const element = ({ element_type, geometry, style, payload }: AnnotationElement): AnnotationElement => ({ element_type, geometry, style: style ?? {}, payload: payload ?? {} });

/** A recording-only note still needs text on the server; this is what the composer posts too. */
const textFor = (note: ReviewNote) => note.text.trim() || (note.recording?.kind === "voice" ? "Voice comment" : note.recording ? "Screen recording" : "");

export function publishPayload(local: { notes: ReviewNote[]; annotations: LocalAnnotation[] }): PublishPayload {
  const recordings: PublishRecording[] = [];
  const keep = (note: ReviewNote) => {
    if (note.recording) recordings.push({ key: note.id, ...note.recording });
  };
  const notes = local.notes.flatMap((note): PublishNote[] => {
    const text = textFor(note);
    if (!text) return [];
    keep(note);
    const drawings = local.annotations.filter((item) => item.review_comment_id === note.id);
    const until = drawings.find((item) => item.end_time_ms !== null)?.end_time_ms ?? null;
    return [{
      key: note.id,
      text,
      start_time_ms: note.startMs,
      end_time_ms: note.startMs !== null && note.endMs != null && note.endMs > note.startMs ? note.endMs : null,
      annotation_end_time_ms: note.startMs !== null && until !== null && until >= note.startMs ? until : null,
      resolved: note.resolved,
      mentioned_user_ids: note.mentions.map((mention) => mention.id),
      elements: drawings.flatMap((item) => item.elements.map(element)),
      replies: note.replies.flatMap((reply) => {
        const replyText = textFor(reply);
        if (!replyText) return [];
        keep(reply);
        return [{ key: reply.id, text: replyText, mentioned_user_ids: reply.mentions.map((mention) => mention.id) }];
      }),
    }];
  });
  const annotations = local.annotations
    .filter((item) => !item.review_comment_id && item.elements.length)
    .map((item) => ({
      start_time_ms: item.start_time_ms,
      end_time_ms: item.start_time_ms !== null && item.end_time_ms !== null && item.end_time_ms >= item.start_time_ms ? item.end_time_ms : null,
      elements: item.elements.map(element),
    }));
  return { notes, annotations, recordings };
}

/** "3 notes and 1 drawing", for the dialog and the success toast. */
export function carriedSummary(payload: Pick<PublishPayload, "notes" | "annotations">): string | null {
  const notes = payload.notes.reduce((total, note) => total + 1 + note.replies.length, 0);
  const drawings = payload.annotations.length;
  const parts = [notes && `${notes} note${notes === 1 ? "" : "s"}`, drawings && `${drawings} drawing${drawings === 1 ? "" : "s"}`].filter(Boolean);
  return parts.length ? parts.join(" and ") : null;
}
