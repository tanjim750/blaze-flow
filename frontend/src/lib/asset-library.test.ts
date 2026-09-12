import { describe, expect, it } from "vitest";
import { applyLibraryStage, assignFolderTree, assignLibraryEntities, deleteLibraryEntities, descendantFolderIds, isProcessing, kindFor, libraryForProject, stageFileIds, type LibraryFile, type LibraryState } from "./asset-library";

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
      files: [{ id: "file-1", fileId: null, name: "interview.mp4", kind: "video", mimeType: "video/mp4", size: 10, durationMs: null, status: "READY", url: null, preview: null, uploadedBy: "Ada", uploadedAt: "2026-09-09", folderId: "folder-1", clientId: "client-1", projectId: "project-1", stageId: null }],
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
      files: [{ id: "file", fileId: null, name: "take.mov", kind: "video", mimeType: "video/quicktime", size: 10, durationMs: null, status: "READY", url: null, preview: null, uploadedBy: "Ada", uploadedAt: "2026-09-09", folderId: "child", clientId: null, projectId: null, stageId: null }],
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
      files: [{ id: "file", fileId: null, name: "take.mov", kind: "video", mimeType: "video/quicktime", size: 10, durationMs: null, status: "READY", url: null, preview: null, uploadedBy: "Ada", uploadedAt: "2026-09-10", folderId: "child", clientId: null, projectId: null, stageId: null }],
    };
    const next = deleteLibraryEntities(state, ["parent"]);
    expect(next.folders).toEqual([]);
    expect(next.files).toEqual([]);
    expect(next.deletedIds).toEqual(expect.arrayContaining(["parent", "child"]));
  });

  it("bulk moves a selected folder tree without flattening selected descendants", () => {
    const state: LibraryState = {
      deletedIds: [],
      folders: [
        { id: "parent", name: "Parent", clientId: null, projectId: null, parentFolderId: null, createdAt: "2026-09-10", createdBy: "Ada" },
        { id: "child", name: "Child", clientId: null, projectId: null, parentFolderId: "parent", createdAt: "2026-09-10", createdBy: "Ada" },
      ],
      files: [{ id: "file", fileId: null, name: "take.mov", kind: "video", mimeType: "video/quicktime", size: 10, durationMs: null, status: "READY", url: null, preview: null, uploadedBy: "Ada", uploadedAt: "2026-09-10", folderId: "child", clientId: null, projectId: null, stageId: null }],
    };
    const next = assignLibraryEntities(state, ["parent", "child", "file"], "client", "project", null);
    expect(next.folders.find((folder) => folder.id === "child")?.parentFolderId).toBe("parent");
    expect(next.files[0]).toMatchObject({ folderId: "child", clientId: "client", projectId: "project", stageId: null });
  });

  it("cascades a stage change from a folder down to every file beneath it", () => {
    const state: LibraryState = {
      deletedIds: [],
      folders: [
        { id: "parent", name: "Parent", clientId: null, projectId: null, parentFolderId: null, createdAt: "2026-09-10", createdBy: "Ada" },
        { id: "child", name: "Child", clientId: null, projectId: null, parentFolderId: "parent", createdAt: "2026-09-10", createdBy: "Ada" },
      ],
      files: [
        { id: "nested", fileId: null, name: "nested.mov", kind: "video", mimeType: "video/quicktime", size: 10, durationMs: null, status: "READY", url: null, preview: null, uploadedBy: "Ada", uploadedAt: "2026-09-10", folderId: "child", clientId: null, projectId: null, stageId: null },
        { id: "loose", fileId: null, name: "loose.mov", kind: "video", mimeType: "video/quicktime", size: 10, durationMs: null, status: "READY", url: null, preview: null, uploadedBy: "Ada", uploadedAt: "2026-09-10", folderId: null, clientId: null, projectId: null, stageId: null },
      ],
    };

    expect(stageFileIds(state, ["parent"])).toEqual(["nested"]);
    const next = applyLibraryStage(state, ["parent"], "stage-approved");
    expect(next.files.find((file) => file.id === "nested")?.stageId).toBe("stage-approved");
    expect(next.files.find((file) => file.id === "loose")?.stageId).toBeNull();
  });

  it("sets the stage of directly selected files without touching the rest", () => {
    const state: LibraryState = {
      deletedIds: [],
      folders: [],
      files: [{ id: "picked", fileId: null, name: "picked.mov", kind: "video", mimeType: "video/quicktime", size: 10, durationMs: null, status: "READY", url: null, preview: null, uploadedBy: "Ada", uploadedAt: "2026-09-10", folderId: null, clientId: null, projectId: null, stageId: null }, { id: "other", fileId: null, name: "other.mov", kind: "video", mimeType: "video/quicktime", size: 10, durationMs: null, status: "READY", url: null, preview: null, uploadedBy: "Ada", uploadedAt: "2026-09-10", folderId: null, clientId: null, projectId: null, stageId: "stage-final" }],
    };

    const next = applyLibraryStage(state, ["picked"], "stage-qa");
    expect(next.files.map((file) => file.stageId)).toEqual(["stage-qa", "stage-final"]);
  });

  it("clears a stage when none is chosen", () => {
    const state: LibraryState = {
      deletedIds: [],
      folders: [],
      files: [{ id: "staged", fileId: null, name: "staged.mov", kind: "video", mimeType: "video/quicktime", size: 10, durationMs: null, status: "READY", url: null, preview: null, uploadedBy: "Ada", uploadedAt: "2026-09-10", folderId: null, clientId: null, projectId: null, stageId: "stage-qa" }],
    };

    expect(applyLibraryStage(state, ["staged"], null).files[0].stageId).toBeNull();
  });

  it("keeps a file marked as working until it is scanned and its thumbnail exists", () => {
    const base: LibraryFile = {
      id: "f", fileId: null, name: "clip.mov", kind: "video", mimeType: "video/quicktime",
      size: 10, durationMs: null, status: "READY", url: null, preview: null,
      uploadedBy: "Ada", uploadedAt: "2026-09-12", folderId: null, clientId: null,
      projectId: null, stageId: null,
    };

    expect(isProcessing({ ...base, status: "DUPLICATING" })).toBe(true);
    expect(isProcessing({ ...base, status: "PENDING" })).toBe(true);
    // Scanned, but the poster has not landed yet.
    expect(isProcessing(base)).toBe(true);
    expect(isProcessing({ ...base, preview: "/poster.jpg" })).toBe(false);

    // Nothing that never gets a poster is left waiting on one.
    expect(isProcessing({ ...base, kind: "audio" })).toBe(false);
    expect(isProcessing({ ...base, kind: "document" })).toBe(false);
    // And a rejected file is finished, not pending.
    expect(isProcessing({ ...base, status: "FAILED" })).toBe(false);
  });
});
