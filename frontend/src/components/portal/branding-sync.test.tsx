import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { BrandingSync, announceBrandingChange } from "./branding-sync";

afterEach(() => { cleanup(); refresh.mockReset(); });

describe("BrandingSync (R7)", () => {
  it("refreshes the portal page when branding is saved in another tab", async () => {
    render(<BrandingSync workspaceId="w1" />);
    announceBrandingChange("w1");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("ignores saves for a different workspace", async () => {
    render(<BrandingSync workspaceId="w1" />);
    announceBrandingChange("w2");
    await new Promise((r) => setTimeout(r, 50));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes when the tab becomes visible again", () => {
    render(<BrandingSync />);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(refresh).toHaveBeenCalled();
  });
});
