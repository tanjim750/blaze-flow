import { choose } from "@/test/choose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const api = vi.fn();
const refresh = vi.fn();
vi.mock("@/components/tasks/tasks-api", () => ({ api: (...args: unknown[]) => api(...args) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

import type { LocalGateway } from "@/lib/payment-gateways";
import { CountrySettingsForm, PaymentGatewaysCard } from "./billing-currency";
import { LocalGatewayCard } from "./local-gateway-card";

afterEach(() => { cleanup(); api.mockReset(); });

const paymongo: LocalGateway = {
  key: "paymongo", name: "PayMongo", description: "Cards, GCash, Maya and more in the Philippines.", status: "available", kind: "merchant_keys", recommended: true,
  countries: ["PH"], currencies: ["PHP"], methods: ["Cards", "GCash", "Maya"], features: [], docs_url: "https://developers.paymongo.com", signup_url: "https://dashboard.paymongo.com/signup",
  keys_help: "Developers → API keys.", webhook_help: "Add it under Developers → Webhooks.", webhook_in_dashboard: true, min_amount: "20", max_amount: null,
  fields: [
    { name: "public_key", label: "Public key", secret: false, required: true, help: "", placeholder: "pk_test_…" },
    { name: "secret_key", label: "Secret key", secret: true, required: true, help: "", placeholder: "sk_test_…" },
    { name: "webhook_secret", label: "Webhook signing secret", secret: true, required: false, help: "", placeholder: "whsk_…" },
  ],
  supports_workspace_currency: true, encryption_configured: true, connected: false, enabled: false, mode: "sandbox", connection_status: "not_connected",
  status_message: "", last_tested_at: null, credentials: {}, webhook_url: null,
};
const savedKeys: LocalGateway = { ...paymongo, connected: true, connection_status: "untested", credentials: { public_key: "pk_test_abc", secret_key: "••••1234" }, webhook_url: "https://api.example.com/api/payments/paymongo/webhook/c1/" };

describe("LocalGatewayCard", () => {
  it("saves keys with the chosen mode and never pre-fills secrets", async () => {
    api.mockResolvedValue(savedKeys);
    render(<LocalGatewayCard workspaceId="w" initial={paymongo} canManage workspaceCurrency="PHP" />);
    expect(screen.getByText("Recommended")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Set up PayMongo/ }));
    fireEvent.change(screen.getByLabelText(/Public key/), { target: { value: "pk_test_abc" } });
    fireEvent.change(screen.getByLabelText(/^Secret key/), { target: { value: "sk_test_xyz1234" } });
    fireEvent.click(screen.getByRole("button", { name: /Save keys/ }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("workspaces/w/billing/gateways/paymongo/", "PUT", { mode: "sandbox", credentials: { public_key: "pk_test_abc", secret_key: "sk_test_xyz1234" } }));
    await screen.findByText("Keys saved · not tested");
    const secret = screen.getByLabelText(/^Secret key/) as HTMLInputElement;
    expect(secret.value).toBe("");
    expect(secret.type).toBe("password");
    expect(secret.placeholder).toContain("••••1234");
    expect(screen.getByText(savedKeys.webhook_url!)).toBeInTheDocument();
  });
  it("tests the connection, then lets the owner switch it on", async () => {
    api.mockResolvedValueOnce({ ...savedKeys, connection_status: "connected", last_tested_at: "2026-10-27T10:00:00Z" });
    render(<LocalGatewayCard workspaceId="w" initial={savedKeys} canManage workspaceCurrency="PHP" />);
    expect(screen.getByText(/Test the connection to switch PayMongo on/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Test connection/ }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("workspaces/w/billing/gateways/paymongo/test/", "POST"));
    await screen.findByText("Connected · off");
    api.mockResolvedValueOnce({ ...savedKeys, connection_status: "connected", enabled: true });
    fireEvent.click(screen.getByRole("switch", { name: /Accept payments with PayMongo/ }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("workspaces/w/billing/gateways/paymongo/enable/", "POST", { enabled: true }));
    await screen.findByText("Sandbox · on");
  });
  it("shows a failed test's reason", () => {
    render(<LocalGatewayCard workspaceId="w" initial={{ ...savedKeys, connection_status: "failed", status_message: "PayMongo rejected the secret key." }} canManage workspaceCurrency="PHP" />);
    expect(screen.getByText("PayMongo rejected the secret key.")).toBeInTheDocument();
  });
  it("warns when the workspace currency doesn't match", () => {
    render(<LocalGatewayCard workspaceId="w" initial={{ ...paymongo, supports_workspace_currency: false }} canManage workspaceCurrency="USD" />);
    expect(screen.getByText(/PayMongo only takes PHP\. Invoices in USD won't offer it/)).toBeInTheDocument();
  });
  it("blocks saving keys until the server has an encryption key", () => {
    render(<LocalGatewayCard workspaceId="w" initial={{ ...paymongo, encryption_configured: false }} canManage workspaceCurrency="PHP" />);
    expect(screen.getByText(/GATEWAY_ENCRYPTION_KEY/)).toBeInTheDocument();
  });
  it("is read-only for members", () => {
    render(<LocalGatewayCard workspaceId="w" initial={savedKeys} canManage={false} workspaceCurrency="PHP" />);
    expect(screen.queryByRole("button", { name: /Edit keys/ })).toBeNull();
    expect(screen.getByText(/Only workspace owners and admins/)).toBeInTheDocument();
  });
});

describe("PaymentGatewaysCard with local gateways", () => {
  it("renders recommended local gateways and keeps PayPal coming soon", () => {
    render(<PaymentGatewaysCard workspaceId="w" canManage workspaceCurrency="PHP" gateways={[
      paymongo, { ...paymongo, key: "safepay", name: "Safepay", recommended: false, countries: ["PK"], currencies: ["PKR"], supports_workspace_currency: false },
      { key: "paypal", name: "PayPal", description: "Wallet", connected: false, status: "coming_soon", features: [], supports_workspace_currency: true },
    ]} />);
    expect(screen.getByRole("region", { name: "PayMongo" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Safepay" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Coming soon" })).toBeDisabled();
  });
});

describe("CountrySettingsForm", () => {
  it("shows the recommendation and saves the country", async () => {
    api.mockResolvedValue({ currency: "PHP", payment_terms_days: 14, invoice_prefix: "INV", country: "PK" });
    render(<CountrySettingsForm workspaceId="w" initial={{ currency: "PHP", payment_terms_days: 14, invoice_prefix: "INV", country: "PH", effective_country: "PH", recommended_gateways: ["paymongo"] }} canEdit />);
    expect(screen.getByText(/Recommended for Philippines: PayMongo/)).toBeInTheDocument();
    choose(screen.getByRole("combobox", { name: "Business country" }), /Pakistan \(PK\)/);
    fireEvent.click(screen.getByRole("button", { name: /Save country/ }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("workspaces/w/billing/settings/", "PATCH", { country: "PK" }));
  });
});
