import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/app/(app)/review/actions", () => ({ createGuestInviteAction: vi.fn() }));
import { ShareModal } from "./share-modal";
import { guestLinkExpiryDate } from "@/app/(app)/review/guest-presets";

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

describe("ShareModal expiry", () => {
  it("shows the 90-day cap, and the exact date once an expiry is picked", () => {
    render(<ShareModal open onOpenChange={() => {}} title="cut.mp4" internalUrl="/x" workspaceId="w" projectId="p" canCreateLinks />);
    fireEvent.click(screen.getByRole("radio", { name: /public/i }));
    expect(screen.getByTestId("share-expiry").textContent).toContain(`90 days at most (${guestLinkExpiryDate(90)})`);
    fireEvent.click(screen.getByRole("switch", { name: /link expires/i }));
    expect(screen.getByTestId("share-expiry").textContent).toContain(`stops working on ${guestLinkExpiryDate(7)}`);
  });
});

describe("guestLinkExpiryDate", () => {
  it("formats now + days as YYYY-MM-DD", () => {
    expect(guestLinkExpiryDate(90, Date.parse("2026-01-01T12:00:00Z"))).toBe("2026-04-01");
  });
});
