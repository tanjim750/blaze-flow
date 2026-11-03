import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/review/actions", () => ({ createGuestInviteAction: vi.fn(async (state: unknown) => state) }));
import { ShareModal } from "./share-modal";
import { invitePermissions } from "@/app/(app)/review/guest-presets";

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

describe("share modal approvals", () => {
  afterEach(() => cleanup());

  it("includes approvals by default and lets the owner turn them off", () => {
    render(<ShareModal open onOpenChange={() => {}} title="hero.mp4" internalUrl="/x" workspaceId="w" projectId="p" canCreateLinks />);
    fireEvent.click(screen.getByRole("radio", { name: /Public/ }));
    const hidden = () => document.querySelector<HTMLInputElement>('input[name="allowDecisions"]')!;
    expect(hidden().value).toBe("on");
    fireEvent.click(screen.getByRole("switch", { name: "Allow approvals" }));
    expect(hidden().value).toBe("off");
  });

  it("the comment preset lets guests draw, and approvals add the decision key", () => {
    const keys = invitePermissions("comment", true);
    expect(keys).toEqual(expect.arrayContaining(["annotation.create", "annotation.edit", "annotation.delete", "review.decision.create"]));
    expect(invitePermissions("view", true)).not.toContain("annotation.create");
  });
});
