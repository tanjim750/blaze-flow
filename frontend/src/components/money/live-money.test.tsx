import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveMoney } from "./live-money";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const success = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...args: unknown[]) => success(...args) } }));

const paid = { id: "p1", kind: "payment_received", amount: "500.00", currency: "GBP", client: "Northlight Coffee", invoice_number: "INV-0012", invoice_id: "i1", provider: "stripe", created_at: "" };
let answers: { status: number; body?: unknown }[] = [];
const fetchMock = vi.fn(async () => {
  const next = answers.length > 1 ? answers.shift()! : answers[0];
  return { ok: next.status < 400, status: next.status, json: async () => next.body } as Response;
});
let visibility: "visible" | "hidden" = "visible";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  visibility = "visible";
  refresh.mockReset(); success.mockReset(); fetchMock.mockClear();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

describe("LiveMoney", () => {
  it("refreshes and toasts when a payment lands, and not before", async () => {
    answers = [{ status: 200, body: { version: "a", scope: "workspace", latest: null } }, { status: 200, body: { version: "a", scope: "workspace", latest: null } },
      { status: 200, body: { version: "b", scope: "workspace", latest: paid } }];
    render(<LiveMoney workspaceId="w1" intervalMs={1000} />);
    await tick(0);
    expect(fetchMock).toHaveBeenCalledWith("/api/workspaces/w1/billing/money-version/", expect.objectContaining({ cache: "no-store" }));
    await tick(1000);
    expect(refresh).not.toHaveBeenCalled();
    await tick(1000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledWith("Payment received: £500.00 from Northlight Coffee for INV-0012", { id: "money-p1" });
  });

  it("does not poll while the tab is hidden and catches up when it is shown", async () => {
    answers = [{ status: 200, body: { version: "a", scope: "own", latest: null } }];
    render(<LiveMoney workspaceId="w1" intervalMs={1000} />);
    await tick(0);
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    const calls = fetchMock.mock.calls.length;
    await tick(5000);
    expect(fetchMock.mock.calls.length).toBe(calls);
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await tick(0);
    expect(fetchMock.mock.calls.length).toBe(calls + 1);
  });

  it("stops asking when the viewer has no money here", async () => {
    answers = [{ status: 403 }];
    render(<LiveMoney workspaceId="w1" intervalMs={1000} />);
    await tick(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
