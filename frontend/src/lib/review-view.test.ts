import { describe, expect, it, vi } from "vitest";
import type { ReviewComment } from "./api";
import { nestNotes } from "./review-view";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const comment = (id: string, parent: string | null): ReviewComment => ({
  id, parent_comment_id: parent, author: { id: "u", email: "ada@example.com", name: "Ada Lovelace", type: "user" },
  text: id, start_time_ms: null, end_time_ms: null, resolved: false,
  resolved_by_user_id: null, resolved_at: null, revision_count: 0,
  reactions: [], attachments: [],
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
});

describe("nestNotes", () => {
  it("nests replies and promotes replies with unavailable parents", () => {
    const notes = nestNotes([comment("root", null), comment("reply", "root"), comment("orphan", "missing")]);
    expect(notes.map((note) => note.id)).toEqual(["root", "orphan"]);
    expect(notes[0].replies[0].id).toBe("reply");
  });
});
