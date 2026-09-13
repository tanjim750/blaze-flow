import type { ReviewComment } from "./api";
import { timecode } from "./timecode";

/**
 * Comment shaping shared by the signed-in review workspace and the guest reviewer.
 *
 * Like `lib/timecode`, this stays free of any runtime import from `lib/api` — that module
 * reaches for `next/headers` and cannot be bundled for the browser. The `ReviewComment`
 * import here is `import type`, which is erased at compile time, so the guest page can
 * use these helpers client-side while the server loader uses the same code.
 */

/** A comment as the review sidebar renders it, flattened from the API's parent/child rows. */
export type ReviewNote = {
  id: string;
  author: string;
  authorId: string | null;
  /** The guest session that wrote the note, when a guest did; null for a workspace user. */
  guestSessionId: string | null;
  initials: string;
  /** `mm:ss` when the note is pinned to a timecode, else null for a general note. */
  timecode: string | null;
  startMs: number | null;
  text: string;
  age: string;
  resolved: boolean;
  reactions: { emoji: string; count: number }[];
  /** `mimeType` is what decides whether an attachment plays inline or offers a download. */
  attachments: { id: string; name: string; status: string; mimeType: string }[];
  mentions: { id: string; name: string }[];
  replies: ReviewNote[];
  /** Set on notes held on the device because their media has no project review record. */
  local?: boolean;
  /** A voice or screen recording carried by this note, resolved from its attachment. */
  recording?: { url: string; mimeType: string; kind: "voice" | "screen" } | null;
};

/** Recordings are ordinary attachments; their mime type is the only thing marking them. */
export function recordingOf(note: Pick<ReviewNote, "attachments">, urlFor: (id: string) => string) {
  const media = note.attachments.find(
    (item) => item.status === "READY" && (item.mimeType.startsWith("audio/") || item.mimeType.startsWith("video/")),
  );
  if (!media) return null;
  return { url: urlFor(media.id), mimeType: media.mimeType, kind: media.mimeType.startsWith("audio/") ? "voice" as const : "screen" as const };
}

export function relativeAge(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";
  return `${first}${last}`.toUpperCase();
}

export function toNote(comment: ReviewComment): ReviewNote {
  const name = comment.author?.name?.trim() || comment.author?.email || "Unknown";
  return {
    id: comment.id,
    author: name,
    authorId: comment.author?.type === "user" ? comment.author.id : null,
    guestSessionId: comment.author?.type === "guest" ? comment.author.id : null,
    initials: initialsFrom(name),
    timecode: comment.start_time_ms === null ? null : timecode(comment.start_time_ms),
    startMs: comment.start_time_ms,
    text: comment.text ?? "",
    age: relativeAge(comment.created_at),
    resolved: comment.resolved,
    reactions: comment.reactions?.map(({ emoji, count }) => ({ emoji, count })) ?? [],
    attachments: comment.attachments?.map((item) => ({ id: item.id, name: item.file.name, status: item.file.status, mimeType: item.file.mime_type })) ?? [],
    mentions: comment.mentions?.map((item) => ({ id: item.id, name: item.name })) ?? [],
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
