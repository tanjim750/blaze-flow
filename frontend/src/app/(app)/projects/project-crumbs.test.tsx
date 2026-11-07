import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FILES_ROOT_EVENT } from "@/components/asset-library";
import { ProjectCrumbs } from "./project-crumbs";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
afterEach(() => cleanup());

describe("ProjectCrumbs", () => {
  it("links Projects and the client; the project is the current page", () => {
    render(<ProjectCrumbs client={{ id: "c 1", name: "Evan Lorezca" }} project={{ name: "Summer" }} inFolder={false} />);
    expect(screen.getByRole("link", { name: "Projects" })).toHaveAttribute("href", "/projects");
    expect(screen.getByRole("link", { name: "Evan Lorezca" })).toHaveAttribute("href", "/projects?client=c%201");
    const current = screen.getByText("Summer");
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current.tagName).toBe("SPAN");
  });

  it("inside a folder the project crumb is a focusable button back to the library root", () => {
    const toRoot = vi.fn();
    window.addEventListener(FILES_ROOT_EVENT, toRoot);
    render(<ProjectCrumbs client={null} project={{ name: "Summer" }} inFolder />);
    const button = screen.getByRole("button", { name: "Summer" });
    button.focus();
    expect(button).toHaveFocus();
    fireEvent.click(button);
    expect(toRoot).toHaveBeenCalledTimes(1);
    window.removeEventListener(FILES_ROOT_EVENT, toRoot);
  });
});
