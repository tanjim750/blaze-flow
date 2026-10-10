import { describe, expect, it } from "vitest";
import { carriedSummary, folderOptions, publishChoices, publishPayload } from "./publish";
import type { ReviewNote } from "./review-notes";
import type { LocalAnnotation } from "./review-local";
import type { ReviewAsset, ReviewVersion } from "./review-media";

const note = (id: string, extra: Partial<ReviewNote> = {}): ReviewNote => ({
  id, author: "Alex", authorId: null, guestSessionId: null, initials: "A", timecode: null, startMs: null, text: `note ${id}`, age: "now",
  resolved: false, reactions: [], attachments: [], mentions: [], replies: [], visibility: "client", local: true, recording: null, ...extra,
});
const drawing = (id: string, commentId: string | null, startMs: number | null = null): LocalAnnotation => ({
  id, review_comment_id: commentId, author_user_id: null, start_time_ms: startMs, end_time_ms: null,
  elements: [{ id: "el-1", element_type: "POINT", geometry: { x: 0.5, y: 0.5 }, style: {}, payload: {} }], revision_count: 0, created_at: "", updated_at: "",
});
const version = (id: string, number: number, assetFileId: string | null = `af-${id}`): ReviewVersion => ({
  id, label: `V${number}`, number, title: `${id}.mp4`, createdAt: "2026-10-01", sizeBytes: 1, mimeType: "video/mp4", src: null, stageName: null,
  target: null, assetFileId, uploadedBy: null, allowDownload: null, workflowStage: null,
});
const asset = (key: string, projectId: string | null, versions: ReviewVersion[], kind: ReviewAsset["kind"] = "video"): ReviewAsset => ({
  key, assetId: key, name: key, kind, clientId: null, clientName: null, projectId, projectName: null, folderId: projectId ? "f-1" : null, folderName: null, stage: null, versions,
});

describe("publishPayload", () => {
  it("turns session notes, replies, drawings and resolution into the API shape", () => {
    const payload = publishPayload({
      notes: [
        note("n1", { startMs: 1200, mentions: [{ id: "u-maya", name: "Maya" }], replies: [note("r1", { text: "agreed" })] }),
        note("n2", { resolved: true }),
      ],
      annotations: [drawing("d1", "n1", 1200), drawing("d2", null, 3000)],
    });
    expect(payload.notes).toEqual([
      { key: "n1", text: "note n1", start_time_ms: 1200, end_time_ms: null, annotation_end_time_ms: null, resolved: false, mentioned_user_ids: ["u-maya"],
        elements: [{ element_type: "POINT", geometry: { x: 0.5, y: 0.5 }, style: {}, payload: {} }],
        replies: [{ key: "r1", text: "agreed", mentioned_user_ids: [] }] },
      { key: "n2", text: "note n2", start_time_ms: null, end_time_ms: null, annotation_end_time_ms: null, resolved: true, mentioned_user_ids: [], elements: [], replies: [] },
    ]);
    // Free-standing drawings travel separately; local element ids are dropped.
    expect(payload.annotations).toEqual([{ start_time_ms: 3000, end_time_ms: null, elements: [{ element_type: "POINT", geometry: { x: 0.5, y: 0.5 }, style: {}, payload: {} }] }]);
    expect(carriedSummary(payload)).toBe("3 notes and 1 drawing");
  });

  it("carries how long each drawing stays on screen, and range notes' out points", () => {
    const payload = publishPayload({
      notes: [note("held", { startMs: 2000 }), note("range", { startMs: 3000, endMs: 9000 }), note("frame", { startMs: 4000 })],
      annotations: [
        { ...drawing("d1", "held", 2000), end_time_ms: 7000 },
        { ...drawing("d2", "range", 3000), end_time_ms: 9000 },
        { ...drawing("d3", "frame", 4000), end_time_ms: 4000 },
        { ...drawing("d4", null, 6000), end_time_ms: 8000 },
      ],
    });
    expect(payload.notes.map((item) => [item.key, item.end_time_ms, item.annotation_end_time_ms])).toEqual([
      ["held", null, 7000], ["range", 9000, 9000], ["frame", null, 4000],
    ]);
    expect(payload.annotations[0]).toMatchObject({ start_time_ms: 6000, end_time_ms: 8000 });
  });

  it("gives a recording-only note text and queues the recording for upload", () => {
    const payload = publishPayload({ notes: [note("v1", { text: "", recording: { url: "blob:x", mimeType: "audio/webm", kind: "voice" } })], annotations: [] });
    expect(payload.notes[0].text).toBe("Voice comment");
    expect(payload.recordings).toEqual([{ key: "v1", url: "blob:x", mimeType: "audio/webm", kind: "voice" }]);
  });

  it("has nothing to carry for a clean session", () => {
    const payload = publishPayload({ notes: [note("empty", { text: "  " })], annotations: [] });
    expect(payload.notes).toEqual([]);
    expect(carriedSummary(payload)).toBeNull();
  });
});

describe("publishChoices", () => {
  const mine = asset("hero", "p-1", [version("hero", 1)]);
  const others = [
    mine,
    asset("reel", "p-1", [version("reel1", 1), version("reel2", 2)]),
    asset("still", "p-1", [version("still", 1)], "image"),
    asset("elsewhere", "p-2", [version("else", 1)]),
    asset("legacy", "p-1", [version("legacy", 1, null)]),
  ];
  const options = publishChoices({
    asset: mine, assetFileId: "af-hero", assets: others,
    projects: [{ id: "p-2", name: "Holiday", client_team_id: null }, { id: "p-1", name: "Spring", client_team_id: "c-1" }],
    clients: [{ id: "c-1", name: "Northlight" }],
    folders: [{ id: "f-1", name: "Cuts", project_id: "p-1", parent_folder_id: null }, { id: "f-x", name: "Loose", project_id: null, parent_folder_id: null }],
  });

  it("defaults to the file's own project and folder", () => {
    expect(options.defaultProjectId).toBe("p-1");
    expect(options.defaultFolderId).toBe("f-1");
    expect(options.projects.map((item) => `${item.clientName ?? "-"}/${item.name}`)).toEqual(["-/Holiday", "Northlight/Spring"]);
    expect(options.folders.map((item) => item.id)).toEqual(["f-1"]);
  });

  it("offers only same-kind assets with a library row as version targets", () => {
    expect(options.canBeVersion).toBe(true);
    expect(options.assets.map((item) => `${item.name}:${item.label}`)).toEqual(["elsewhere:V1 → V2", "reel:V2 → V3"]);
  });

  it("orders folders parent-first with depth", () => {
    expect(folderOptions([
      { id: "b", name: "B", projectId: "p", parentId: null },
      { id: "a1", name: "Inner", projectId: "p", parentId: "a" },
      { id: "a", name: "A", projectId: "p", parentId: null },
      { id: "z", name: "Other project", projectId: "q", parentId: null },
    ], "p")).toEqual([{ id: "a", name: "A", depth: 0 }, { id: "a1", name: "Inner", depth: 1 }, { id: "b", name: "B", depth: 0 }]);
    expect(folderOptions([], null)).toEqual([]);
  });
});
