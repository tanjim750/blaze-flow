import { describe, expect, it } from "vitest";
import { DEFAULT_FILTER, activeFilters, filterCounts, filterNotes } from "./review-filters";
import type { ReviewNote } from "./review-notes";

const note = (id: string, extra: Partial<ReviewNote> = {}): ReviewNote => ({
  id, author: "A", authorId: "u1", guestSessionId: null, initials: "A", timecode: null, startMs: null,
  text: "", age: "", resolved: false, reactions: [], attachments: [], mentions: [], replies: [], ...extra,
} as ReviewNote);

const ctx = { viewerId: "u1", teamIds: new Set(["u1", "u2"]) };
const notes = [
  note("a", { text: "Fix the logo" }),
  note("b", { authorId: "u2", resolved: true, replies: [note("r", { text: "colour grade" })] }),
  note("c", { authorId: null, guestSessionId: "g", drawing: {} as never }),
];

describe("comment filters", () => {
  it("filters by status, author, side and drawings", () => {
    const ids = (f: Partial<typeof DEFAULT_FILTER>) => filterNotes(notes, { ...DEFAULT_FILTER, ...f }, ctx).map((n) => n.id);
    expect(ids({ status: "open" })).toEqual(["a", "c"]);
    expect(ids({ status: "resolved" })).toEqual(["b"]);
    expect(ids({ mine: true })).toEqual(["a", "b"]);
    expect(ids({ side: "client" })).toEqual(["c"]);
    expect(ids({ drawings: true })).toEqual(["c"]);
  });
  it("search matches replies and ignores case", () => {
    expect(filterNotes(notes, { ...DEFAULT_FILTER, query: "COLOUR" }, ctx).map((n) => n.id)).toEqual(["b"]);
  });
  it("counts and active count agree", () => {
    expect(filterCounts(notes, DEFAULT_FILTER, ctx)).toMatchObject({ all: 3, open: 2, resolved: 1, team: 2, client: 1 });
    expect(activeFilters({ ...DEFAULT_FILTER, mine: true, query: "x" })).toBe(2);
  });
});
