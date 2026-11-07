import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { saveNavOrderAction } = vi.hoisted(() => ({
  saveNavOrderAction: vi.fn(async (order: string[] | null) => ({ error: null, message: "Saved.", order: order ?? ["files", "projects", "tasks", "chat", "clients", "team", "money", "analytics"] })),
}));
vi.mock("@/app/(app)/settings/actions", () => ({ saveNavOrderAction }));

import { NavOrderForm } from "./nav-order";

afterEach(() => { cleanup(); saveNavOrderAction.mockClear(); });
const rows = () => screen.getAllByRole("listitem").map((li) => li.querySelector("strong")!.textContent);

describe("NavOrderForm", () => {
  it("moves an item with the keyboard and saves the new order", async () => {
    render(<NavOrderForm initial={[]} canEdit />);
    expect(rows()[0]).toBe("Projects");
    const handle = screen.getByRole("button", { name: /^Analytics, position 7/ });
    fireEvent.keyDown(handle, { key: "Home" });
    expect(rows()[0]).toBe("Analytics");
    fireEvent.keyDown(screen.getByRole("button", { name: /^Analytics, position 1/ }), { key: "ArrowDown" });
    expect(rows().slice(0, 2)).toEqual(["Projects", "Analytics"]);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save order" })); });
    expect(saveNavOrderAction).toHaveBeenCalledWith(["projects", "analytics", "tasks", "chat", "clients", "team", "money"]);
  });
  it("resets to the default order", async () => {
    render(<NavOrderForm initial={["money", "files"]} canEdit />);
    expect(rows()[0]).toBe("Money");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Reset to default/ })); });
    expect(saveNavOrderAction).toHaveBeenCalledWith(null);
    await waitFor(() => expect(rows()[0]).toBe("Projects"));
  });
  it("is read-only for anyone but the owner", () => {
    render(<NavOrderForm initial={[]} canEdit={false} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/Only the workspace owner/)).toBeTruthy();
  });
});
