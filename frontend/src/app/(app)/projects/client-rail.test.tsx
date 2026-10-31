import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectsView } from "@/lib/projects-view";

const actions = vi.hoisted(() => ({
  renameClientAction: vi.fn(async () => ({ error: null, savedAt: 1 })),
  renameCampaignAction: vi.fn(async () => ({ error: null, savedAt: 1 })),
  renameFolderAction: vi.fn(async () => ({ error: null, savedAt: 1 })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }), usePathname: () => "/projects", useSearchParams: () => new URLSearchParams() }));
vi.mock("./actions", () => ({
  ...actions,
  createCampaignAction: vi.fn(), createClientAction: vi.fn(), createFolderAction: vi.fn(), deleteCampaignAction: vi.fn(),
  deleteFolderAction: vi.fn(), moveCampaignToClientAction: vi.fn(), setProjectStatusAction: vi.fn(),
}));

import { ClientRail, InlineRename } from "./browser";

const view = (access?: ProjectsView["access"]): ProjectsView => ({
  workspaceId: "ws", workspaceName: "W", notice: null, access,
  clients: [
    { id: "c1", name: "Evan", initial: "E", assetCount: 0, campaigns: [{ id: "p1", name: "november", assetCount: 0, folders: [] }] },
    { id: "unassigned", name: "Unassigned", initial: "?", assetCount: 0, campaigns: [] },
  ],
  selectedClient: null, selectedCampaign: null,
});
const rail = (v: ProjectsView, expanded: string[] = []) => render(<ClientRail view={v} expanded={expanded} setExpanded={() => {}} closed={false} onToggle={() => {}} />);

beforeEach(() => Object.values(actions).forEach((fn) => fn.mockClear()));
afterEach(() => cleanup());

describe("ClientRail", () => {
  it("has no filter box, and pins Archived projects after the tree", () => {
    const { container } = rail(view());
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByPlaceholderText(/filter/i)).toBeNull();
    const foot = container.querySelector(".pb-rail-foot");
    expect(foot).not.toBeNull();
    expect(foot?.parentElement?.tagName).toBe("ASIDE");
    expect(foot).toHaveTextContent("Archived projects");
  });

  it("offers a '…' actions button on clients but not on Unassigned", () => {
    rail(view());
    expect(screen.getByRole("button", { name: "Actions for Evan" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Actions for Unassigned" })).toBeNull();
  });

  it("double-clicking a client starts an inline rename that saves on Enter", async () => {
    rail(view());
    fireEvent.doubleClick(screen.getByText("Evan"));
    const input = screen.getByLabelText("Rename Evan");
    fireEvent.change(input, { target: { value: "Evan Lorezca" } });
    await act(async () => { fireEvent.submit(input.closest("form")!); });
    expect(actions.renameClientAction).toHaveBeenCalledWith("c1", "Evan Lorezca");
  });

  it("double-clicking a project row renames it", async () => {
    rail(view(), ["c1"]);
    fireEvent.doubleClick(screen.getByText("november"));
    const input = screen.getByLabelText("Rename november");
    fireEvent.change(input, { target: { value: "December" } });
    await act(async () => { fireEvent.submit(input.closest("form")!); });
    expect(actions.renameCampaignAction).toHaveBeenCalledWith("p1", "December");
  });

  it("hides rename from people who cannot edit", () => {
    rail(view({ renameClient: false, renameProject: false, renameFolder: false }), ["c1"]);
    expect(screen.queryByRole("button", { name: "Actions for Evan" })).toBeNull();
    fireEvent.doubleClick(screen.getByText("Evan"));
    expect(screen.queryByLabelText("Rename Evan")).toBeNull();
    fireEvent.doubleClick(screen.getByText("november"));
    expect(screen.queryByLabelText("Rename november")).toBeNull();
  });
});

describe("InlineRename", () => {
  it("Escape cancels without saving", () => {
    const onSave = vi.fn(); const onClose = vi.fn();
    render(<InlineRename initial="Evan" onSave={onSave} onClose={onClose} />);
    fireEvent.keyDown(screen.getByLabelText("Rename Evan"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("rejects an empty name on Enter and keeps the field open", () => {
    const onSave = vi.fn(); const onClose = vi.fn();
    render(<InlineRename initial="Evan" onSave={onSave} onClose={onClose} />);
    const input = screen.getByLabelText("Rename Evan");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(input.closest("form")!);
    expect(screen.getByRole("alert")).toHaveTextContent("Name can't be empty.");
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("saves on blur", async () => {
    const onSave = vi.fn(async () => ({ error: null, savedAt: 1 })); const onClose = vi.fn();
    render(<InlineRename initial="Evan" onSave={onSave} onClose={onClose} />);
    const input = screen.getByLabelText("Rename Evan");
    fireEvent.change(input, { target: { value: "Roboshadow" } });
    await act(async () => { fireEvent.blur(input, { relatedTarget: document.body }); });
    expect(onSave).toHaveBeenCalledWith("Roboshadow");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
