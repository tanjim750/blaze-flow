import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { FilesView } from "@/lib/files-view";
import { replaceLibrary } from "@/lib/asset-library";
import { AssetLibrary } from "./asset-library";

const empty = { folders: [], files: [], deletedIds: [] };
const view = {
  workspaceId: "workspace",
  notice: null,
  clients: [{ id: "client", name: "Acme", description: null, website: null, email: null, phone: null, address_line_1: null, address_line_2: null, city: null, state_region: null, postal_code: null, country_code: null, metadata: null, status: "ACTIVE", created_at: "2026-09-10" }],
  groups: [{ projectId: "project", projectName: "Summer Campaign", clientId: "client", files: [], folders: [] }],
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
    expect(document.querySelector(".al-folder-grid.dense")).toBeInTheDocument();

    rendered.unmount();
    render(<AssetLibrary view={view} projectId="project" projectName="Summer Campaign" clientId="client" compact />);
    expect(screen.getByText("Campaign Assets")).toBeInTheDocument();
  });

  it("stages multiple uploads and finds files recursively", () => {
    replaceLibrary({
      deletedIds: [],
      folders: [{ id: "nested", name: "Nested", clientId: null, projectId: null, parentFolderId: null, createdAt: "2026-09-10", createdBy: "Ada" }],
      files: [{ id: "hidden", name: "deep-take.mov", kind: "video", mimeType: "video/quicktime", size: 10, url: null, preview: null, uploadedBy: "Ada", uploadedAt: "2026-09-10", folderId: "nested", clientId: null, projectId: null }],
    });
    const rendered = render(<AssetLibrary view={view} />);
    fireEvent.change(screen.getByPlaceholderText("Search this location…"), { target: { value: "deep-take" } });
    expect(screen.queryByText("deep-take.mov")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Search all folders" }));
    expect(screen.getByText("deep-take.mov")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(input!, { target: { files: [new File(["a"], "brief.pdf", { type: "application/pdf" }), new File(["b"], "mix.wav", { type: "audio/wav" })] } });
    expect(screen.getByText("2 files ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload 2 files" })).toBeEnabled();
  });
});
