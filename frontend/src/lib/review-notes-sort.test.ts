import { describe, expect, it } from "vitest";
import { sortNotes, type ReviewNote } from "./review-notes";

const note = (id: string, author: string, startMs: number | null, createdAt: string, resolved = false) =>
  ({ id, author, startMs, createdAt, resolved } as unknown as ReviewNote);

const notes = [note("a", "Zoe", 5000, "2026-10-02T10:00:00Z"), note("b", "Ada", 1000, "2026-10-03T10:00:00Z", true), note("c", "Mo", null, "2026-10-01T10:00:00Z")];
const ids = (list: ReviewNote[]) => list.map((item) => item.id);

describe("sortNotes", () => {
  it("orders by timecode with general notes last", () => expect(ids(sortNotes(notes, "timecode"))).toEqual(["b", "a", "c"]));
  it("orders by posted time", () => {
    expect(ids(sortNotes(notes, "oldest"))).toEqual(["c", "a", "b"]);
    expect(ids(sortNotes(notes, "newest"))).toEqual(["b", "a", "c"]);
  });
  it("orders by commenter", () => expect(ids(sortNotes(notes, "commenter"))).toEqual(["b", "c", "a"]));
  it("puts completed notes after open ones", () => expect(ids(sortNotes(notes, "completed"))).toEqual(["a", "c", "b"]));
  it("does not mutate its input", () => { sortNotes(notes, "newest"); expect(ids(notes)).toEqual(["a", "b", "c"]); });
});
