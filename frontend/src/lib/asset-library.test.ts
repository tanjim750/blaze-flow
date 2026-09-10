import { describe, expect, it } from "vitest";
import { assignFolderTree, deleteLibraryEntities, descendantFolderIds, kindFor, libraryForProject, type LibraryState } from "./asset-library";

describe("asset library", () => {
  it("recognizes creative source files when the browser has no MIME type", () => {
    expect(kindFor({ name: "campaign.aep", type: "" })).toBe("source");
    expect(kindFor({ name: "interview.mov", type: "video/quicktime" })).toBe("video");
    expect(kindFor({ name: "brief.pdf", type: "application/pdf" })).toBe("document");
  });

  it("projects the same entities into a project instead of copying them", () => {
    const state: LibraryState = {
      deletedIds: [],
      folders: [{ id: "folder-1", name: "Footage", clientId: "client-1", projectId: "project-1", parentFolderId: null, createdAt: "2026-09-09", createdBy: "Ada" }],
      files: [{ id: "file-1", name: "interview.mp4", kind: "video", mimeType: "video/mp4", size: 10, url: null, preview: null, uploadedBy: "Ada", uploadedAt: "2026-09-09", folderId: "folder-1", clientId: "client-1", projectId: "project-1" }],
    };

    const projected = libraryForProject(state, "project-1");
    expect(projected.folders[0]).toBe(state.folders[0]);
    expect(projected.files[0]).toBe(state.files[0]);
  });

  it("cascades folder assignment without allowing circular moves", () => {
    const state: LibraryState = {
      deletedIds: [],
      folders: [
        { id: "parent", name: "Footage", clientId: null, projectId: null, parentFolderId: null, createdAt: "2026-09-09", createdBy: "Ada" },
        { id: "child", name: "Selects", clientId: null, projectId: null, parentFolderId: "parent", createdAt: "2026-09-09", createdBy: "Ada" },
      ],
      files: [{ id: "file", name: "take.mov", kind: "video", mimeType: "video/quicktime", size: 10, url: null, preview: null, uploadedBy: "Ada", uploadedAt: "2026-09-09", folderId: "child", clientId: null, projectId: null }],
    };

    expect([...descendantFolderIds(state.folders, "parent")]).toEqual(["child"]);
    const assigned = assignFolderTree(state, state.folders[0], "client", "project", null);
    expect(assigned.folders.map((folder) => folder.projectId)).toEqual(["project", "project"]);
    expect(assigned.files[0]).toMatchObject({ clientId: "client", projectId: "project" });
  });

  it("recursively deletes selected folders and their contents", () => {
    const state: LibraryState = {
      deletedIds: [],
      folders: [
        { id: "parent", name: "Parent", clientId: null, projectId: null, parentFolderId: null, createdAt: "2026-09-10", createdBy: "Ada" },
        { id: "child", name: "Child", clientId: null, projectId: null, parentFolderId: "parent", createdAt: "2026-09-10", createdBy: "Ada" },
      ],
      files: [{ id: "file", name: "take.mov", kind: "video", mimeType: "video/quicktime", size: 10, url: null, preview: null, uploadedBy: "Ada", uploadedAt: "2026-09-10", folderId: "child", clientId: null, projectId: null }],
    };
    const next = deleteLibraryEntities(state, ["parent"]);
    expect(next.folders).toEqual([]);
    expect(next.files).toEqual([]);
    expect(next.deletedIds).toEqual(expect.arrayContaining(["parent", "child"]));
  });
});
