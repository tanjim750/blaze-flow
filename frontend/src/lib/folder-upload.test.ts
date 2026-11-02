import { describe, expect, it, vi } from "vitest";
import { ensureFolders, folderPaths, isHiddenName, stagedFromDrop, stagedFromInput, walkEntry, type FsEntry } from "./folder-upload";

const file = (name: string, path = "") => { const f = new File(["x"], name); if (path) Object.defineProperty(f, "webkitRelativePath", { value: path }); return f; };
const fileEntry = (name: string): FsEntry => ({ isFile: true, isDirectory: false, name, file: (ok) => ok(file(name)) });
/** A directory whose reader hands out entries `batch` at a time, like Chrome's 100-entry batches. */
const dirEntry = (name: string, children: FsEntry[], batch = 2): FsEntry => ({ isFile: false, isDirectory: true, name, createReader: () => { let at = 0; return { readEntries: (ok) => { const next = children.slice(at, at + batch); at += batch; setTimeout(() => ok(next), 0); } }; } });

describe("folder upload", () => {
  it("walks nested folders, reads every readEntries batch and skips hidden files", async () => {
    const tree = dirEntry("Shoot", [fileEntry("a.mov"), fileEntry(".DS_Store"), fileEntry("b.mov"), fileEntry("c.mov"), dirEntry("Day 1", [fileEntry("d.wav"), dirEntry(".git", [fileEntry("x")])]), fileEntry("._a.mov")]);
    const out = await walkEntry(tree);
    expect(out.map((item) => `${item.dir}|${item.file.name}`).sort()).toEqual(["Shoot/Day 1|d.wav", "Shoot|a.mov", "Shoot|b.mov", "Shoot|c.mov"]);
  });

  it("reads a drop through webkitGetAsEntry, and falls back to plain files", async () => {
    const items = [{ kind: "file", webkitGetAsEntry: () => dirEntry("A", [fileEntry("1.png")]) }, { kind: "file", webkitGetAsEntry: () => fileEntry("loose.pdf") }];
    const out = await stagedFromDrop({ items, files: [] } as unknown as DataTransfer);
    expect(out.map((item) => [item.dir, item.file.name])).toEqual([["A", "1.png"], ["", "loose.pdf"]]);
    const plain = await stagedFromDrop({ items: [{ kind: "file" }], files: [file("p.jpg"), file(".hidden")] } as unknown as DataTransfer);
    expect(plain.map((item) => [item.dir, item.file.name])).toEqual([["", "p.jpg"]]);
  });

  it("maps webkitdirectory picks by webkitRelativePath", () => {
    const out = stagedFromInput([file("a.mov", "Shoot/a.mov"), file("b.mov", "Shoot/Day 1/b.mov"), file(".DS_Store", "Shoot/.DS_Store"), file("c", "Shoot/.cache/c"), file("solo.png")]);
    expect(out.map((item) => [item.dir, item.file.name])).toEqual([["Shoot", "a.mov"], ["Shoot/Day 1", "b.mov"], ["", "solo.png"]]);
    expect(isHiddenName("Thumbs.db")).toBe(true);
  });

  it("creates folders parents first and reuses same-named folders at the same level", async () => {
    const staged = [{ file: file("a"), dir: "Shoot/Day 1/Cam A" }, { file: file("b"), dir: "Shoot" }, { file: file("c"), dir: "" }];
    expect(folderPaths(staged)).toEqual(["Shoot", "Shoot/Day 1", "Shoot/Day 1/Cam A"]);
    let n = 0; const create = vi.fn(async () => ({ id: `new-${++n}` }));
    const ids = await ensureFolders(staged, "root", [{ id: "old-shoot", name: "Shoot", parentFolderId: "root", projectId: "p1" }, { id: "other", name: "Day 1", parentFolderId: null, projectId: "p1" }], create, "p1");
    expect(create.mock.calls).toEqual([["Day 1", "old-shoot"], ["Cam A", "new-1"]]);
    expect(Object.fromEntries(ids)).toEqual({ "": "root", Shoot: "old-shoot", "Shoot/Day 1": "new-1", "Shoot/Day 1/Cam A": "new-2" });
  });

  it("falls back to Name (2) when the server says the name is taken", async () => {
    const create = vi.fn(async (name: string) => { if (name === "Shoot") throw new Error("A folder with this name already exists in this location."); return { id: name }; });
    const ids = await ensureFolders([{ file: file("a"), dir: "Shoot" }], null, [], create);
    expect(ids.get("Shoot")).toBe("Shoot (2)");
    await expect(ensureFolders([{ file: file("a"), dir: "X" }], null, [], async () => { throw new Error("Forbidden"); })).rejects.toThrow("Forbidden");
  });
});
