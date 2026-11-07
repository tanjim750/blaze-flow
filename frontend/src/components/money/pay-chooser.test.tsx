import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const api = vi.fn();
vi.mock("@/components/tasks/tasks-api", () => ({ api: (...args: unknown[]) => api(...args) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { goTo } from "@/lib/stripe-connect";
import { paymentReturn } from "@/lib/payment-gateways";
import { PublicPayView, type PublicInvoice } from "@/app/pay/[token]/pay-view";

const assign = vi.spyOn(goTo, "url").mockImplementation(() => {});
afterEach(() => { cleanup(); api.mockReset(); assign.mockClear(); });

const address = { name: "Acme", email: null, address_line_1: null, address_line_2: null, city: null, region: null, postal_code: null, country_code: null };
const invoice = {
  id: "i", number: "INV-0009", status: "sent", display_status: "sent", currency: "PHP", client: { id: "c", name: "Acme" }, project: null,
  issue_date: "2026-10-01", due_date: null, sent_at: null, paid_at: null, total: "5000.00", paid: "0.00", outstanding: "5000.00", created_at: "2026-10-01",
  notes: "", lines: [], payments: [], bill_to: address, from: { ...address, name: "Manila Cuts" }, studio_name: "Manila Cuts",
  online_payment: { provider: "stripe", available: true, reason: null },
  payment_options: [
    { provider: "stripe", name: "Stripe", available: true, reason: null },
    { provider: "paymongo", name: "PayMongo", available: true, reason: null, methods: ["Cards", "GCash"], sandbox: true },
    { provider: "safepay", name: "Safepay", available: false, reason: "currency_unsupported", message: "Safepay only takes PKR." },
  ],
} as unknown as PublicInvoice;

describe("Pay now chooser", () => {
  it("lets the payer pick a gateway and checks out with it", async () => {
    api.mockResolvedValue({ url: "https://checkout.paymongo.com/cs_1" });
    render(<PublicPayView token="tok" invoice={invoice} back={null} />);
    expect(screen.getByText("Safepay only takes PKR.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Safepay/ })).toBeDisabled();
    expect(screen.getByText("Test mode")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /PayMongo/ }));
    fireEvent.click(screen.getByRole("button", { name: /Pay .* now with PayMongo/ }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("public/pay/tok/checkout/", "POST", { provider: "paymongo" }));
    expect(assign).toHaveBeenCalledWith("https://checkout.paymongo.com/cs_1");
  });
  it("hides the chooser when only one gateway can take the invoice", () => {
    render(<PublicPayView token="tok" invoice={{ ...invoice, payment_options: invoice.payment_options!.slice(0, 1) }} back={null} />);
    expect(screen.queryByRole("radio")).toBeNull();
  });
  it("explains a failed local payment", () => {
    render(<PublicPayView token="tok" invoice={invoice} back="fail" provider="sslcommerz" />);
    expect(screen.getByText(/SSLCOMMERZ couldn.t complete the payment/)).toBeInTheDocument();
  });
  it("reads payment= and stripe= return params", () => {
    expect(paymentReturn({ payment: "fail", provider: "safepay" })).toBe("fail");
    expect(paymentReturn({ stripe: "success" })).toBe("success");
    expect(paymentReturn({ payment: "weird" })).toBeNull();
  });
});
