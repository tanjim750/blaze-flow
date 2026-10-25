import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { RECONNECT_DELAYS_MS, ShellReconnect } from "./shell-reconnect";

describe("ShellReconnect", () => {
  beforeEach(() => { vi.useFakeTimers(); refresh.mockReset(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("re-renders the shell automatically with backoff, then stops", async () => {
    render(<ShellReconnect />);
    expect(screen.getByRole("status").textContent).toContain("Can’t reach Blaze Flow");
    for (const delay of RECONNECT_DELAYS_MS) await act(async () => { vi.advanceTimersByTime(delay); });
    expect(refresh).toHaveBeenCalledTimes(RECONNECT_DELAYS_MS.length);
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(refresh).toHaveBeenCalledTimes(RECONNECT_DELAYS_MS.length);
    expect(screen.getByRole("status").textContent).toContain("Try again in a moment");
  });

  it("retries straight away on click", async () => {
    render(<ShellReconnect />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /retry/i })); });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
