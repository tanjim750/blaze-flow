import type { ReviewNote } from "./review-notes";

/**
 * Comment writes shown before the server confirms them.
 *
 * Every write still goes to the API and the page still refreshes from it; this overlay only
 * covers the gap. Each entry is dropped by `pruneOverlay` once the server's own notes say
 * the same thing (so there is no flicker back to the old state while the refresh lands),
 * and by the writer straight away if the request fails, which is the rollback.
 */

export type PendingNote = {
  /** Temporary id the optimistic row renders under. */
  tempId: string;
  /** The real id, once the POST has answered; the entry goes when that note arrives. */
  serverId: string | null;
  parentId: string | null;
  note: ReviewNote;
};

export type Overlay = {
  added: PendingNote[];
  /** Note id → new text. */
  edits: Record<string, string>;
  /** Note id → resolved state. */
  resolved: Record<string, boolean>;
  /** Note ids being deleted. */
  deleted: string[];
  /** Annotation id → the drawing's new end (start itself for frame-only). */
  windows: Record<string, number>;
};

export const EMPTY_OVERLAY: Overlay = { added: [], edits: {}, resolved: {}, deleted: [], windows: {} };

const isEmpty = (overlay: Overlay) =>
  !overlay.added.length && !overlay.deleted.length
  && !Object.keys(overlay.edits).length && !Object.keys(overlay.resolved).length && !Object.keys(overlay.windows).length;

function patch(note: ReviewNote, overlay: Overlay, deleted: ReadonlySet<string>): ReviewNote {
  const text = overlay.edits[note.id];
  const resolved = overlay.resolved[note.id];
  const replies = note.replies.filter((reply) => !deleted.has(reply.id)).map((reply) => patch(reply, overlay, deleted));
  const pendingReplies = overlay.added
    .filter((entry) => entry.parentId === note.id && !(entry.serverId && note.replies.some((reply) => reply.id === entry.serverId)))
    .map((entry) => entry.note);
  return {
    ...note,
    ...(text !== undefined ? { text, edited: true } : {}),
    ...(resolved !== undefined ? { resolved } : {}),
    replies: pendingReplies.length ? [...replies, ...pendingReplies] : replies,
  };
}

/** The notes as they will be once every write in flight has landed. */
export function applyOverlay(notes: ReviewNote[], overlay: Overlay): ReviewNote[] {
  if (isEmpty(overlay)) return notes;
  const deleted = new Set(overlay.deleted);
  const known = new Set(notes.flatMap((note) => [note.id, ...note.replies.map((reply) => reply.id)]));
  const roots = notes.filter((note) => !deleted.has(note.id)).map((note) => patch(note, overlay, deleted));
  const pendingRoots = overlay.added
    .filter((entry) => !entry.parentId && !(entry.serverId && known.has(entry.serverId)))
    .map((entry) => entry.note);
  return [...roots, ...pendingRoots];
}

function find(notes: ReviewNote[], id: string): ReviewNote | null {
  for (const note of notes) {
    if (note.id === id) return note;
    const reply = note.replies.find((item) => item.id === id);
    if (reply) return reply;
  }
  return null;
}

/**
 * Drops the entries the server's notes already reflect. `annotationEnds` is the server's
 * end per annotation id, for the drawing-duration entries.
 */
export function pruneOverlay(overlay: Overlay, notes: ReviewNote[], annotationEnds: ReadonlyMap<string, number | null> = new Map()): Overlay {
  if (isEmpty(overlay)) return overlay;
  const added = overlay.added.filter((entry) => !(entry.serverId && find(notes, entry.serverId)));
  const edits = Object.fromEntries(Object.entries(overlay.edits).filter(([id, text]) => {
    const note = find(notes, id);
    return note !== null && note.text !== text;
  }));
  const resolved = Object.fromEntries(Object.entries(overlay.resolved).filter(([id, value]) => {
    const note = find(notes, id);
    return note !== null && note.resolved !== value;
  }));
  const deleted = overlay.deleted.filter((id) => find(notes, id) !== null);
  const windows = Object.fromEntries(Object.entries(overlay.windows).filter(([id, end]) => annotationEnds.has(id) && annotationEnds.get(id) !== end));
  const next = { added, edits, resolved, deleted, windows };
  const same = added.length === overlay.added.length && deleted.length === overlay.deleted.length
    && Object.keys(edits).length === Object.keys(overlay.edits).length
    && Object.keys(resolved).length === Object.keys(overlay.resolved).length
    && Object.keys(windows).length === Object.keys(overlay.windows).length;
  return same ? overlay : next;
}

/** Removes one entry: the rollback when its request fails. */
export function dropEntry(overlay: Overlay, kind: "added" | "edits" | "resolved" | "deleted" | "windows", id: string): Overlay {
  if (kind === "added") return { ...overlay, added: overlay.added.filter((entry) => entry.tempId !== id) };
  if (kind === "deleted") return { ...overlay, deleted: overlay.deleted.filter((item) => item !== id) };
  const { [id]: _gone, ...rest } = overlay[kind];
  void _gone;
  return { ...overlay, [kind]: rest };
}
