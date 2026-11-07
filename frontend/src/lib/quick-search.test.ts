import { beforeEach, describe, expect, it } from "vitest";
import { buildGroups, highlight, isPaletteShortcut, pageRows, quickActions, readRecents, rememberRecent, type PaletteRow } from "./quick-search";

const client = { dashboard_role: "client", my_membership_id: null, billing: undefined } as never;
const editor = { dashboard_role: "editor", my_membership_id: "m1", billing: undefined } as never;

describe("quick search helpers", () => {
  beforeEach(() => window.localStorage.clear());

  it("highlights every case-insensitive occurrence", () => {
    expect(highlight("Spring spot SPRING", "spring")).toEqual([
      { text: "Spring", hit: true }, { text: " spot ", hit: false }, { text: "SPRING", hit: true },
    ]);
    expect(highlight("Cold brew", "")).toEqual([{ text: "Cold brew", hit: false }]);
  });

  it("offers only the actions and pages a role may use", () => {
    expect(quickActions("client").map((a) => a.title)).toEqual(["New request", "Send files"]);
    expect(quickActions("editor").map((a) => a.title)).not.toContain("New client or project");
    expect(quickActions("owner")[0].href).toBe("/projects?do=new");
    expect(pageRows(client).map((p) => p.href)).not.toContain("/tasks");
    expect(pageRows(editor).map((p) => p.href)).not.toContain("/team");
  });

  it("groups recents/actions/pages with no query, and server results first with one", () => {
    const recent: PaletteRow = { id: "r", title: "Hero", subtitle: "x", href: "/review?x", group: "recent" };
    const idle = buildGroups({ query: "", server: [], recents: [recent], actions: quickActions("editor"), pages: pageRows(editor) });
    expect(idle.map((g) => g.key)).toEqual(["recent", "actions", "pages"]);
    const typed = buildGroups({ query: "task", server: [{ key: "tasks", label: "Tasks", items: [{ id: "t", title: "Grade", subtitle: "P", href: "/tasks?task=t" }] }], recents: [recent], actions: quickActions("editor"), pages: pageRows(editor) });
    expect(typed.map((g) => g.key)).toEqual(["tasks", "actions", "pages"]);
    expect(typed[1].rows.map((r) => r.title)).toEqual(["New task"]);
  });

  it("remembers opened results newest-first without duplicates, but never actions or pages", () => {
    const a: PaletteRow = { id: "a", title: "A", subtitle: "", href: "/a", group: "projects" };
    const b: PaletteRow = { id: "b", title: "B", subtitle: "", href: "/b", group: "cuts" };
    rememberRecent("w", a); rememberRecent("w", b); rememberRecent("w", a);
    rememberRecent("w", { id: "p", title: "Home", subtitle: "", href: "/", group: "pages" });
    expect(readRecents("w").map((r) => r.href)).toEqual(["/a", "/b"]);
    expect(readRecents("other")).toEqual([]);
  });

  it("recognises ⌘K and Ctrl+K only", () => {
    const key = (extra: object) => ({ key: "k", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...extra });
    expect(isPaletteShortcut(key({ metaKey: true }))).toBe(true);
    expect(isPaletteShortcut(key({ ctrlKey: true }))).toBe(true);
    expect(isPaletteShortcut(key({}))).toBe(false);
    expect(isPaletteShortcut(key({ metaKey: true, shiftKey: true }))).toBe(false);
  });
});
