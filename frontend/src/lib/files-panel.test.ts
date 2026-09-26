import { describe, expect, it } from "vitest";
import type { LibraryFile, LibraryFolder } from "./asset-library";
import { aspectLabel, folderTreeRows, groupSections, middleTruncate, moveIndex, nextSelection, pruneSelection, runtime, scopeItems, stageTone, summarize, visibleOrder, type ScopeInput } from "./files-panel";

const folder = (id: string, name: string, parent: string | null = null, extra: Partial<LibraryFolder> = {}): LibraryFolder =>
  ({ id, name, clientId: null, projectId: null, parentFolderId: parent, createdAt: "2026-09-10", createdBy: "Ada", ...extra });
const file = (id: string, name: string, extra: Partial<LibraryFile> = {}): LibraryFile => ({
  id, fileId: null, name, kind: "video", mimeType: "video/mp4", size: 10, durationMs: null, status: "READY",
  versioning: { assetId: null, assetName: name, versionNumber: 1, versionCount: 1, isLatest: true },
  url: null, preview: null, uploadedBy: "Ada", uploadedAt: "2026-09-10", folderId: null, clientId: null, projectId: null, stageId: null, ...extra,
});
const base: ScopeInput = { folders: [], files: [], folderId: null, query: "", everywhere: false, client: "", project: "", kind: "", stage: "", sort: "name" };

describe("scopeItems (filtering)", () => {
  const folders = [folder("f1", "Footage"), folder("f2", "Nested", "f1")];
  const files = [
    file("a", "hero.mov", { projectId: "p1", stageId: "s1" }),
    file("b", "deep-take.mov", { folderId: "f2" }),
    file("c", "brief.pdf", { kind: "document", projectId: "p2" }),
    file("old", "hero-v1.mov", { versioning: { assetId: "x", assetName: "hero", versionNumber: 1, versionCount: 2, isLatest: false } }),
  ];

  it("shows only the current folder's direct children and hides superseded cuts", () => {
    const scope = scopeItems({ ...base, folders, files });
    expect(scope.folders.map((item) => item.id)).toEqual(["f1"]);
    expect(scope.files.map((item) => item.id)).toEqual(["c", "a"]);
  });

  it("searches only this folder unless 'everywhere' is on and there is a query", () => {
    expect(scopeItems({ ...base, folders, files, query: "deep" }).files).toHaveLength(0);
    const everywhere = scopeItems({ ...base, folders, files, query: "DEEP", everywhere: true });
    expect(everywhere.recursive).toBe(true);
    expect(everywhere.files.map((item) => item.id)).toEqual(["b"]);
    // An empty query never goes recursive, even with the switch on.
    expect(scopeItems({ ...base, folders, files, everywhere: true }).recursive).toBe(false);
  });

  it("narrows by project, type and stage, and a type or stage filter hides folders", () => {
    expect(scopeItems({ ...base, folders, files, project: "p2" }).files.map((item) => item.id)).toEqual(["c"]);
    const byKind = scopeItems({ ...base, folders, files, kind: "document" });
    expect(byKind.files.map((item) => item.id)).toEqual(["c"]);
    expect(byKind.folders).toHaveLength(0);
    expect(scopeItems({ ...base, folders, files, stage: "s1" }).files.map((item) => item.id)).toEqual(["a"]);
  });

  it("sorts by size and by newest", () => {
    const sized = [file("s", "s.mov", { size: 1 }), file("l", "l.mov", { size: 99, uploadedAt: "2026-09-01" })];
    expect(scopeItems({ ...base, files: sized, sort: "size" }).files[0].id).toBe("l");
    expect(scopeItems({ ...base, files: sized, sort: "newest" }).files[0].id).toBe("s");
  });
});

