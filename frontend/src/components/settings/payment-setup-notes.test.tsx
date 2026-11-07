import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const api = vi.fn();
const refresh = vi.fn();
vi.mock("@/components/tasks/tasks-api", () => ({ api: (...args: unknown[]) => api(...args) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

import type { LocalGateway, ManualGateway } from "@/lib/payment-gateways";
import { payHint } from "@/lib/payment-gateways";
import { PaymentGatewaysCard } from "./billing-currency";
import { PaymentSetupNote, PaymentsReadOnlyNote, SETUP_NOTES } from "./payment-setup-notes";

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

const paypal: LocalGateway = { ...paymongo, key: "paypal", name: "PayPal", recommended: false, group: "main", countries: [], unsupported_countries: ["BD", "PK"],
  currencies: ["USD", "EUR", "GBP", "AUD", "CAD", "JPY", "SGD"], methods: ["PayPal", "Cards"] };
const wise: ManualGateway = {
  key: "wise", name: "Wise", description: "Clients pay to your Wise account details.", status: "available", kind: "manual", group: "main", automatic: false,
  link_label: "Wise payment link", link_help: "Your Wise Quick Pay link.", details_help: "From Wise → Account details.", signup_url: "https://wise.com/business",
  docs_url: "https://wise.com/help", methods: ["Bank transfer", "Pay with Wise"], features: [], supports_workspace_currency: true, connected: false, enabled: false,
  payment_link: "", accounts: [], note: "",
};
const local = { ...paymongo, group: "local" as const };

const all = [paypal, wise, { ...wise, key: "payoneer", name: "Payoneer" }, local];

describe("payment setup notes", () => {
  it("shows the overview for owners and admins, with a collapsed note beside each option", () => {
    const { container } = render(<PaymentGatewaysCard workspaceId="w" canManage workspaceCurrency="USD" country="PH" gateways={all} />);
    const overview = screen.getByRole("note", { name: "How payments work" });
    expect(overview).toHaveTextContent(/Owners and admins set this up once/);
    expect(overview).toHaveTextContent(/Editors and members don.t need to do anything/);
    expect(overview).toHaveTextContent(/Clients pay from the link on their invoice/);
    const notes = [...container.querySelectorAll("details.setup-note")];
    expect(notes.map((note) => note.getAttribute("data-provider"))).toEqual(["paypal", "wise", "payoneer", "paymongo"]);
    notes.forEach((note) => expect(note).not.toHaveAttribute("open"));
  });
  it("expands to steps with sign-up links that open in a new tab", () => {
    render(<PaymentSetupNote provider="paypal" />);
    const summary = screen.getByText("How to set up PayPal");
    fireEvent.click(summary);
    expect(summary.closest("details")).toHaveAttribute("open");
    expect(screen.getByText(/Apps & Credentials/)).toBeInTheDocument();
    expect(screen.getAllByText(/Client ID/).length).toBeGreaterThan(0);
    const link = screen.getByRole("link", { name: /PayPal developer dashboard/ });
    expect(link).toHaveAttribute("href", "https://developer.paypal.com/dashboard/applications");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });
  it("explains the I've paid and confirm flow for Wise and Payoneer", () => {
    for (const provider of ["wise", "payoneer"]) {
      render(<PaymentSetupNote provider={provider} />);
      const note = document.querySelector(`details[data-provider="${provider}"]`)!;
      expect(note).toHaveTextContent(/I’ve paid/);
      expect(note).toHaveTextContent(/Confirm received/);
      cleanup();
    }
  });
  it("covers every option, each with an https sign-up link", () => {
    for (const key of ["stripe", "paypal", "wise", "payoneer", "paymongo", "safepay", "sslcommerz"]) {
      expect(SETUP_NOTES[key]?.steps.length).toBeGreaterThan(1);
      expect(SETUP_NOTES[key].links.every((link) => link.href.startsWith("https://"))).toBe(true);
    }
    render(<PaymentSetupNote provider="sslcommerz" />);
    expect(screen.getByText(/Store ID/, { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /SSLCOMMERZ sign-up/ })).toHaveAttribute("href", "https://signup.sslcommerz.com/register");
  });
  it("renders nothing for an option without notes", () => {
    const { container } = render(<PaymentSetupNote provider="razorpay" />);
    expect(container).toBeEmptyDOMElement();
  });
  it("shows editors and members a read-only note instead of setup steps", () => {
    const { container } = render(<PaymentGatewaysCard workspaceId="w" workspaceCurrency="USD" country="US" gateways={all} />);
    expect(screen.getByRole("note", { name: /managed by an owner or admin/ })).toHaveTextContent(/You don.t need to do anything here/);
    expect(screen.queryByRole("note", { name: "How payments work" })).toBeNull();
    expect(container.querySelector("details.setup-note")).toBeNull();
    cleanup();
    render(<PaymentsReadOnlyNote />);
    expect(screen.getByText("An owner or admin manages payments")).toBeInTheDocument();
  });
});

describe("payHint", () => {
  it("words the client hint for checkouts, transfers, or both", () => {
    expect(payHint([false])).toMatch(/secure checkout/);
    expect(payHint([true])).toMatch(/I’ve paid/);
    expect(payHint([false, true])).toMatch(/Choose how to pay/);
  });
});
