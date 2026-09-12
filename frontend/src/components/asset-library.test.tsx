import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FilesView } from "@/lib/files-view";
import { replaceLibrary } from "@/lib/asset-library";
import { AssetLibrary } from "./asset-library";

// The library refreshes the server-rendered Status tab after a write; tests mount no app router.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

// Lets a test make the server reject a write.
const deleteAssetFile = vi.fn();
vi.mock("@/lib/asset-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/asset-api-client")>()),
  deleteAssetFile: (...args: unknown[]) => deleteAssetFile(...args),
}));

const empty = { folders: [], files: [], deletedIds: [] };
const view = {
  workspaceId: "workspace",
  notice: null,
  clients: [{ id: "client", name: "Acme", description: null, website: null, email: null, phone: null, address_line_1: null, address_line_2: null, city: null, state_region: null, postal_code: null, country_code: null, metadata: null, status: "ACTIVE", created_at: "2026-09-10" }],
  groups: [{ projectId: "project", projectName: "Summer Campaign", clientId: "client", files: [], folders: [] }],
  stages: [{ id: "s-todo", name: "To Do", color: "#89909d", sort_order: 0, wip_limit: null, is_done: false, automation_enabled: true, task_count: 0 }, { id: "s-review", name: "Internal QA", color: "#4ba3ff", sort_order: 1, wip_limit: null, is_done: false, automation_enabled: true, task_count: 0 }],
  files: [],
  folders: [],
} satisfies FilesView;

afterEach(() => { cleanup(); replaceLibrary(empty); });

