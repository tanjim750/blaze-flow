import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FilesView } from "@/lib/files-view";
import { replaceLibrary, type LibraryFile } from "@/lib/asset-library";
import { AssetLibrary } from "@/components/asset-library";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
const info = vi.fn();
vi.mock("sonner", async (load) => {
  const real = await load<typeof import("sonner")>();
  return { ...real, toast: Object.assign((...args: unknown[]) => real.toast(...(args as [string])), { ...real.toast, info: (...args: unknown[]) => info(...args) }) };
});

const view = { workspaceId: "workspace", notice: null, clients: [], groups: [], stages: [], files: [], folders: [] } satisfies FilesView;

const file = (id: string, name: string, extra: Partial<LibraryFile> = {}): LibraryFile => ({
  id, fileId: `media-${id}`, name, kind: "video", mimeType: "video/mp4", size: 2048, durationMs: 8000, status: "READY", url: null, preview: "/poster.jpg",
  versioning: { assetId: null, assetName: name, versionNumber: 1, versionCount: 1, isLatest: true },
  uploadedBy: "Ada", uploadedAt: "2026-09-12T10:00:00Z", folderId: null, clientId: null, projectId: "project-1", stageId: null, ...extra,
});

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  replaceLibrary({ deletedIds: [], folders: [], files: [file("a", "alpha.mp4"), file("b", "bravo.mp4", { fileId: null })] });
  info.mockReset();
});
afterEach(() => { cleanup(); window.localStorage.clear(); replaceLibrary({ folders: [], files: [], deletedIds: [] }); });

const openMenu = async (name: string) => {
  const trigger = screen.getByRole("button", { name: `Actions for ${name}` });
  // Right-click opens the same controlled ⋯ menu (Radix ignores synthetic pointer clicks in jsdom).
  await act(async () => { fireEvent.contextMenu(trigger.closest(`[aria-label^="${name}"]`)!); });
  return screen.findByRole("menu");
};

describe("Share in an asset's ⋯ menu", () => {
  it("sits right after Open in review and opens the review share dialog for that file", async () => {
    render(<AssetLibrary view={{ ...view, canShare: true }} />);
    const menu = await openMenu("alpha.mp4");
    const items = within(menu).getAllByRole("menuitem").map((item) => item.textContent);
    expect(items.indexOf("Share")).toBe(items.indexOf("Open in review") + 1);
    await act(async () => { fireEvent.click(within(menu).getByRole("menuitem", { name: "Share" })); });
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Share “alpha\.mp4”/)).toBeInTheDocument();
    expect((within(dialog).getByLabelText("Share link") as HTMLInputElement).value).toContain("/review?media=media-a");
    expect(within(dialog).getByRole("radio", { name: /Public/ })).toBeEnabled();
  });

  it("explains instead of opening a dialog when the file has no review version yet", async () => {
    render(<AssetLibrary view={{ ...view, canShare: true }} />);
    const menu = await openMenu("bravo.mp4");
    await act(async () => { fireEvent.click(within(menu).getByRole("menuitem", { name: "Share" })); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(info).toHaveBeenCalledWith("Not ready to share yet", expect.objectContaining({ description: expect.stringContaining("still uploading") }));
  });

  it("is hidden from people who may not share", async () => {
    render(<AssetLibrary view={{ ...view, canShare: false }} />);
    const menu = await openMenu("alpha.mp4");
    expect(within(menu).queryByRole("menuitem", { name: "Share" })).toBeNull();
    expect(within(menu).getByRole("menuitem", { name: "Open in review" })).toBeInTheDocument();
  });
});
