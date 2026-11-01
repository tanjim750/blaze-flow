import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }) }));

import { CommandPalette } from "./command-palette";

const workspace = { id: "w1", dashboard_role: "owner", my_membership_id: "m1", billing: { view: true } } as never;

describe("CommandPalette", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.localStorage.clear();
    push.mockReset();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      query: "spring", role: "owner",
      groups: [{ key: "projects", label: "Projects", items: [{ id: "p1", title: "Spring Launch", subtitle: "Northlight", href: "/projects?campaign=p1", meta: "" }] }],
    }))));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("opens on ⌘K, searches after the debounce, highlights, and opens the chosen row with Enter", async () => {
    render(<CommandPalette workspace={workspace} />);
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    const input = await screen.findByRole("combobox", { name: "Quick search" });
    expect(screen.getByText("Quick actions")).toBeTruthy();
    fireEvent.change(input, { target: { value: "spring" } });
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String((fetch as unknown as { mock: { calls: string[][] } }).mock.calls[0][0])).toContain("/api/workspaces/w1/search/?q=spring");
    const option = await screen.findByRole("option", { name: /Spring Launch/ });
    expect(option.querySelector("mark")?.textContent).toBe("Spring");
    expect(option.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/projects?campaign=p1");
    expect(JSON.parse(window.localStorage.getItem("bf-quick-search-recent:w1")!)[0].title).toBe("Spring Launch");
  });

  it("moves through rows with the arrow keys and wraps around", async () => {
    render(<CommandPalette workspace={workspace} />);
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    const input = await screen.findByRole("combobox", { name: "Quick search" });
    const options = screen.getAllByRole("option");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options[1].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(screen.getAllByRole("option").at(-1)!.getAttribute("aria-selected")).toBe("true");
  });
  it("hides Recent as soon as one character is typed (M9: no flash back to Recent)", async () => {
    window.localStorage.setItem("bf-quick-search-recent:w1", JSON.stringify([{ id: "p1", title: "Spring Launch", href: "/projects?campaign=p1", group: "recent" }]));
    render(<CommandPalette workspace={workspace} />);
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    const input = await screen.findByRole("combobox", { name: "Quick search" });
    await screen.findByText("Recent");
    fireEvent.change(input, { target: { value: "s" } });
    expect(screen.queryByText("Recent")).toBeNull();
    expect((input as HTMLInputElement).value).toBe("s");
  });
});