describe("groupSections (grouping)", () => {
  const names: Record<string, string> = { p1: "Spring Launch", p2: "Atlas Reel" };
  const lookup = (id: string) => names[id];
  const files = [file("a", "a.mov", { projectId: "p1" }), file("b", "b.png", { kind: "image", projectId: "p2" }), file("c", "c.pdf", { kind: "document" }), file("d", "d.mov", { projectId: "gone" })];

  it("puts folders first, then campaigns A–Z, with Unassigned (including unknown projects) last", () => {
    const sections = groupSections([folder("f", "Footage")], files, "project", lookup);
    expect(sections.map((section) => section.title)).toEqual(["Folders", "Atlas Reel", "Spring Launch", "Unassigned"]);
    expect(sections[3].files.map((item) => item.id)).toEqual(["c", "d"]);
  });

  it("groups by type in a fixed order and skips empty groups", () => {
    const sections = groupSections([], files, "type", lookup);
    expect(sections.map((section) => section.title)).toEqual(["Video", "Images", "Documents"]);
  });

  it("returns one section with no grouping, and none when nothing is visible", () => {
    expect(groupSections([folder("f", "F")], files, "none", lookup)).toHaveLength(1);
    expect(groupSections([], [], "project", lookup)).toEqual([]);
    expect(groupSections([], [], "none", lookup)).toEqual([]);
  });

  it("lists visible ids in screen order and skips collapsed sections", () => {
    const sections = groupSections([folder("f", "Footage")], files, "project", lookup);
    expect(visibleOrder(sections, new Set())).toEqual(["f", "b", "a", "c", "d"]);
    expect(visibleOrder(sections, new Set(["project:p1", "folders"]))).toEqual(["b", "c", "d"]);
  });
});

describe("nextSelection (selection)", () => {
  const order = ["a", "b", "c", "d", "e"];
  const empty = { selected: new Set<string>(), anchor: null };

  it("replaces on a plain click", () => {
    const one = nextSelection(empty, "b", "replace", order);
    expect([...nextSelection(one, "d", "replace", order).selected]).toEqual(["d"]);
  });

  it("toggles single items with ⌘/Ctrl and moves the anchor", () => {
    let state = nextSelection(empty, "a", "replace", order);
    state = nextSelection(state, "c", "toggle", order);
    expect([...state.selected].sort()).toEqual(["a", "c"]);
    expect(state.anchor).toBe("c");
    state = nextSelection(state, "a", "toggle", order);
    expect([...state.selected]).toEqual(["c"]);
  });

  it("selects a range from the anchor with Shift, in either direction, keeping the anchor", () => {
    const anchored = nextSelection(empty, "b", "replace", order);
    const forward = nextSelection(anchored, "d", "range", order);
    expect([...forward.selected]).toEqual(["b", "c", "d"]);
    const back = nextSelection(forward, "a", "range", order);
    expect([...back.selected]).toEqual(["a", "b"]);
    expect(back.anchor).toBe("b");
  });

  it("treats Shift with no usable anchor as a plain click", () => {
    expect([...nextSelection(empty, "c", "range", order).selected]).toEqual(["c"]);
  });

  it("prunes ids that left the screen", () => {
    const state = { selected: new Set(["a", "gone"]), anchor: "gone" };
    const pruned = pruneSelection(state, new Set(["a", "b"]));
    expect([...pruned.selected]).toEqual(["a"]);
    expect(pruned.anchor).toBeNull();
    const untouched = { selected: new Set(["a"]), anchor: "a" };
    expect(pruneSelection(untouched, new Set(["a"]))).toBe(untouched);
  });
});

describe("moveIndex (arrow keys in a sectioned grid)", () => {
  // Two sections: 5 items and 3 items, 3 columns.
  //  0 1 2      <- section 1
  //  3 4
  //  5 6 7      <- section 2
  const sizes = [5, 3];
  it("walks left and right through the flat order and clamps at the ends", () => {
    expect(moveIndex(sizes, 0, "ArrowLeft", 3)).toBe(0);
    expect(moveIndex(sizes, 4, "ArrowRight", 3)).toBe(5);
    expect(moveIndex(sizes, 7, "ArrowRight", 3)).toBe(7);
  });
  it("keeps the column moving down, dropping into a partial row or the next section", () => {
    expect(moveIndex(sizes, 1, "ArrowDown", 3)).toBe(4);
    expect(moveIndex(sizes, 2, "ArrowDown", 3)).toBe(4); // no tile under 2: last of the partial row
    expect(moveIndex(sizes, 4, "ArrowDown", 3)).toBe(6);
    expect(moveIndex(sizes, 6, "ArrowDown", 3)).toBe(6);
  });
  it("moves up into the previous section's last row, clamping the column", () => {
    expect(moveIndex(sizes, 7, "ArrowUp", 3)).toBe(4);
    expect(moveIndex(sizes, 5, "ArrowUp", 3)).toBe(3);
    expect(moveIndex(sizes, 4, "ArrowUp", 3)).toBe(1);
    expect(moveIndex(sizes, 1, "ArrowUp", 3)).toBe(1);
  });
  it("skips collapsed sections and handles list view and Home/End", () => {
    expect(moveIndex([2, 0, 2], 1, "ArrowDown", 1)).toBe(2);
    expect(moveIndex([2, 0, 2], 2, "ArrowUp", 1)).toBe(1);
    expect(moveIndex(sizes, 4, "Home", 3)).toBe(0);
    expect(moveIndex(sizes, 0, "End", 3)).toBe(7);
    expect(moveIndex([], 0, "End", 3)).toBe(-1);
  });
});

