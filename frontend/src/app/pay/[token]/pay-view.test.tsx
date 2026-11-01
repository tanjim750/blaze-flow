import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const api = vi.fn();
const refresh = vi.fn();
vi.mock("@/components/tasks/tasks-api", () => ({ api: (...args: unknown[]) => api(...args) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { goTo } from "@/lib/stripe-connect";
import { PublicPayView, type PublicInvoice } from "./pay-view";

const assign = vi.spyOn(goTo, "url").mockImplementation(() => {});
afterEach(() => { cleanup(); api.mockReset(); assign.mockClear(); });

const address = { name: "Acme Ltd", email: null, address_line_1: null, address_line_2: null, city: null, region: null, postal_code: null, country_code: null };
const invoice = {
  id: "i", number: "INV-0007", status: "sent", display_status: "sent", currency: "GBP", client: { id: "c", name: "Acme Ltd" }, project: null,
  issue_date: "2026-10-01", due_date: "2026-10-31", sent_at: null, paid_at: null, total: "1250.00", paid: "0.00", outstanding: "1250.00", created_at: "2026-10-01",
  notes: "", lines: [{ id: "l", kind: "manual", description: "Edit — Episode 4", amount: "1250.00", task_id: null }], payments: [], bill_to: address, from: { ...address, name: "Nova Studio" },
  studio_name: "Nova Studio", online_payment: { provider: "stripe", available: true, reason: null },
} as unknown as PublicInvoice;

describe("PublicPayView", () => {
  it("opens Stripe Checkout for the balance", async () => {
    api.mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/cs_1" });
    render(<PublicPayView token="tok" invoice={invoice} back={null} />);
    fireEvent.click(screen.getByRole("button", { name: /Pay £1,250.00 now/ }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_1"));
    expect(api).toHaveBeenCalledWith("public/pay/tok/checkout/", "POST");
  });
  it("thanks the payer once paid", () => {
    render(<PublicPayView token="tok" invoice={{ ...invoice, status: "paid", paid: "1250.00", outstanding: "0.00" }} back="success" />);
    expect(screen.getByText(/Payment received/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("says a cancelled checkout charged nothing", () => {
    render(<PublicPayView token="tok" invoice={invoice} back="cancel" />);
    expect(screen.getByText(/Nothing was charged/)).toBeInTheDocument();
  });
  it("explains unsupported currencies instead of a button", () => {
    render(<PublicPayView token="tok" invoice={{ ...invoice, currency: "KWD", online_payment: { provider: "stripe", available: false, reason: "currency_unsupported", message: "Stripe can’t take payments in KWD." } }} back={null} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/KWD/, { selector: "p" })).toBeInTheDocument();
  });
});
