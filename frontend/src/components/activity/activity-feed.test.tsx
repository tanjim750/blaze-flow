import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityEntry, ActivityPage } from "@/lib/activity";
import { ActivityFeed } from "./activity-feed";

const row = (id: string, created_at: string, extra: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id, created_at, action: "task.stage.moved", category: "tasks",
  actor: { type: "user", id: "u1", name: "Maya Chen", initials: "MC", avatar_url: null },
  verb: "moved", object: { type: "task", id: "t1", label: "Hero 30s", href: "/tasks?task=t1" },
  project: { id: "p1", name: "Spring Launch" }, before: "Review", after: "Client Review", detail: {}, team_only: false,
  summary: "", ...extra,
});
const page = (results: ActivityEntry[], extra: Partial<ActivityPage> = {}): ActivityPage => ({
  results, count: results.length, page: 1, page_size: 20, has_next: false, can_export: false, ...extra,
});
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("ActivityFeed", () => {
  it("groups by day, links rows and loads more", async () => {
    const today = new Date();
    const earlier = new Date(today.getTime() - 3 * 86400000);
    fetchMock
      .mockResolvedValueOnce(json(page([row("a", today.toISOString())], { count: 2, has_next: true, can_export: true })))
      .mockResolvedValueOnce(json(page([row("b", earlier.toISOString(), { action: "media.uploaded", category: "media", detail: { version_number: 2 } })], { count: 2, page: 2 })));
    render(<ActivityFeed workspaceId="w1" projectId="p1" />);
    expect(await screen.findByText("Today")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/workspaces/w1/projects/p1/activity/?page=1&page_size=20");
    expect(screen.getByRole("link", { name: /Maya Chen moved/ })).toHaveAttribute("href", "/tasks?task=t1");
    expect(screen.getByRole("link", { name: /Export CSV/ })).toHaveAttribute("href", "/api/workspaces/w1/projects/p1/activity/export/");
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText(/uploaded/)).toBeInTheDocument();
    expect(fetchMock.mock.calls[1][0]).toContain("page=2");
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    expect(screen.getByText("Showing 2 of 2")).toBeInTheDocument();
  });

  it("filters by type and hides export without the permission", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(page([]))));
    render(<ActivityFeed workspaceId="w1" projectId="p1" />);
    expect(await screen.findByText("No activity yet")).toBeInTheDocument();
    expect(screen.queryByText(/Export CSV/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Client links" }));
    await waitFor(() => expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("type=guests"));
    expect(await screen.findByText("Nothing of this kind yet")).toBeInTheDocument();
  });

  it("explains a failure and retries", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 })).mockResolvedValueOnce(json(page([row("a", new Date().toISOString())])));
    render(<ActivityFeed workspaceId="w1" projectId="p1" />);
    expect(await screen.findByText("Activity couldn’t be loaded")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Today")).toBeInTheDocument();
  });
});
