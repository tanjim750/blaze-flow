import { describe, expect, it, vi } from "vitest";
import type { ClientTeam, MediaVersion, Project, ProjectFile, ProjectFolder, TaskStage } from "./api";
import { buildCatalogue, defaultSelection, locate, locateByTarget, mediaKind, versionKey, versionNumber } from "./review-media";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const WORKSPACE = "ws-1";

const project = (id: string, name: string, clientId: string | null = null): Project => ({
  id, workspace_id: WORKSPACE, client_team_id: clientId, name, description: null,
  status: "ACTIVE", priority: "MEDIUM", start_at: null, due_at: null,
  created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
});

const client = (id: string, name: string) => ({ id, name } as ClientTeam);
const folder = (id: string, name: string): ProjectFolder => ({
  id, workspace_id: WORKSPACE, client_team_id: null, project_id: "p1",
  parent_folder_id: null, name, created_at: "2026-09-01T00:00:00Z",
});

const assetFile = (over: Partial<ProjectFile> & { id: string; fileId: string; name: string }): ProjectFile => ({
  id: over.id, workspace_id: WORKSPACE,
  client_team_id: over.client_team_id ?? null, project_id: over.project_id ?? null,
  folder_id: over.folder_id ?? null, task_stage_id: over.task_stage_id ?? null,
  file: { id: over.fileId, name: over.name, mime_type: "video/mp4", size_bytes: 10, checksum_sha256: "x", status: "READY" },
  added_by: null,
  poster: null,
  created_at: over.created_at ?? "2026-09-02T00:00:00Z",
});

const mediaVersion = (over: { id: string; fileId: string; number: number; title: string; createdAt?: string }): MediaVersion => ({
  id: over.id, project_id: "p1", version_number: over.number, title: over.title, note: null,
  priority: "MEDIUM", allow_download: false, status: "ACTIVE",
  file: { id: over.fileId, name: `${over.title}.mp4`, mime_type: "video/mp4", size_bytes: 20 },
  current_stage: null, preview_status: "READY", created_at: over.createdAt ?? "2026-09-03T00:00:00Z",
});

const build = (input: Partial<Parameters<typeof buildCatalogue>[0]>) => buildCatalogue({
  workspaceId: WORKSPACE, projects: [project("p1", "Summer Campaign")], clients: [],
  folders: [], assetFiles: [], stages: [], mediaVersions: [], ...input,
});

describe("versionKey", () => {
  it("collapses a version marker so successive uploads form one history", () => {
    expect(versionKey("Summer_Campaign_V3.mp4")).toBe("summer campaign");
    expect(versionKey("Summer Campaign v4.mov")).toBe("summer campaign");
    expect(versionKey("Summer-Campaign.mp4")).toBe("summer campaign");
  });

  it("keeps genuinely different names apart", () => {
    expect(versionKey("hero_V2.mp4")).not.toBe(versionKey("teaser_V2.mp4"));
  });

  it("does not strip a number that is part of the name", () => {
    expect(versionKey("camera-2.mp4")).toBe("camera 2");
  });
});

describe("versionNumber", () => {
  it("reads the version off a filename and falls back when there is none", () => {
    expect(versionNumber("Summer_V3.mp4", 1)).toBe(3);
    expect(versionNumber("Summer.mp4", 7)).toBe(7);
  });
});

describe("mediaKind", () => {
  it("falls back to the extension when the browser gave no usable mime type", () => {
    expect(mediaKind("", "take.mov")).toBe("video");
    expect(mediaKind("application/octet-stream", "score.wav")).toBe("audio");
    expect(mediaKind("image/png", "lockup.png")).toBe("image");
  });
});

