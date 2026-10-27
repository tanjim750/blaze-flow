import { choose } from "@/test/choose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const api = vi.fn();
const refresh = vi.fn();
vi.mock("@/components/tasks/tasks-api", () => ({ api: (...args: unknown[]) => api(...args) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

import { CurrencySettingsForm, PaymentGatewaysCard } from "./billing-currency";

afterEach(() => { cleanup(); api.mockReset(); refresh.mockReset(); });
const initial = { currency: "GBP", payment_terms_days: 14, invoice_prefix: "INV" };

describe("CurrencySettingsForm", () => {
  it("previews and saves a new workspace currency", async () => {
    api.mockResolvedValue({ ...initial, currency: "BDT" });
    render(<CurrencySettingsForm workspaceId="w" initial={initial} canEdit />);
    expect(screen.getByText("£1,250.50")).toBeInTheDocument();
    choose(screen.getByRole("combobox", { name: "Workspace currency" }), /BDT — Bangladeshi Taka/);
    expect(screen.getByText("৳1,250.50")).toBeInTheDocument();
    expect(screen.getByText(/Amounts are not converted/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Save currency/ }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("workspaces/w/billing/settings/", "PATCH", { currency: "BDT" }));
    expect(refresh).toHaveBeenCalled();
  });
  it("is read-only for members who can't change it", () => {
    render(<CurrencySettingsForm workspaceId="w" initial={initial} canEdit={false} />);
    expect(screen.queryByRole("button", { name: /Save currency/ })).toBeNull();
    expect(screen.getByText(/Only workspace owners and admins/)).toBeInTheDocument();
  });
});

describe("PaymentGatewaysCard", () => {
  it("shows Stripe as live and keeps the others coming soon", () => {
    render(<PaymentGatewaysCard workspaceId="w" stripe={{ configured: true, not_configured_message: null, connected: false, can_manage: true, platform_fee_percent: "0", status: "not_connected", charges_enabled: false, payouts_enabled: false, details_submitted: false, requirements_due: [], disabled_reason: "", account_id: null, country: "", default_currency: "", last_synced_at: null }} gateways={[
      { key: "stripe", name: "Stripe", description: "Cards", connected: false, status: "available", features: [], supports_workspace_currency: true },
      { key: "paypal", name: "PayPal", description: "Wallet", connected: false, status: "coming_soon", features: [], supports_workspace_currency: true },
    ]} />);
    expect(screen.getByRole("button", { name: /Connect Stripe/ })).toBeEnabled();
    expect(screen.getAllByRole("button", { name: /Coming soon/ })).toHaveLength(1);
  });
  it("without Stripe status, lists every gateway as disabled", () => {
    render(<PaymentGatewaysCard gateways={[
      { key: "stripe", name: "Stripe", description: "Cards", connected: false, status: "coming_soon", features: [], supports_workspace_currency: true },
      { key: "sslcommerz", name: "SSLCommerz", description: "Bangladesh", connected: false, status: "coming_soon", features: [], supports_workspace_currency: false },
    ]} />);
    const buttons = screen.getAllByRole("button", { name: /Coming soon/ });
    expect(buttons).toHaveLength(2);
    buttons.forEach((button) => expect(button).toBeDisabled());
  });
});
