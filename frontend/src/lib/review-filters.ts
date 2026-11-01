import type { ReviewNote } from "./review-notes";

/**
 * Narrowing the comment feed: status, author, drawings and a text search.
 *
 * Pure so the counts on the chips and the list under them cannot disagree, and so the
 * rules are tested without rendering the panel. A thread matches when the note or any of
 * its replies does: a search for a word someone used in a reply should find the thread.
 */

export type NoteStatus = "all" | "open" | "resolved";
/** Who wrote it: the studio's own members, or the client side (client members and guests). */
export type NoteSide = "all" | "team" | "client";

export type NoteFilter = {
  status: NoteStatus;
  mine: boolean;
  drawings: boolean;
  side: NoteSide;
  query: string;
};

export const DEFAULT_FILTER: NoteFilter = { status: "all", mine: false, drawings: false, side: "all", query: "" };

export type FilterContext = {
  viewerId: string | null;
  /** Workspace member user ids. Anyone else (client members, guests) is on the client side. */
  teamIds: ReadonlySet<string>;
};

/** Device-local notes are always the viewer's own; project notes compare the author id. */
export function isMine(note: ReviewNote, viewerId: string | null): boolean {
  return Boolean(note.local || (viewerId && note.authorId === viewerId));
}

export function authorSide(note: ReviewNote, teamIds: ReadonlySet<string>): Exclude<NoteSide, "all"> {
  if (note.local) return "team";
  if (note.guestSessionId) return "client";
  return note.authorId && teamIds.has(note.authorId) ? "team" : "client";
}

export function hasDrawing(note: ReviewNote): boolean {
  return Boolean(note.drawingWindow || note.drawing);
}

const fold = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function matchesQuery(note: ReviewNote, query: string): boolean {
  const needle = fold(query.trim());
  if (!needle) return true;
  const own = [note.text, note.author, note.timecode ?? ""].some((part) => fold(part).includes(needle));
  return own || note.replies.some((reply) => matchesQuery(reply, query));
}

function threadAny(note: ReviewNote, test: (item: ReviewNote) => boolean): boolean {
  return test(note) || note.replies.some(test);
}

export function matchesFilter(note: ReviewNote, filter: NoteFilter, context: FilterContext): boolean {
  if (filter.status === "open" && note.resolved) return false;
  if (filter.status === "resolved" && !note.resolved) return false;
  if (filter.mine && !threadAny(note, (item) => isMine(item, context.viewerId))) return false;
  if (filter.drawings && !hasDrawing(note)) return false;
  if (filter.side !== "all" && authorSide(note, context.teamIds) !== filter.side) return false;
  return matchesQuery(note, filter.query);
}

export function filterNotes(notes: ReviewNote[], filter: NoteFilter, context: FilterContext): ReviewNote[] {
  return notes.filter((note) => matchesFilter(note, filter, context));
}

/** How many notes each chip would show, holding every other active filter as it is. */
export function filterCounts(notes: ReviewNote[], filter: NoteFilter, context: FilterContext) {
  const count = (change: Partial<NoteFilter>) => filterNotes(notes, { ...filter, ...change }, context).length;
  return {
    all: count({ status: "all" }),
    open: count({ status: "open" }),
    resolved: count({ status: "resolved" }),
    mine: count({ mine: true }),
    drawings: count({ drawings: true }),
    team: count({ side: "team" }),
    client: count({ side: "client" }),
  };
}

/** Filters narrowing the list beyond the default, for the "Clear filters" affordance. */
export function activeFilters(filter: NoteFilter): number {
  return Number(filter.status !== "all") + Number(filter.mine) + Number(filter.drawings) + Number(filter.side !== "all") + Number(Boolean(filter.query.trim()));
}
