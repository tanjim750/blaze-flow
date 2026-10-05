import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FilesView } from "@/lib/files-view";
import { replaceLibrary, type LibraryFile } from "@/lib/asset-library";
import { AssetLibrary } from "@/components/asset-library";
import { PanelResizer } from "./panel-resizer";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const view = {
  workspaceId: "workspace",
  notice: null,
  clients: [],
  groups: [],
  stages: [{ id: "s-review", name: "Internal QA", color: "#4ba3ff", sort_order: 1, wip_limit: null, is_done: false, automation_enabled: true, task_count: 0 }],
  files: [],
  folders: [],
} satisfies FilesView;

const file = (id: string, name: string, extra: Partial<LibraryFile> = {}): LibraryFile => ({
  id, fileId: null, name, kind: "video", mimeType: "video/mp4", size: 2048, durationMs: 8000, status: "READY", url: null, preview: null,
  versioning: { assetId: null, assetName: name, versionNumber: 1, versionCount: 1, isLatest: true },
  uploadedBy: "Ada", uploadedAt: "2026-09-12T10:00:00Z", folderId: null, clientId: null, projectId: null, stageId: null, ...extra,
});

beforeEach(() => {
  // Dock tree + inspector like a wide desktop (Chat lesson uses viewport ≥1280).
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
  replaceLibrary({
    deletedIds: [],
    folders: [{ id: "folder", name: "Selects", clientId: null, projectId: null, parentFolderId: null, createdAt: "2026-09-12", createdBy: "Ada" }],
    files: [
      file("a", "alpha.mp4", { width: 1080, height: 1920, commentCount: 3, stageId: "s-review", preview: "/poster-a.jpg" }),
      file("b", "bravo.mp4"),
      file("c", "charlie.mp4"),
      file("d", "delta.mp4", { folderId: "folder" }),
    ],
  });
});
afterEach(() => { cleanup(); window.localStorage.clear(); replaceLibrary({ folders: [], files: [], deletedIds: [] }); });

const row = (name: RegExp) => screen.getByRole("row", { name });
const selectedNames = () => screen.getAllByRole("row").filter((item) => item.getAttribute("aria-selected") === "true").map((item) => item.getAttribute("aria-label")?.split(",")[0]);