describe("buildCatalogue", () => {
  it("treats a library file and a media version of the same File as one cut", () => {
    const assets = build({
      assetFiles: [assetFile({ id: "af-1", fileId: "file-1", name: "hero.mp4", project_id: "p1" })],
      mediaVersions: [{ projectId: "p1", versions: [mediaVersion({ id: "mv-1", fileId: "file-1", number: 1, title: "hero" })] }],
    });

    expect(assets).toHaveLength(1);
    expect(assets[0].versions).toHaveLength(1);
    // Reviewable through the media version, and still addressable as the library row.
    expect(assets[0].versions[0].target).toEqual({ workspaceId: WORKSPACE, projectId: "p1", versionId: "mv-1" });
    expect(assets[0].versions[0].assetFileId).toBe("af-1");
  });

  it("orders a library version line by the number in its filename", () => {
    const assets = build({
      assetFiles: [
        assetFile({ id: "af-3", fileId: "f3", name: "Summer_Campaign_V3.mp4", project_id: "p1", folder_id: "fo-1" }),
        assetFile({ id: "af-1", fileId: "f1", name: "Summer_Campaign_V1.mp4", project_id: "p1", folder_id: "fo-1" }),
        assetFile({ id: "af-2", fileId: "f2", name: "Summer_Campaign_V2.mp4", project_id: "p1", folder_id: "fo-1" }),
      ],
      folders: [folder("fo-1", "Final Cuts")],
    });

    expect(assets).toHaveLength(1);
    expect(assets[0].versions.map((version) => version.label)).toEqual(["V1", "V2", "V3"]);
    expect(assets[0].folderName).toBe("Final Cuts");
    // Nothing to review against yet, which is what puts the page on local notes.
    expect(assets[0].versions.every((version) => version.target === null)).toBe(true);
  });

  it("keeps same-named files in different folders as separate assets", () => {
    const assets = build({
      assetFiles: [
        assetFile({ id: "af-1", fileId: "f1", name: "hero.mp4", project_id: "p1", folder_id: "fo-1" }),
        assetFile({ id: "af-2", fileId: "f2", name: "hero.mp4", project_id: "p1", folder_id: "fo-2" }),
      ],
      folders: [folder("fo-1", "Final Cuts"), folder("fo-2", "Archive")],
    });

    expect(assets).toHaveLength(2);
  });

  it("carries the client through from the project when the file names none", () => {
    const assets = build({
      projects: [project("p1", "Summer Campaign", "c1")],
      clients: [client("c1", "Acme")],
      mediaVersions: [{ projectId: "p1", versions: [mediaVersion({ id: "mv-1", fileId: "f1", number: 1, title: "hero" })] }],
    });

    expect(assets[0].clientName).toBe("Acme");
    expect(assets[0].projectName).toBe("Summer Campaign");
  });

  it("reports the file's board stage as its status", () => {
    const stage: TaskStage = { id: "st-1", name: "Client", color: "#f4a742", sort_order: 3, wip_limit: null, is_done: false, automation_enabled: true, task_count: 0 };
    const assets = build({
      stages: [stage],
      assetFiles: [assetFile({ id: "af-1", fileId: "f1", name: "hero.mp4", project_id: "p1", task_stage_id: "st-1" })],
    });

    expect(assets[0].stage).toEqual({ id: "st-1", name: "Client", color: "#f4a742" });
  });
});

describe("selection", () => {
  const assets = build({
    assetFiles: [assetFile({ id: "af-1", fileId: "loose", name: "b-roll.mp4", project_id: "p1" })],
    mediaVersions: [{ projectId: "p1", versions: [
      mediaVersion({ id: "mv-1", fileId: "f1", number: 1, title: "hero", createdAt: "2026-09-03T00:00:00Z" }),
      mediaVersion({ id: "mv-2", fileId: "f2", number: 2, title: "hero", createdAt: "2026-09-04T00:00:00Z" }),
    ] }],
  });

  it("finds a cut by the File id every entry point links with", () => {
    expect(locate(assets, "f1")?.version.label).toBe("V1");
    expect(locate(assets, "nope")).toBeNull();
    expect(locate(assets, undefined)).toBeNull();
  });

  it("still resolves a legacy project/version link", () => {
    expect(locateByTarget(assets, "p1", "mv-2")?.version.id).toBe("f2");
    expect(locateByTarget(assets, "p1", undefined)?.version.id).toBe("f1");
  });

  it("opens on the newest reviewable cut when the link named none", () => {
    expect(defaultSelection(assets)?.version.id).toBe("f2");
  });

  it("has nothing to open in an empty workspace", () => {
    expect(defaultSelection([])).toBeNull();
  });
});
