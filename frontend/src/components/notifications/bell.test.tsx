import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationBell } from "./bell";
import { POLL_MS } from "./use-notifications";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const openReview = vi.fn();
// Radix's positioning layer doesn't settle under jsdom, so the shared popover is swapped for a
// minimal controlled stand-in. The bell's own open/refresh logic is what's under test here.
vi.mock("@/components/ui/popover", async () => {
  const React = await import("react");
  const Ctx = React.createContext<{ open: boolean; set: (next: boolean) => void }>({ open: false, set: () => {} });
  return {
    Popover: ({ open, onOpenChange, children }: { open: boolean; onOpenChange: (next: boolean) => void; children: React.ReactNode }) =>
      React.createElement(Ctx.Provider, { value: { open, set: onOpenChange } }, children),
    PopoverTrigger: ({ children }: { children: React.ReactElement<{ onClick?: () => void }> }) => {
      const ctx = React.useContext(Ctx);
      return React.cloneElement(children, { onClick: () => ctx.set(!ctx.open) });
    },
    PopoverContent: ({ children }: { children: React.ReactNode }) => {
      const ctx = React.useContext(Ctx);
      return ctx.open ? React.createElement("div", { role: "dialog" }, children) : null;
    },
    PopoverClose: ({ children }: { children: React.ReactNode }) => children,
  };
});
vi.mock("@/components/universal-review", () => ({ openUniversalReview: (request: unknown) => openReview(request) }));

const page = (unread: number) => ({
  results: [
    {
      id: "n1", kind: "REVIEW_COMMENT_NEW", workspace_id: "w1",
      actor: { id: "u1", email: "maya@x", name: "Maya Chen", initials: "MC", avatar_url: null, is_guest: false },
      entity_type: "review_comment", entity_id: "c1",
      payload: { media_title: "Hero", version_number: 2 }, link: "/review?media=f2&comment=c1", snippet: "Logo pops early",
      poster_url: null, unread: unread > 0, read_at: null, created_at: new Date().toISOString(),
    },
    {
      id: "n2", kind: "TASK_ASSIGNED", workspace_id: "w1",
      actor: { id: "u2", email: "theo@x", name: "Theo Okafor", initials: "TO", avatar_url: null, is_guest: false },
      entity_type: "task_assignee", entity_id: "a1",
      payload: { title: "Export socials", task_id: "t1" }, link: "/tasks?task=t1", snippet: null,
      poster_url: null, unread: false, read_at: "2026-10-01T00:00:00Z", created_at: new Date().toISOString(),
    },
  ],
  count: 2, unread_count: unread, page: 1, page_size: 15, has_next: false,
});

const fetchMock = vi.fn();
let visibility: DocumentVisibilityState = "visible";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes("/read") ? {} : page(3)), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); push.mockReset(); openReview.mockReset(); });

const listCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/notifications/?")).length;

describe("NotificationBell", () => {
  it("shows the unread count from the API and scopes the request to the workspace", async () => {
    render(<NotificationBell workspaceId="w1" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(screen.getByRole("button", { name: "Notifications, 3 unread" })).toHaveTextContent("3");
    expect(String(fetchMock.mock.calls[0][0])).toContain("workspace=w1");
  });

  it("polls every 45s while visible and pauses while the tab is hidden", async () => {
    render(<NotificationBell workspaceId="w1" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(listCalls()).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });
    expect(listCalls()).toBe(2);
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS * 3); });
    expect(listCalls()).toBe(2);
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(listCalls()).toBe(3);
  });

  it("lists items under a day heading, marks one read on click and opens the review", async () => {
    render(<NotificationBell workspaceId="w1" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    fireEvent.click(screen.getByRole("button", { name: /Notifications, 3 unread/ }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
    expect(screen.getByText("“Logo pops early”")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Maya Chen commented on Hero · V2 \(unread\)/ }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(fetchMock.mock.calls.some(([url, init]) => url === "/api/notifications/n1/read/" && (init as RequestInit).method === "POST")).toBe(true);
    expect(openReview).toHaveBeenCalledWith(expect.objectContaining({ href: "/review?media=f2&comment=c1" }));
  });

  it("navigates to a task and offers View all and mark-all-read", async () => {
    render(<NotificationBell workspaceId="w1" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    fireEvent.click(screen.getByRole("button", { name: /Notifications/ }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(screen.getByRole("link", { name: "View all" })).toHaveAttribute("href", "/notifications");
    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    const readAll = fetchMock.mock.calls.find(([url]) => url === "/api/notifications/read-all/");
    expect(JSON.parse((readAll?.[1] as RequestInit).body as string)).toEqual({ workspace_id: "w1" });
    fireEvent.click(screen.getByRole("button", { name: /Theo Okafor assigned you/ }));
    expect(push).toHaveBeenCalledWith("/tasks?task=t1");
  });
});
