import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = { replace: vi.fn(), refresh: vi.fn() };
const action = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("./actions", () => ({
  createWorkspaceAction: (...args: unknown[]) => action(...args),
  resendOnboardingVerificationAction: vi.fn(),
}));

const { OnboardingForm, HARD_NAVIGATION_FALLBACK_MS } = await import("./form");
const assign = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("location", { ...window.location, pathname: "/onboarding", assign });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

async function submit(name = "Jacobie") {
  render(<OnboardingForm verified email="j@example.com" defaultTimezone="UTC" />);
  fireEvent.change(screen.getByPlaceholderText("Northstar Studio"), { target: { value: name } });
  await act(async () => { fireEvent.submit(screen.getByRole("button", { name: "Create workspace" }).closest("form")!); });
}

describe("OnboardingForm", () => {
  it("leaves onboarding after a create and locks the button so it can't be sent twice", async () => {
    action.mockResolvedValue({ error: null, message: "Workspace created. Opening your dashboard…", redirectTo: "/" });
    await submit();
    expect(router.replace).toHaveBeenCalledWith("/");
    expect(router.refresh).toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Workspace created");
    expect(screen.getByRole("button", { name: "Opening dashboard…" })).toBeDisabled();
  });

  it("falls back to a full page load when the soft navigation is bounced back to onboarding", async () => {
    vi.useFakeTimers();
    action.mockResolvedValue({ error: null, message: "ok", redirectTo: "/" });
    await submit();
    await act(async () => { vi.advanceTimersByTime(HARD_NAVIGATION_FALLBACK_MS); });
    expect(assign).toHaveBeenCalledWith("/");
  });

  it("keeps the form usable after a real error", async () => {
    action.mockResolvedValue({ error: "This workspace slug is already in use.", message: null });
    await submit();
    expect(screen.getByRole("alert")).toHaveTextContent("slug is already in use");
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Create workspace" })).toBeEnabled();
  });
});
