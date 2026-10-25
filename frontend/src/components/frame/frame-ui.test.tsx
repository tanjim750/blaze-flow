import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SelectionBar, StackedFolder } from "./frame-ui";
import { presetFor } from "./share-modal";

vi.mock("@/app/(app)/review/actions", () => ({ createGuestInviteAction: vi.fn() }));

describe("StackedFolder", () => {
  it("is a plain folder when empty", () => {
    const { container } = render(<StackedFolder previews={[]} />);
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.querySelector(".frm-folder-shape")).not.toBeNull();
  });
  it("stacks at most three previews back to front", () => {
    const previews = ["1", "2", "3", "4"].map((id) => ({ id, src: `/p/${id}.jpg` }));
    const { container } = render(<StackedFolder previews={previews} />);
    const layers = [...container.querySelectorAll("img")].map((img) => img.className);
    expect(layers).toEqual(["frm-folder-thumb is-back", "frm-folder-thumb is-mid", "frm-folder-thumb is-front"]);
  });
});

describe("SelectionBar", () => {
  it("hides with nothing selected and offers copy, download and clear", () => {
    const { rerender } = render(<SelectionBar count={0} onClear={() => {}} />);
    expect(screen.queryByRole("region", { name: "Selection" })).toBeNull();
    const onClear = vi.fn(); const onCopyLink = vi.fn(); const onDownload = vi.fn();
    rerender(<SelectionBar count={2} onClear={onClear} onCopyLink={onCopyLink} onDownload={onDownload} />);
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Copy link/ })); fireEvent.click(screen.getByRole("button", { name: /Download/ })); fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect([onCopyLink, onDownload, onClear].map((fn) => fn.mock.calls.length)).toEqual([1, 1, 1]);
  });
});

describe("share presets", () => {
  it("maps toggles onto guest presets", () => {
    expect(presetFor(false, false)).toBe("view");
    expect(presetFor(true, false)).toBe("comment");
    expect(presetFor(false, true)).toBe("review");
  });
});
