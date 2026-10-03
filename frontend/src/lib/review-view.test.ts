import { describe, expect, it, vi } from "vitest";
import type { ReviewComment } from "./api";
import { nestNotes } from "./review-view";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const comment = (id: string, parent: string | null): ReviewComment => ({
  id, parent_comment_id: parent, author: { id: "u", email: "ada@example.com", name: "Ada Lovelace", type: "user" },
  text: id, start_time_ms: null, end_time_ms: null, resolved: false,
  resolved_by_user_id: null, resolved_at: null, revision_count: 0,
  reactions: [], attachments: [], mentions: [],
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
});

describe("nestNotes", () => {
  it("nests replies and promotes replies with unavailable parents", () => {
    const notes = nestNotes([comment("root", null), comment("reply", "root"), comment("orphan", "missing")]);
    expect(notes.map((note) => note.id)).toEqual(["root", "orphan"]);
    expect(notes[0].replies[0].id).toBe("reply");
  });
});

describe("clientView", () => {
  it("drops team notes and team replies, keeping client threads", async () => {
    const { clientView } = await import("./review-notes");
    const note = (id: string, visibility: "team" | "client", replies: unknown[] = []) =>
      ({ id, visibility, replies } as unknown as import("./review-notes").ReviewNote);
    const shown = clientView([
      note("a", "client", [note("a1", "team"), note("a2", "client")]),
      note("b", "team", [note("b1", "team")]),
      { ...note("c", "client"), visibility: undefined } as unknown as import("./review-notes").ReviewNote,
    ]);
    expect(shown.map((item) => item.id)).toEqual(["a", "c"]);
    expect(shown[0].replies.map((item) => item.id)).toEqual(["a2"]);
  });
});
