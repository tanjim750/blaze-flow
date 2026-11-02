import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectsView } from "@/lib/projects-view";

const ok = { error: null, savedAt: 1 };
const actions = vi.hoisted(() => ({
  renameClientAction: vi.fn(async () => ({ error: null, savedAt: 1 })),
  renameCampaignAction: vi.fn(async () => ({ error: null, savedAt: 1 })),
  archiveClientAction: vi.fn(async () => ({ error: null, savedAt: 1 })),
  deleteCampaignAction: vi.fn(async () => ({ error: null, savedAt: 1 })),
  moveCampaignToClientAction: vi.fn(async () => ({ error: null, savedAt: 1 })),
  setProjectStatusAction: vi.fn(async () => ({ error: null, savedAt: 1 })),
}));
const nav = vi.hoisted(() => ({ params: new URLSearchParams(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: nav.refresh, push: () => {} }), usePathname: () => "/projects", useSearchParams: () => nav.params }));
vi.mock("./actions", () => actions);
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock("@/components/frame/share-modal", () => ({ ShareModal: ({ title, projectId }: { title: string; projectId: string }) => <div role="dialog" aria-label={`Share ${title}`} data-project={projectId} /> }));

import { AllProjects, plural } from "./all-projects";

const hour = new Date(Date.now() - 3600_000).toISOString();
const view: ProjectsView = {
  workspaceId: "ws", workspaceName: "Studio", notice: null, selectedClient: null, selectedCampaign: null,
  clients: [
    { id: "c1", name: "Acme", initial: "A", assetCount: 0, updatedAt: hour, campaigns: [
      { id: "p1", name: "Spring", assetCount: 0, folders: [], updatedAt: hour, poster: "/api/poster/p1" },
      { id: "p2", name: "Summer", assetCount: 0, folders: [], updatedAt: hour },
    ] },
    { id: "c2", name: "Orbit", initial: "O", assetCount: 0, updatedAt: null, campaigns: [] },
    { id: "unassigned", name: "No client", initial: "?", assetCount: 0, campaigns: [{ id: "p3", name: "Loose", assetCount: 0, folders: [] }] },
  ],
};
const openMenu = (name: string) => {
  const trigger = screen.getByRole("button", { name: `More for ${name}` });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  return screen.getByRole("menu");
};

beforeEach(() => { Object.values(actions).forEach((fn) => fn.mockClear()); nav.params = new URLSearchParams("view=all"); });
afterEach(() => cleanup());

describe("AllProjects – client grid", () => {
  it("shows real counts, updated times and poster covers with a gradient fallback", () => {
    const { container } = render(<AllProjects view={view} />);
    expect(screen.getByRole("heading", { name: "All clients" })).toBeInTheDocument();
    expect(screen.getByText("3 clients · Studio")).toBeInTheDocument();
    expect(screen.getByText("2 projects · Updated 1 hour ago")).toBeInTheDocument();
    expect(screen.getByText("0 projects · No activity yet")).toBeInTheDocument();
    expect(container.querySelector('img[src="/api/poster/p1"]')).not.toBeNull();
    expect(screen.getByRole("link", { name: "Open Acme" })).toHaveAttribute("href", "/projects?view=all&client=c1");
    expect(screen.getByRole("link", { name: "No client" })).toBeInTheDocument();
  });

  it("offers no menu on No client and no Change cover anywhere", () => {
    render(<AllProjects view={view} />);
    expect(screen.queryByRole("button", { name: "More for No client" })).toBeNull();
    const menu = openMenu("Acme");
    expect(within(menu).queryByText(/cover/i)).toBeNull();
  });

  it("renames a client through the API", async () => {
    render(<AllProjects view={view} />);
    fireEvent.click(within(openMenu("Acme")).getByRole("menuitem", { name: "Rename" }));
    const input = await screen.findByRole("textbox", { name: "Rename Acme" });
    fireEvent.change(input, { target: { value: "Acme Foods" } });
    await act(async () => { fireEvent.submit(input.closest("form")!); });
    expect(actions.renameClientAction).toHaveBeenCalledWith("c1", "Acme Foods");
  });

  it("archives a client only after confirming", async () => {
    render(<AllProjects view={view} />);
    fireEvent.click(within(openMenu("Acme")).getByRole("menuitem", { name: "Archive" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Archive Acme?");
    expect(actions.archiveClientAction).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Archive" })); });
    expect(actions.archiveClientAction).toHaveBeenCalledWith("c1");
  });
});

describe("AllProjects – a client's projects", () => {
  beforeEach(() => { nav.params = new URLSearchParams("view=all&client=c1"); });

  it("shows the breadcrumb and links projects to the project page", () => {
    render(<AllProjects view={view} />);
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByRole("link", { name: "All clients" })).toHaveAttribute("href", "/projects?view=all");
    expect(screen.getByRole("link", { name: "Open Spring" })).toHaveAttribute("href", "/projects?campaign=p1");
    expect(screen.getByText("2 projects")).toBeInTheDocument();
  });

  it("deletes a project only after confirming", async () => {
    render(<AllProjects view={view} />);
    fireEvent.click(within(openMenu("Summer")).getByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(actions.deleteCampaignAction).not.toHaveBeenCalled();
    fireEvent.click(within(openMenu("Summer")).getByRole("menuitem", { name: "Delete" }));
    await act(async () => { fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" })); });
    expect(actions.deleteCampaignAction).toHaveBeenCalledWith("p2");
  });

  it("archives a project via its status", async () => {
    render(<AllProjects view={view} />);
    fireEvent.click(within(openMenu("Spring")).getByRole("menuitem", { name: "Archive" }));
    await act(async () => { fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Archive" })); });
    expect(actions.setProjectStatusAction).toHaveBeenCalledWith("p1", "ARCHIVED");
  });

  it("opens the existing share modal for the project", async () => {
    render(<AllProjects view={view} />);
    fireEvent.click(within(openMenu("Spring")).getByRole("menuitem", { name: "Share" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Share Spring" })).toHaveAttribute("data-project", "p1"));
  });

  it("moves a project to another client", async () => {
    render(<AllProjects view={view} />);
    const menu = openMenu("Spring");
    fireEvent.keyDown(within(menu).getByRole("menuitem", { name: "Move to client" }), { key: "ArrowRight" });
    const target = await screen.findByRole("menuitem", { name: "Orbit" });
    await act(async () => { fireEvent.click(target); });
    expect(actions.moveCampaignToClientAction).toHaveBeenCalledWith("p1", "c2");
  });
});

it("pluralises", () => { expect(plural(1, "project")).toBe("1 project"); expect(plural(2, "client")).toBe("2 clients"); });
void ok;
