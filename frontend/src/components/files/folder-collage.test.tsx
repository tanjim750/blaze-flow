import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FilesView } from "@/lib/files-view";
import { replaceLibrary } from "@/lib/asset-library";
import { AssetLibrary } from "@/components/asset-library";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const folder = (id: string, name: string, previews: string[]) => ({
  id, workspace_id: "workspace", client_team_id: null, project_id: null, parent_folder_id: null, name, created_at: "2026-09-12T10:00:00Z", preview_thumbnails: previews,
});
const view = {
  workspaceId: "workspace", notice: null, clients: [], groups: [], stages: [], files: [],
  folders: [folder("three", "Three", ["/p1", "/p2", "/p3", "/p4"]), folder("two", "Two", ["/q1", "/q2"]), folder("one", "One", ["/r1"]), folder("empty", "Empty", [])],
} satisfies FilesView;

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  window.localStorage.setItem("krewsys-files-view", "grid");
  replaceLibrary({ deletedIds: [], folders: [], files: [] });
});
afterEach(() => { cleanup(); window.localStorage.clear(); });

describe("folder card collage", () => {
  it("draws up to three posters, and the folder glyph when there are none", () => {
    const { container } = render(<AssetLibrary view={view} />);
    const cards = [...container.querySelectorAll(".fx-frame.is-fcard")];
    expect(cards.length).toBe(4);
    const byCount = cards.map((card) => card.querySelectorAll(".fx-collage-tile img").length).sort();
    expect(byCount).toEqual([0, 1, 2, 3]);
    const three = cards.find((card) => card.classList.contains("n3"))!;
    expect([...three.querySelectorAll("img")].map((img) => img.getAttribute("src"))).toEqual(["/p1", "/p2", "/p3"]);
    const empty = cards.find((card) => !card.classList.contains("has-collage"))!;
    expect(empty.querySelector(".fx-fcard-icon")).not.toBeNull();
  });
});
