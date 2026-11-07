import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

import type { PaymentOption } from "@/lib/payment-gateways";
import { ManualPayPanel, PendingClaims } from "./manual-pay";
import { PayChooser } from "./pay-chooser";

afterEach(cleanup);

const option: PaymentOption = {
  provider: "wise", name: "Wise", kind: "manual", available: true, reason: null, automatic: false, methods: ["Bank transfer"],
  instructions: { reference: "INV-0042", amount: "1200.00", currency: "USD", account_details: "Account holder: Northlight\nACH routing: 026073150",
    payment_link: "https://wise.com/pay/me/north?currency=USD&amount=1200.00", link_label: "Wise payment link", note: "Use the invoice number.", pending_claim: null },
};

describe("ManualPayPanel", () => {
  it("shows the details and reference, and I've paid creates a pending claim", async () => {
    const onClaim = vi.fn().mockResolvedValue({ id: "c1", provider: "wise", amount: "1200.00", currency: "USD", payer_name: "Acme", payer_reference: "T-9", status: "pending", created_at: null });
    render(<ManualPayPanel option={option} studio="Northlight" onClaim={onClaim} />);
    expect(screen.getByText("INV-0042")).toBeInTheDocument();
    expect(screen.getByText(/ACH routing: 026073150/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /wise payment link/i })).toHaveAttribute("href", option.instructions!.payment_link);
    fireEvent.click(screen.getByRole("button", { name: /I.ve paid/ }));
    fireEvent.change(screen.getByLabelText(/Transfer reference/), { target: { value: "T-9" } });
    fireEvent.click(screen.getByRole("button", { name: /Confirm I.ve paid/ }));
    await waitFor(() => expect(onClaim).toHaveBeenCalledWith({ provider: "wise", payer_name: "", payer_reference: "T-9" }));
    expect(await screen.findByText(/marked paid once they confirm/)).toBeInTheDocument();
  });
  it("starts in the pending state when a claim exists", () => {
    render(<ManualPayPanel option={{ ...option, instructions: { ...option.instructions!, pending_claim: { id: "c1", provider: "wise", amount: "1200.00", currency: "USD", payer_name: "", payer_reference: "", status: "pending", created_at: null } } }} studio="N" onClaim={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /I.ve paid/ })).toBeNull();
  });
});

describe("manual options in the chooser and team claims", () => {
  it("labels manual options and confirms a claim", async () => {
    render(<PayChooser options={[{ provider: "paypal", name: "PayPal", available: true, reason: null }, option]} value="wise" onChange={vi.fn()} />);
    expect(screen.getByText(/confirmed by the studio/)).toBeInTheDocument();
    cleanup();
    const onResolve = vi.fn().mockResolvedValue(undefined);
    render(<PendingClaims claims={[{ id: "c1", provider: "wise", amount: "1200.00", currency: "USD", payer_name: "Acme", payer_reference: "T-9", status: "pending", created_at: null }]} onResolve={onResolve} />);
    fireEvent.click(screen.getByRole("button", { name: /Confirm received/ }));
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }), "confirm"));
  });
});
