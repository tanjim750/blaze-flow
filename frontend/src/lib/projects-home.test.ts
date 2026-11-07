import { describe, expect, it } from "vitest";
import { legacyFilesHref, unsortedFiles } from "./projects-home";
import type { FilesView } from "./files-view";

describe("Projects home compatibility", () => {
  it("keeps legacy searches, folder links, filters and action params", () => {
    const url = new URL(legacyFilesHref({ folder: "folder-1", q: "summer cut", client: "client-1", project: "project-1", kind: "video", do: "upload", view: "old" }), "http://localhost");
    expect(url.pathname).toBe("/projects");
    expect(Object.fromEntries(url.searchParams)).toEqual({ folder: "folder-1", q: "summer cut", client: "client-1", project: "project-1", kind: "video", do: "upload", view: "files" });
  });
  it("keeps repeated params and handles a bare bookmark", () => {
    expect(legacyFilesHref({})).toBe("/projects?view=files");
    expect(legacyFilesHref({ tag: ["one", "two"] })).toContain("tag=one&tag=two");
  });
  it("Unsorted is only the unassigned slice, without changing data or access", () => {
    const original = { workspaceId: "w", files: [{ id: "a", project_id: null }, { id: "b", project_id: "p" }], folders: [{ id: "c", project_id: null }, { id: "d", project_id: "p" }], groups: [], clients: [], stages: [], canShare: false, notice: null } as unknown as FilesView;
    const bucket = unsortedFiles(original);
    expect(bucket.files.map((f) => f.id)).toEqual(["a"]);
    expect(bucket.folders.map((f) => f.id)).toEqual(["c"]);
    expect(bucket.canShare).toBe(false);
    expect(original.files).toHaveLength(2);
  });
});
