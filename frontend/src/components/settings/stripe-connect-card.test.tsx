import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const api = vi.fn();
vi.mock("@/components/tasks/tasks-api", () => ({ api: (...args: unknown[]) => api(...args) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

import { goTo, type StripeStatus } from "@/lib/stripe-connect";
import { StripeConnectCard } from "./stripe-connect-card";

const assign = vi.spyOn(goTo, "url").mockImplementation(() => {});
afterEach(() => { cleanup(); api.mockReset(); assign.mockClear(); window.history.replaceState(null, "", "/settings"); });

const base: StripeStatus = {
  configured: true, not_configured_message: null, connected: false, can_manage: true, platform_fee_percent: "0",
  status: "not_connected", charges_enabled: false, payouts_enabled: false, details_submitted: false, requirements_due: [],
  disabled_reason: "", account_id: null, country: "", default_currency: "", last_synced_at: null,
};

describe("StripeConnectCard", () => {
  it("says when the server has no Stripe keys", () => {
    render(<StripeConnectCard workspaceId="w" initial={{ ...base, configured: false, not_configured_message: "Stripe not configured on this server." }} />);
    expect(screen.getByText("Stripe not configured on this server.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Connect Stripe/ })).toBeNull();
  });
  it("starts onboarding and sends the owner to Stripe", async () => {
    api.mockResolvedValue({ ...base, connected: true, status: "onboarding", url: "https://connect.stripe.com/setup/x" });
    render(<StripeConnectCard workspaceId="w" initial={base} />);
    fireEvent.click(screen.getByRole("button", { name: /Connect Stripe/ }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://connect.stripe.com/setup/x"));
    expect(api).toHaveBeenCalledWith("workspaces/w/billing/stripe/connect/", "POST");
  });
  it("shows an active account with dashboard and disconnect", async () => {
    const active = { ...base, connected: true, status: "active" as const, charges_enabled: true, payouts_enabled: true, details_submitted: true, account_id: "…ct_123", country: "GB", default_currency: "gbp", platform_fee_percent: "1" };
    render(<StripeConnectCard workspaceId="w" initial={active} />);
    expect(screen.getByRole("status")).toHaveTextContent("Active");
    expect(screen.getByText(/Payments enabled/)).toBeInTheDocument();
    expect(screen.getByText(/1% platform fee/)).toBeInTheDocument();
    api.mockResolvedValue({ url: "https://connect.stripe.com/express/abc" });
    fireEvent.click(screen.getByRole("button", { name: /Open Stripe dashboard/ }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://connect.stripe.com/express/abc"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    api.mockResolvedValue(base);
    fireEvent.click(screen.getByRole("button", { name: /Disconnect/ }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Not connected"));
  });
  it("refreshes the status when coming back from Stripe", async () => {
    window.history.replaceState(null, "", "/settings?stripe=return#billing");
    api.mockResolvedValue({ ...base, connected: true, status: "pending", details_submitted: true });
    render(<StripeConnectCard workspaceId="w" initial={{ ...base, connected: true, status: "onboarding" }} />);
    await waitFor(() => expect(api).toHaveBeenCalledWith("workspaces/w/billing/stripe/?refresh=1"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Pending review"));
    expect(window.location.search).toBe("");
  });
  it("gets a fresh onboarding link when Stripe's one expired", async () => {
    window.history.replaceState(null, "", "/settings?stripe=refresh");
    api.mockResolvedValue({ ...base, connected: true, status: "onboarding", url: "https://connect.stripe.com/setup/new" });
    render(<StripeConnectCard workspaceId="w" initial={{ ...base, connected: true, status: "onboarding" }} />);
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://connect.stripe.com/setup/new"));
  });
  it("is read-only for people who can't manage billing", () => {
    render(<StripeConnectCard workspaceId="w" initial={{ ...base, can_manage: false, connected: true, status: "needs_info", requirements_due: ["external_account"] }} />);
    expect(screen.getByText(/Only workspace owners and admins/)).toBeInTheDocument();
    expect(screen.getByText(/external account/)).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
