import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const api = vi.fn();
const refresh = vi.fn();
vi.mock("@/components/tasks/tasks-api", () => ({ api: (...args: unknown[]) => api(...args) }));
vi.mock("@/lib/app-router", () => ({ useAppRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

import { goTo } from "@/lib/stripe-connect";
import type { InvoiceDetail } from "@/lib/money-view";
import { InvoiceView } from "./invoice-view";

const assign = vi.spyOn(goTo, "url").mockImplementation(() => {});
afterEach(() => { cleanup(); api.mockReset(); assign.mockClear(); });

const address = { name: "Acme Ltd", email: null, address_line_1: null, address_line_2: null, city: null, region: null, postal_code: null, country_code: null };
const invoice = {
  id: "i", number: "INV-0007", status: "sent", display_status: "sent", currency: "GBP", client: { id: "c", name: "Acme Ltd" }, project: null,
  issue_date: "2026-10-01", due_date: "2026-10-31", sent_at: "2026-10-01", paid_at: null, total: "1250.00", paid: "0.00", outstanding: "1250.00", created_at: "2026-10-01",
  notes: "", lines: [{ id: "l", kind: "manual", description: "Edit", amount: "1250.00", task_id: null }], payments: [], bill_to: address, from: { ...address, name: "Nova" },
  online_payment: { provider: "stripe", available: true, reason: null },
} as unknown as InvoiceDetail;
const now = "2026-10-20T10:00:00Z";

describe("InvoiceView online payment", () => {
  it("gives the client a Pay now that opens Stripe Checkout", async () => {
    api.mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/cs_1" });
    render(<InvoiceView workspaceId="w" invoice={invoice} canManage={false} backHref="/" now={now} />);
    fireEvent.click(screen.getByRole("button", { name: /Pay now/ }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_1"));
    expect(api).toHaveBeenCalledWith("workspaces/w/billing/invoices/i/checkout/", "POST");
  });
  it("lets managers copy the pay link and explains a missing Pay now", () => {
    render(<InvoiceView workspaceId="w" invoice={{ ...invoice, pay_link: "https://app/pay/tok" }} canManage backHref="/money" now={now} />);
    expect(screen.getAllByText("Copy pay link").length).toBeGreaterThan(0);
    cleanup();
    render(<InvoiceView workspaceId="w" invoice={{ ...invoice, online_payment: { provider: "stripe", available: false, reason: "currency_unsupported", message: "Stripe can’t take payments in KWD." } }} canManage={false} backHref="/" now={now} />);
    expect(screen.queryByRole("button", { name: /Pay now/ })).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent("KWD");
  });
  it("shows the Stripe return banners", () => {
    render(<InvoiceView workspaceId="w" invoice={{ ...invoice, status: "paid", display_status: "paid", paid: "1250.00", outstanding: "0.00", online_payment: { provider: "stripe", available: false, reason: "nothing_due" } } as InvoiceDetail} canManage={false} backHref="/" now={now} stripeReturn="success" />);
    expect(screen.getByText("Payment received. Thank you!")).toBeInTheDocument();
    cleanup();
    render(<InvoiceView workspaceId="w" invoice={invoice} canManage={false} backHref="/" now={now} stripeReturn="cancel" />);
    expect(screen.getByText(/Nothing was charged/)).toBeInTheDocument();
  });
});
