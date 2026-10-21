import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach } from "vitest";
afterEach(cleanup);

const setStatus = vi.fn();
vi.mock("@/app/(app)/projects/actions", () => ({ setProjectStatusAction: (...args: unknown[]) => setStatus(...args) }));

import { ArchivePicker, OpenProjectsContext } from "./archive-picker";

const projects = [
  { id: "a", name: "Launch film", client: "Acme", status: "ACTIVE" },
  { id: "b", name: "Old promo", client: "Acme", status: "COMPLETED" },
];

describe("ArchivePicker", () => {
  it("lists finished projects first and archives the chosen one", async () => {
    setStatus.mockResolvedValue({ error: null, savedAt: 1 });
    const onArchived = vi.fn();
    render(<OpenProjectsContext.Provider value={projects}><ArchivePicker onArchived={onArchived} /></OpenProjectsContext.Provider>);
    const names = screen.getAllByRole("listitem").map((li) => li.querySelector("strong")?.textContent);
    expect(names).toEqual(["Old promo", "Launch film"]);
    fireEvent.click(screen.getByRole("button", { name: "Archive Old promo" }));
    await waitFor(() => expect(onArchived).toHaveBeenCalledWith(projects[1]));
    expect(setStatus).toHaveBeenCalledWith("b", "ARCHIVED");
  });

  it("shows the error and keeps the list when archiving fails", async () => {
    setStatus.mockResolvedValue({ error: "Nope.", savedAt: null });
    const onArchived = vi.fn();
    render(<OpenProjectsContext.Provider value={projects}><ArchivePicker onArchived={onArchived} /></OpenProjectsContext.Provider>);
    fireEvent.click(screen.getByRole("button", { name: "Archive Launch film" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nope.");
    expect(onArchived).not.toHaveBeenCalled();
  });

  it("says so when there is nothing to archive", () => {
    render(<ArchivePicker onArchived={() => {}} />);
    expect(screen.getByText(/no open projects/i)).toBeInTheDocument();
  });
});
