import type { AnnotationElement, CommentVisibility } from "./api";

/**
 * Unsent review comments, kept per cut in `localStorage`.
 *
 * A half-written note is the most expensive thing on the review page to lose: it is the
 * reviewer's own thinking, pinned to a moment they had to find. So the composer writes
 * its state here as it changes and reads it back when the same cut opens again, whether
 * that is after a reload, a tab close, switching to the Fields tab or opening another
 * version and coming back.
 *
 * Keyed by the `File` id the review page is addressed by, so V2's draft never appears on
 * V3. Recordings are deliberately not stored: a blob URL does not survive a reload, and
 * base64-ing a screen recording into `localStorage` would blow its quota. The page warns
 * before leaving with one attached instead.
 */
export type ReviewDraft = {
  text: string;
  pinned: boolean;
  /** Player position when composing started, so a restored note pins where it was meant to. */
  anchorMs: number | null;
  replyToId: string | null;
  visibility: CommentVisibility;
  mentions: { id: string; name: string; email: string }[];
  annotation: AnnotationElement | null;
  savedAt: string;
};

const PREFIX = "bf.review.draft.v1.";
export const draftKey = (mediaId: string) => `${PREFIX}${mediaId}`;

export const EMPTY_DRAFT: Omit<ReviewDraft, "savedAt"> = {
  text: "", pinned: true, anchorMs: null, replyToId: null, visibility: "client", mentions: [], annotation: null,
};

/** A draft worth keeping: something the reviewer wrote or drew. Settings alone are not. */
export function hasContent(draft: Partial<ReviewDraft> | null | undefined): boolean {
  return Boolean(draft && ((draft.text ?? "").trim() || draft.annotation));
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Private mode or a disabled store: drafts simply are not kept.
    return null;
  }
}

export function loadDraft(mediaId: string | null): ReviewDraft | null {
  const store = storage();
  if (!store || !mediaId) return null;
  try {
    const raw = store.getItem(draftKey(mediaId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ReviewDraft>;
    if (!hasContent(parsed)) return null;
    return {
      ...EMPTY_DRAFT,
      ...parsed,
      visibility: parsed.visibility === "team" ? "team" : "client",
      mentions: Array.isArray(parsed.mentions) ? parsed.mentions : [],
      savedAt: parsed.savedAt ?? new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Merges a change into the stored draft. The composer owns the text and the workspace owns
 * the drawing, so each writes only its own fields and neither clobbers the other.
 */
export function patchDraft(mediaId: string | null, patch: Partial<Omit<ReviewDraft, "savedAt">>, now = new Date()) {
  const store = storage();
  if (!store || !mediaId) return;
  const current = loadDraft(mediaId) ?? { ...EMPTY_DRAFT, savedAt: now.toISOString() };
  const next: ReviewDraft = { ...current, ...patch, savedAt: now.toISOString() };
  try {
    if (hasContent(next)) store.setItem(draftKey(mediaId), JSON.stringify(next));
    else store.removeItem(draftKey(mediaId));
  } catch {
    // Quota exceeded: keep working; the leave warning still protects the text.
  }
}

export function clearDraft(mediaId: string | null) {
  const store = storage();
  if (!store || !mediaId) return;
  try { store.removeItem(draftKey(mediaId)); } catch { /* nothing to clear */ }
}

/** What is unsaved right now, and so what leaving would cost. Null means nothing. */
export function unsavedWarning(state: {
  text: boolean; annotation: boolean; recording: boolean; revision: boolean; localNotes: number;
}): string | null {
  const parts: string[] = [];
  if (state.localNotes > 0) {
    parts.push(`${state.localNotes === 1 ? "1 note" : `${state.localNotes} notes`} on this file ${state.localNotes === 1 ? "is" : "are"} only kept for this session, because the file isn't published to a project yet. Leaving loses ${state.localNotes === 1 ? "it" : "them"}.`);
  }
  if (state.recording) parts.push("The recording attached to your comment hasn't been sent and can't be kept as a draft.");
  if (state.revision) parts.push("Your change request hasn't been sent.");
  if (state.text || state.annotation) {
    parts.push(`Your unsent ${state.text && state.annotation ? "comment and drawing are" : state.text ? "comment is" : "drawing is"} saved as a draft on this device, but hasn't been posted.`);
  }
  return parts.length ? parts.join(" ") : null;
}