describe("folderTreeRows", () => {
  const folders = [folder("r", "Root B"), folder("a", "Root A"), folder("c", "Child", "r"), folder("g", "Grandchild", "c"), folder("o", "Orphan", "missing")];
  const files = [file("1", "x.mov", { folderId: "r" }), file("2", "y.mov", { folderId: "r", versioning: { assetId: "z", assetName: "y", versionNumber: 1, versionCount: 2, isLatest: false } })];

  it("lists roots A–Z, treats orphans as roots, and counts direct items", () => {
    const rows = folderTreeRows(folders, files, new Set());
    expect(rows.map((row) => row.folder.name)).toEqual(["Orphan", "Root A", "Root B"]);
    expect(rows.find((row) => row.folder.id === "r")).toMatchObject({ count: 2, hasChildren: true, expanded: false });
  });

  it("walks into expanded folders and reveals the ancestors of the open folder", () => {
    expect(folderTreeRows(folders, files, new Set(["r"])).map((row) => `${row.depth}:${row.folder.id}`)).toEqual(["0:o", "0:a", "0:r", "1:c"]);
    expect(folderTreeRows(folders, files, new Set(), "g").map((row) => row.folder.id)).toEqual(["o", "a", "r", "c", "g"]);
  });
});

describe("formatters and tones", () => {
  it("truncates in the middle and keeps the extension", () => {
    expect(middleTruncate("short.mp4")).toBe("short.mp4");
    const cut = middleTruncate("spring_launch_final_director_cut_v3_9x16.mp4", 28);
    expect(cut.length).toBeLessThanOrEqual(28);
    expect(cut.startsWith("spring_launch")).toBe(true);
    expect(cut.endsWith("9x16.mp4")).toBe(true);
    expect(cut).toContain("…");
  });
  it("formats runtime and aspect", () => {
    expect(runtime(14_000)).toBe("0:14");
    expect(runtime(3_725_000)).toBe("1:02:05");
    expect(aspectLabel(1080, 1920)).toBe("9:16");
    expect(aspectLabel(1920, 1080)).toBe("16:9");
    expect(aspectLabel(1000, 1000)).toBe("1:1");
    expect(aspectLabel(0, 10)).toBe("");
  });
  it("maps built-in stage names to DS tones and leaves custom ones to the neutral pill", () => {
    expect(stageTone("To Do")).toBe("neutral");
    expect(stageTone("In Progress")).toBe("brand");
    expect(stageTone("Internal QA")).toBe("teal");
    expect(stageTone("Client Review")).toBe("info");
    expect(stageTone("Revisions")).toBe("destructive");
    expect(stageTone("Approved")).toBe("success");
    expect(stageTone("Colour grade")).toBeNull();
  });
  it("prefers the stage kind over the name, matching the Tasks board", () => {
    expect(stageTone("QA pass", "review")).toBe("teal");
    expect(stageTone("Sent to client", "client_review")).toBe("info");
    expect(stageTone("Final check", "custom")).toBeNull();
    expect(stageTone("Approved", "approved")).toBe("success");
  });
  it("summarizes size and stage mix", () => {
    const summary = summarize([file("a", "a", { size: 5, stageId: "s" }), file("b", "b", { size: 7 })], [folder("f", "F")]);
    expect(summary).toMatchObject({ files: 2, folders: 1, bytes: 12 });
    expect(summary.stages.get("s")).toBe(1);
    expect(summary.stages.get(null)).toBe(1);
  });
});
