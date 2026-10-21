import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useEscapeKey } from "./use-escape";

function Probe({ onEscape, enabled = true }: { onEscape: () => void; enabled?: boolean }) { useEscapeKey(onEscape, enabled); return <button>inside</button>; }
afterEach(cleanup);

describe("useEscapeKey", () => {
  it("fires even when focus is on <body> (after a submit disabled the focused button)", () => {
    const onEscape = vi.fn();
    render(<Probe onEscape={onEscape} />);
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });
  it("ignores other keys, disabled state and handled events", () => {
    const onEscape = vi.fn();
    const { rerender } = render(<Probe onEscape={onEscape} enabled={false} />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    rerender(<Probe onEscape={onEscape} />);
    fireEvent.keyDown(document.body, { key: "Enter" });
    const handled = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true });
    handled.preventDefault();
    document.dispatchEvent(handled);
    expect(onEscape).not.toHaveBeenCalled();
  });
});