describe("AssetLibrary", () => {
  it("creates one shared project folder and switches display density", () => {
    replaceLibrary(empty);
    const rendered = render(<AssetLibrary view={view} />);
    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    fireEvent.change(screen.getByLabelText("Folder name"), { target: { value: "Campaign Assets" } });
    fireEvent.change(screen.getByLabelText("Project (optional)"), { target: { value: "project" } });
    fireEvent.click(screen.getByRole("button", { name: "Create folder" }));
    expect(screen.getByText("Campaign Assets")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "List view" }));
    expect(document.querySelector(".al-grid.dense")).toBeInTheDocument();

    rendered.unmount();
    render(<AssetLibrary view={view} projectId="project" projectName="Summer Campaign" clientId="client" compact />);
    expect(screen.getByText("Campaign Assets")).toBeInTheDocument();
  });

  it("stages multiple uploads and finds files recursively", () => {
    replaceLibrary({
      deletedIds: [],
      folders: [{ id: "nested", name: "Nested", clientId: null, projectId: null, parentFolderId: null, createdAt: "2026-09-10", createdBy: "Ada" }],
      files: [{ id: "hidden", fileId: null, name: "deep-take.mov", kind: "video", mimeType: "video/quicktime", size: 10, url: null, preview: null, uploadedBy: "Ada", uploadedAt: "2026-09-10", folderId: "nested", clientId: null, projectId: null, stageId: null }],
    });
    const rendered = render(<AssetLibrary view={view} />);
    fireEvent.change(screen.getByPlaceholderText("Search this location…"), { target: { value: "deep-take" } });
    expect(screen.queryByText("deep-take.mov")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.click(screen.getByRole("switch", { name: "Search all folders" }));
    expect(screen.getByText("deep-take.mov")).toBeInTheDocument();
    // Close it again: an open dismissable layer outlives the assertion otherwise.
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));

    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(input!, { target: { files: [new File(["a"], "brief.pdf", { type: "application/pdf" }), new File(["b"], "mix.wav", { type: "audio/wav" })] } });
    expect(screen.getByText("2 files ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload 2 files" })).toBeEnabled();
  });

  it("supports keyboard dialogs and selecting every visible asset", () => {
    replaceLibrary({
      deletedIds: [],
      folders: [{ id: "folder", name: "Footage", clientId: null, projectId: null, parentFolderId: null, createdAt: "2026-09-10", createdBy: "Ada" }],
      files: [{ id: "file", fileId: null, name: "root.mov", kind: "video", mimeType: "video/quicktime", size: 10, url: null, preview: null, uploadedBy: "Ada", uploadedAt: "2026-09-10", folderId: null, clientId: null, projectId: null, stageId: null }],
    });
    render(<AssetLibrary view={view} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all visible" }));
    expect(screen.getByText("2 selected")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "u" });
    const dialog = screen.getByRole("dialog", { name: "Upload files" });
    expect(dialog).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Upload files" })).not.toBeInTheDocument();
  });

  it("links an upload to a client, a project, and a stage in one pass", async () => {
    replaceLibrary(empty);
    const rendered = render(<AssetLibrary view={{ ...view, workspaceId: null }} />);
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(input!, { target: { files: [new File(["a"], "promo.mp4", { type: "video/mp4" })] } });
    fireEvent.change(screen.getByLabelText("Client (optional)"), { target: { value: "client" } });
    fireEvent.change(screen.getByLabelText("Project (optional)"), { target: { value: "project" } });
    fireEvent.change(screen.getByLabelText("Stage"), { target: { value: "s-review" } });
    fireEvent.click(screen.getByRole("button", { name: "Upload 1 file" }));

    // The staged name is still on screen while the dialog closes, so wait for the card itself.
    await waitFor(() => expect(rendered.container.querySelector(".al-file-card")).toBeTruthy());
    expect(rendered.container.querySelector(".al-file-card small")?.textContent).toContain("Acme / Summer Campaign");
    expect(rendered.container.querySelector(".al-file-card .al-stage")?.textContent).toBe("Internal QA");
  });

  it("filters the library down to a single stage", async () => {
    replaceLibrary({
      deletedIds: [],
      folders: [],
      files: [
        { id: "approved", fileId: null, name: "final-cut.mov", kind: "video", mimeType: "video/quicktime", size: 10, url: null, preview: null, uploadedBy: "Ada", uploadedAt: "2026-09-10", folderId: null, clientId: null, projectId: null, stageId: "s-review" },
        { id: "draft", fileId: null, name: "rough-cut.mov", kind: "video", mimeType: "video/quicktime", size: 10, url: null, preview: null, uploadedBy: "Ada", uploadedAt: "2026-09-10", folderId: null, clientId: null, projectId: null, stageId: null },
      ],
    });
    render(<AssetLibrary view={view} />);
    expect(screen.getByText("rough-cut.mov")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.change(screen.getByLabelText("Filter by stage"), { target: { value: "s-review" } });
    expect(screen.getByText("final-cut.mov")).toBeInTheDocument();
    expect(screen.queryByText("rough-cut.mov")).not.toBeInTheDocument();
  });

  it("shows folders and files in one grid, folders first", () => {
    replaceLibrary({
      deletedIds: [],
      folders: [{ id: "folder", name: "Testing folder", clientId: null, projectId: null, parentFolderId: null, createdAt: "2026-09-12", createdBy: "Ada" }],
      files: [{ id: "file", fileId: null, name: "take.mov", kind: "video", mimeType: "video/quicktime", size: 10, url: null, preview: null, uploadedBy: "Ada", uploadedAt: "2026-09-12", folderId: null, clientId: null, projectId: null, stageId: null }],
    });
    const rendered = render(<AssetLibrary view={view} />);

    // One grid, not a Folders section and a Files section.
    expect(rendered.container.querySelectorAll(".al-grid")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Folders" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Files", level: 2 })).not.toBeInTheDocument();

    const cards = [...rendered.container.querySelectorAll(".al-grid > article")];
    expect(cards[0].className).toContain("al-folder-card");
    expect(cards[1].className).toContain("al-file-card");
  });

  it("lets server rows win over a stale local copy", () => {
    // The library previously mirrored into localStorage and always overrode the server,
    // so an unsaved edit outlived a reload and masked the real value.
    replaceLibrary({
      deletedIds: [],
      folders: [],
      files: [{ id: "server-file", fileId: null, name: "stale-local-name.mov", kind: "video", mimeType: "video/quicktime", size: 10, url: null, preview: null, uploadedBy: "Ada", uploadedAt: "2026-09-12", folderId: null, clientId: null, projectId: null, stageId: null }],
    });
    const withServerRow = { ...view, files: [{ id: "server-file", workspace_id: "workspace", client_team_id: null, project_id: null, folder_id: null, stageId: "s-review", file: { id: "f", name: "server-name.mov", mime_type: "video/quicktime", size_bytes: 10, checksum_sha256: "x", stageId: "s-review" }, created_at: "2026-09-12" }] } as unknown as FilesView;

    render(<AssetLibrary view={withServerRow} />);
    expect(screen.getByText("server-name.mov")).toBeInTheDocument();
    expect(screen.queryByText("stale-local-name.mov")).not.toBeInTheDocument();
  });

  it("keeps a local row on screen while its write is in flight", () => {
    replaceLibrary({
      deletedIds: [],
      folders: [],
      pending: ["server-file"],
      files: [{ id: "server-file", fileId: null, name: "just-renamed.mov", kind: "video", mimeType: "video/quicktime", size: 10, url: null, preview: null, uploadedBy: "Ada", uploadedAt: "2026-09-12", folderId: null, clientId: null, projectId: null, stageId: null }],
    });
    const withServerRow = { ...view, files: [{ id: "server-file", workspace_id: "workspace", client_team_id: null, project_id: null, folder_id: null, stageId: null, file: { id: "f", name: "old-name.mov", mime_type: "video/quicktime", size_bytes: 10, checksum_sha256: "x", stageId: "s-review" }, created_at: "2026-09-12" }] } as unknown as FilesView;

    render(<AssetLibrary view={withServerRow} />);
    expect(screen.getByText("just-renamed.mov")).toBeInTheDocument();
    expect(screen.queryByText("old-name.mov")).not.toBeInTheDocument();
  });

  it("shows the sample library only when there is no workspace", () => {
    replaceLibrary(empty);
    const { unmount } = render(<AssetLibrary view={{ ...view, workspaceId: null }} />);
    expect(screen.getByText("Footage")).toBeInTheDocument();
    unmount();

    render(<AssetLibrary view={view} />);
    expect(screen.queryByText("Footage")).not.toBeInTheDocument();
  });

  it("rolls back and reports when the server rejects a write", async () => {
    deleteAssetFile.mockRejectedValueOnce(new Error("You do not have permission to delete this asset."));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    replaceLibrary({
      deletedIds: [],
      folders: [],
      files: [{ id: "doomed", fileId: null, name: "keep-me.mov", kind: "video", mimeType: "video/quicktime", size: 10, url: null, preview: null, uploadedBy: "Ada", uploadedAt: "2026-09-12", folderId: null, clientId: null, projectId: null, stageId: null }],
    });
    render(<AssetLibrary view={view} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all visible" }));
    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));

    // The optimistic removal is undone and the reason is shown, rather than swallowed.
    expect(await screen.findByRole("alert")).toHaveTextContent("You do not have permission to delete this asset.");
    expect(screen.getByText("keep-me.mov")).toBeInTheDocument();
  });
});