describe("Files panel interactions", () => {
  it("selects with a click, Cmd+click or the checkbox, and extends with Shift+click", () => {
    render(<AssetLibrary view={view} />);
    // Sort by name so the visible order is alpha, bravo, charlie.
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.change(screen.getByLabelText("Filter by sort"), { target: { value: "name" } });
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));

    fireEvent.click(row(/^alpha\.mp4/), { metaKey: true });
    expect(selectedNames()).toEqual(["alpha.mp4"]);
    fireEvent.click(row(/^charlie\.mp4/), { shiftKey: true });
    expect(selectedNames()).toEqual(["alpha.mp4", "bravo.mp4", "charlie.mp4"]);
    // The bulk bar only appears for two or more.
    expect(screen.getByText("3 selected")).toBeInTheDocument();
    fireEvent.click(row(/^bravo\.mp4/), { metaKey: true });
    expect(selectedNames()).toEqual(["alpha.mp4", "charlie.mp4"]);
    fireEvent.click(within(row(/^charlie\.mp4/)).getByRole("checkbox", { name: "Select charlie.mp4" }));
    expect(selectedNames()).toEqual(["alpha.mp4"]);
    expect(screen.queryByText(/\d selected$/)).not.toBeInTheDocument();
  });

  it("selects on a single click and opens in review on a double-click or Enter, once", () => {
    replaceLibrary({ deletedIds: [], folders: [], files: [file("a", "alpha.mp4", { fileId: "file-a", preview: "/poster-a.jpg" }), file("p", "brief.pdf", { fileId: "file-p", kind: "document", mimeType: "application/pdf" })] });
    const opened: string[] = [];
    const listener = (event: Event) => opened.push((event as CustomEvent<{ href: string }>).detail.href);
    window.addEventListener("blazeflow:open-review", listener);
    render(<AssetLibrary view={view} />);
    // A single click only selects, and the details panel shows the file.
    fireEvent.click(row(/^alpha\.mp4/));
    expect(opened).toEqual([]);
    expect(selectedNames()).toEqual(["alpha.mp4"]);
    expect(within(screen.getByRole("complementary", { name: "Video" })).getByText("alpha.mp4")).toBeInTheDocument();
    // A double-click (two clicks, then dblclick) opens exactly once.
    fireEvent.click(row(/^alpha\.mp4/));
    fireEvent.doubleClick(row(/^alpha\.mp4/));
    // PDFs (and images) open in review too, from the keyboard.
    fireEvent.keyDown(row(/^brief\.pdf/), { key: "Enter" });
    // The hover chip is still a one-click way in.
    fireEvent.click(within(row(/^alpha\.mp4/)).getByRole("button", { name: "Open in review: alpha.mp4" }));
    window.removeEventListener("blazeflow:open-review", listener);
    expect(opened).toEqual(["/review?media=file-a", "/review?media=file-p", "/review?media=file-a"]);
  });

  it("selects a folder on a single click and opens it on a double-click", () => {
    render(<AssetLibrary view={view} />);
    fireEvent.click(row(/^Selects, folder/));
    expect(selectedNames()).toEqual(["Selects"]);
    expect(screen.getByRole("row", { name: /^alpha\.mp4/ })).toBeInTheDocument();
    fireEvent.doubleClick(row(/^Selects, folder/));
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("button", { name: "Selects" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("row", { name: /^delta\.mp4/ })).toBeInTheDocument();
  });

  it("opens on a tap, because touch has no hover chip or double-click", () => {
    replaceLibrary({ deletedIds: [], folders: [], files: [file("a", "alpha.mp4", { fileId: "file-a", preview: "/poster-a.jpg" })] });
    const opened: string[] = [];
    const listener = (event: Event) => opened.push((event as CustomEvent<{ href: string }>).detail.href);
    window.addEventListener("blazeflow:open-review", listener);
    render(<AssetLibrary view={view} />);
    // jsdom has no PointerEvent; a click carrying pointerType is what browsers dispatch.
    const tap = new MouseEvent("click", { bubbles: true, cancelable: true });
    Object.defineProperty(tap, "pointerType", { value: "touch" });
    fireEvent(row(/^alpha\.mp4/), tap);
    window.removeEventListener("blazeflow:open-review", listener);
    expect(opened).toEqual(["/review?media=file-a"]);
  });

  it("moves focus with the arrow keys, selects with Space and clears with Escape", () => {
    render(<AssetLibrary view={view} />);
    fireEvent.click(screen.getByRole("button", { name: "List view" }));
    const rows = screen.getAllByRole("row");
    // One tab stop for the whole grid (roving tabindex).
    expect(rows.filter((item) => item.tabIndex === 0)).toHaveLength(1);
    rows[0].focus();
    fireEvent.keyDown(rows[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1], { key: "End" });
    expect(document.activeElement).toBe(rows[rows.length - 1]);
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(rows[0], { key: "ArrowDown", shiftKey: true });
    expect(rows[0]).toHaveAttribute("aria-selected", "true");
    expect(rows[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(rows[1], { key: " " });
    expect(rows[1]).toHaveAttribute("aria-selected", "false");
    fireEvent.keyDown(rows[1], { key: "a", metaKey: true });
    expect(rows.every((item) => item.getAttribute("aria-selected") === "true")).toBe(true);
    fireEvent.keyDown(rows[1], { key: "Escape" });
    expect(rows.some((item) => item.getAttribute("aria-selected") === "true")).toBe(false);
  });

  it("shows file details, a folder summary, and a multi-select summary in the inspector", () => {
    render(<AssetLibrary view={view} />);
    // Nothing selected: the location summary.
    const summary = screen.getByRole("complementary", { name: "Details" });
    expect(within(summary).getByText("All files")).toBeInTheDocument();
    expect(within(summary).getByText(/3 files · 1 folder/)).toBeInTheDocument();

    fireEvent.click(row(/^alpha\.mp4/), { metaKey: true });
    const details = screen.getByRole("complementary", { name: "Video" });
    expect(within(details).getByText("alpha.mp4")).toBeInTheDocument();
    expect(within(details).getByText("1080 × 1920 · 9:16")).toBeInTheDocument();
    expect(within(details).getByText("0:08", { selector: "dd" })).toBeInTheDocument();
    expect(within(details).getByText("3 comments")).toBeInTheDocument();
    expect(within(details).getByRole("button", { name: /^Stage: Internal QA/ })).toBeInTheDocument();

    fireEvent.click(row(/^bravo\.mp4/), { metaKey: true });
    const multi = screen.getByRole("complementary", { name: "Details" });
    expect(within(multi).getByText("2 items selected")).toBeInTheDocument();
    expect(within(multi).queryByText("Linked to")).not.toBeInTheDocument();

    // `]` hides and shows the panel.
    fireEvent.keyDown(window, { key: "]" });
    expect(screen.queryByRole("complementary", { name: "Details" })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "]" });
    expect(screen.getByRole("complementary", { name: "Details" })).toBeInTheDocument();
  });

  it("shows one badge on the image and puts aspect, size and feedback in the caption", () => {
    render(<AssetLibrary view={view} />);
    const tile = row(/^alpha\.mp4/);
    expect(tile.querySelectorAll(".fx-frame > b, .fx-frame > .fx-duration")).toHaveLength(1);
    expect(within(tile).getByText("0:08")).toHaveClass("fx-duration");
    const meta = tile.querySelector(".fx-meta")!;
    expect(meta.textContent).toContain("9:16");
    expect(meta.textContent).toContain("2.0 KB");
    expect(within(tile).getByTitle("3 comments")).toHaveClass("fx-feedback");
    // A real poster, letterboxed inside the 16:9 frame (object-fit lives in CSS).
    expect(tile.querySelector(".fx-frame .fx-thumb.has-media img")).toHaveAttribute("src", "/poster-a.jpg");
    // A video without a poster yet says so instead of showing an empty frame.
    expect(within(row(/^bravo\.mp4/)).getByText("Generating preview…")).toBeInTheDocument();
  });

  it("opens folders from the tree and navigates it with the keyboard", () => {
    render(<AssetLibrary view={view} />);
    const tree = screen.getByRole("tree", { name: "Library" });
    const items = within(tree).getAllByRole("treeitem");
    expect(items[0]).toHaveAttribute("aria-selected", "true");
    items[0].focus();
    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1], { key: "Enter" });
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("button", { name: "Selects" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("row", { name: /^delta\.mp4/ })).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /^alpha\.mp4/ })).not.toBeInTheDocument();
  });

  it("offers Clear search and Search all folders when nothing matches", () => {
    render(<AssetLibrary view={view} />);
    fireEvent.change(screen.getByPlaceholderText("Search this location…"), { target: { value: "delta" } });
    expect(screen.getByText("No files match “delta”")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Search all folders" }));
    expect(screen.getByRole("row", { name: /^delta\.mp4/ })).toBeInTheDocument();
  });
});

describe("PanelResizer", () => {
  it("resizes from the keyboard within its bounds and resets with Home", () => {
    const onChange = vi.fn();
    render(<PanelResizer label="Resize library panel" value={240} min={200} max={360} fallback={240} edge="left" onChange={onChange} />);
    const handle = screen.getByRole("separator", { name: "Resize library panel" });
    expect(handle).toHaveAttribute("aria-valuenow", "240");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(256);
    fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(200);
    fireEvent.keyDown(handle, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
