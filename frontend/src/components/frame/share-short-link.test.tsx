import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GuestInvite } from "@/lib/api";

const createGuestInviteAction = vi.fn();
vi.mock("@/app/(app)/review/actions", () => ({
  createGuestInviteAction: (...args: unknown[]) => createGuestInviteAction(...args),
  replaceGuestInviteAction: vi.fn(), revokeGuestAccessAction: vi.fn(),
  revokeGuestInviteAction: vi.fn(), setGuestInviteDecisionsAction: vi.fn(),
}));

import { ShareModal } from "./share-modal";
import { SharePanel } from "@/app/(app)/review/share-panel";

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const SHORT = "https://krewsys.com/r/Z70ayQFE";

describe("share dialogs show the short link", () => {
  it("file share window: a new public link is the short URL, not ?token=", async () => {
    createGuestInviteAction.mockResolvedValue({ error: null, token: "t".repeat(43), inviteId: "i1", mediaVersionId: "m1", shortUrl: SHORT });
    render(<ShareModal open onOpenChange={() => {}} title="Cut.mp4" internalUrl="/files/1" workspaceId="w" projectId="p" assetFileId="f" canCreateLinks />);
    fireEvent.click(screen.getByRole("radio", { name: /public/i }));
    const form = document.querySelector("form.frm-share-form") as HTMLFormElement;
    await act(async () => { fireEvent.submit(form); });
    await waitFor(() => expect((screen.getByLabelText("Share link") as HTMLInputElement).value).toBe(SHORT));
    expect((screen.getByLabelText("Share link") as HTMLInputElement).value).not.toContain("token");
  });

  it("project share: every live link with a short code can be copied again", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const invite: GuestInvite = {
      id: "i1", project_id: "p", label: "Client", permissions: ["media.read"], expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      revoked_at: null, created_at: new Date().toISOString(), accesses: [], short_code: "Z70ayQFE", short_url: SHORT,
    };
    render(<SharePanel workspaceId="w" projectId="p" projectName="P" invites={[invite]} canManage onClose={() => {}} />);
    expect(screen.getByRole("link", { name: /open client/i }).getAttribute("href")).toBe(SHORT);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /copy client/i })); });
    expect(writeText).toHaveBeenCalledWith(SHORT);
  });
});
