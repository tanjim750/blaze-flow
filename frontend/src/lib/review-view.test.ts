import { describe, expect, it, vi } from "vitest";
import type { ReviewComment } from "./api";
import { nestNotes, taskContextFrom } from "./review-view";
import type { ReviewAsset } from "./review-media";

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


describe("taskContextFrom", () => {
  const version = (id: string, label: string) => ({ id, label, number: 1, title: `${id}.mp4`, createdAt: "", sizeBytes: 1, mimeType: "video/mp4", src: null, stageName: null, target: null, assetFileId: null, uploadedBy: null, allowDownload: null, workflowStage: null });
  const assets = [{ key: "a", assetId: null, name: "Hero", kind: "video", clientId: null, clientName: null, projectId: "p", projectName: "Spring", folderId: null, folderName: null, stage: null, versions: [version("f1", "V1"), version("f2", "V2")] }] as ReviewAsset[];
  const task = { id: "t", workspace_id: "w", client_team_id: null, project_id: "p", task_stage_id: null, title: "Cut hero", description: null, status: "TODO", priority: "HIGH", start_at: null, due_at: null, completed_at: null, sort_order: 0, created_at: "", updated_at: "", assignees: [] };

  it("lists the linked files this viewer can open, and says whether the one on screen is linked", () => {
    const context = taskContextFrom({ ...task, attachment_file_ids: ["f2", "hidden", "f1"] }, assets, "f2", [{ id: "p", name: "Spring", client_team_id: "c" }]);
    expect(context.linkedFiles.map((file) => file.fileId)).toEqual(["f2", "f1"]);
    expect(context.onScreenIsLinked).toBe(true);
    expect(context.clientId).toBe("c");
    expect(context.projectName).toBe("Spring");
  });

  it("flags a cut that is not linked to the task", () => {
    const context = taskContextFrom({ ...task, attachment_file_ids: ["f1"] }, assets, "f2");
    expect(context.onScreenIsLinked).toBe(false);
    expect(context.clientId).toBeNull();
  });
});
