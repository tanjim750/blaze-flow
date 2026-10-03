import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@/lib/api";
import { ProjectBrief } from "./project-brief";

const project = (overrides: Partial<Project> = {}): Project => ({
  id: "p1", workspace_id: "w1", client_team_id: null, name: "Spring Launch", description: "Three cutdowns.\nWarm grade.",
  status: "ACTIVE", priority: "HIGH", start_at: null, due_at: "2026-10-20T12:00:00Z", created_at: "2026-09-01", updated_at: "2026-09-01",
  deliverable_specs: { aspect_ratio: "9:16", target_length_seconds: 30, platform: "Instagram", resolution: "1080x1920", notes: "Burn in captions" },
  viewer_can_edit: true,
  ...overrides,
});

const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const bodies = () => fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));

describe("ProjectBrief", () => {
  it("is read-only for people who cannot edit the project", () => {
    render(<ProjectBrief workspaceId="w1" project={project({ viewer_can_edit: false })} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("View only")).toBeInTheDocument();
    expect(screen.getByText(/Three cutdowns/)).toBeInTheDocument();
    expect(screen.getByText("9:16 vertical")).toBeInTheDocument();
    expect(screen.getByText("Only people who can edit this project can change the brief.")).toBeInTheDocument();
  });

  it("treats an unknown edit right as read-only", () => {
    render(<ProjectBrief workspaceId="w1" project={project({ viewer_can_edit: null })} />);
    expect(screen.getByText("View only")).toBeInTheDocument();
  });

  it("debounces typing into one PATCH and then says Saved", async () => {
    render(<ProjectBrief workspaceId="w1" project={project()} />);
    const brief = screen.getByLabelText("Brief");
    fireEvent.change(brief, { target: { value: "Draft one" } });
    fireEvent.change(brief, { target: { value: "Draft two" } });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/workspaces/w1/projects/p1/");
    expect(bodies()[0]).toEqual({ description: "Draft two" });
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("merges spec picks into one deliverable_specs patch", async () => {
    render(<ProjectBrief workspaceId="w1" project={project()} />);
    fireEvent.click(screen.getByRole("radio", { name: /16:9/ }));
    fireEvent.click(screen.getByRole("radio", { name: "YouTube" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(bodies()).toEqual([{ deliverable_specs: { aspect_ratio: "16:9", platform: "YouTube" } }]);
  });

  it("shows the server's error with a Retry that resends the change", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ deliverable_specs: { aspect_ratio: ["Not a valid choice."] } }), { status: 400 }));
    render(<ProjectBrief workspaceId="w1" project={project()} />);
    fireEvent.click(screen.getByRole("radio", { name: "Low" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(screen.getByRole("alert")).toHaveTextContent("Not a valid choice.");
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(bodies()).toEqual([{ priority: "LOW" }, { priority: "LOW" }]);
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("refuses a nonsense length instead of saving it", async () => {
    render(<ProjectBrief workspaceId="w1" project={project()} />);
    fireEvent.change(screen.getByLabelText(/Target length/), { target: { value: "about a minute" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/Use seconds/)).toBeInTheDocument();
  });
});
