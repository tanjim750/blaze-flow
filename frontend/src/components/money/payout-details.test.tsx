import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const api = vi.fn();
const refresh = vi.fn();
vi.mock("@/components/tasks/tasks-api", () => ({ api: (...args: unknown[]) => api(...args) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }), usePathname: () => "/money" }));
vi.mock("@/lib/app-router", () => ({ useAppRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

import { paymentMethodFor, payoutMethodError, payoutSummary, type PayoutDetails } from "@/lib/payout-details";
import { PAYMENT_METHODS, type MoneySummary, type PayoutRow } from "@/lib/money-view";
import { PayoutDetailsDialog, PayoutDetailsForm, WhyWeAsk } from "./payout-details";
import { MoneyBoard } from "./money-board";

afterEach(() => { cleanup(); api.mockReset(); });

const saved: PayoutDetails = {
  membership_id: "m1", encryption_configured: true, preferred: null,
  methods: [
    { id: "a", method: "bank_transfer", is_preferred: false, details: { account_name: "Maya Editor", bank_name: "DBBL", account_number: "BD1234567890" },
      fields: [{ name: "account_name", label: "Account name", value: "Maya Editor" }, { name: "account_number", label: "Account number / IBAN", value: "BD1234567890" }] },
    { id: "b", method: "wise", is_preferred: true, details: { email: "maya@wise.example" }, fields: [{ name: "email", label: "Wise email", value: "maya@wise.example" }] },
  ],
};

describe("payout details helpers", () => {
  it("validates like the server", () => {
    expect(payoutMethodError({ method: "paypal", details: { email: "nope" } })).toMatch(/email/);
    expect(payoutMethodError({ method: "upi", details: { upi_id: "maya" } })).toMatch(/name@bank/);
    expect(payoutMethodError({ method: "bank_transfer", details: { account_name: "M" } })).toBe("Bank is required.");
    expect(payoutMethodError({ method: "gcash", details: { phone: "09171234567" } })).toBeNull();
  });
  it("summarises without exposing the full account number", () => {
    expect(payoutSummary({ method: "bank_transfer", details: { bank_name: "DBBL", account_number: "BD1234567890" } })).toBe("Bank transfer · DBBL ••••7890");
  });
  it("maps every payout method to a record-payout method", () => {
    const ids = PAYMENT_METHODS.map((item) => item.id as string);
    for (const id of ["bank_transfer", "wise", "payoneer", "paypal", "bkash_nagad", "upi", "gcash", "other"]) expect(ids).toContain(paymentMethodFor(id));
    expect(paymentMethodFor(null)).toBe("bank_transfer");
  });
});

describe("PayoutDetailsForm", () => {
  it("shows the empty state, adds a method and saves it as preferred", async () => {
    api.mockResolvedValueOnce({ membership_id: "m1", methods: [], preferred: null, encryption_configured: true });
    render(<PayoutDetailsForm workspaceId="w1" workspaceName="Northlight" />);
    expect(await screen.findByText("No payout details yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Add a method/ }));
    fireEvent.change(screen.getByLabelText("Account name"), { target: { value: "Maya" } });
    fireEvent.change(screen.getByLabelText("Bank"), { target: { value: "DBBL" } });
    fireEvent.change(screen.getByLabelText("Account number / IBAN"), { target: { value: "BD1" } });
    api.mockResolvedValueOnce(saved);
    fireEvent.click(screen.getByRole("button", { name: /Save payout details/ }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("workspaces/w1/billing/payout-details/me/", "PUT", {
      methods: [{ method: "bank_transfer", details: { account_name: "Maya", bank_name: "DBBL", account_number: "BD1" }, is_preferred: true }],
    }));
  });
  it("blocks an invalid email before saving", async () => {
    const { container } = render(<PayoutDetailsForm workspaceId="w1" workspaceName="N" initial={{ ...saved, methods: [{ method: "paypal", is_preferred: true, details: { email: "bad" } }] }} />);
    fireEvent.submit(container.querySelector("form")!);
    expect((await screen.findByRole("alert")).textContent).toMatch(/email/);
    expect(api).not.toHaveBeenCalled();
  });
  it("has a collapsed why-we-ask note", () => {
    const { container } = render(<WhyWeAsk />);
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(details.textContent).toMatch(/Krewsys never holds or moves money/);
  });
});

describe("PayoutDetailsDialog", () => {
  it("lists every method with copy buttons", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    api.mockResolvedValueOnce(saved);
    render(<PayoutDetailsDialog workspaceId="w1" membershipId="m1" name="Maya" onClose={() => {}} />);
    expect(await screen.findByText("maya@wise.example")).toBeTruthy();
    expect(screen.getByText("Preferred")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy Account number / IBAN" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("BD1234567890"));
  });
  it("shows the gentle empty state with an ask-editor hint", async () => {
    api.mockResolvedValueOnce({ ...saved, methods: [] });
    render(<PayoutDetailsDialog workspaceId="w1" membershipId="m1" name="Theo" onClose={() => {}} />);
    expect(await screen.findByText("No payout details yet")).toBeTruthy();
    expect(screen.getByText(/Ask editor/)).toBeTruthy();
  });
});

describe("MoneyBoard payouts", () => {
  const row = (over: Partial<PayoutRow>): PayoutRow => ({ membership_id: "m1", name: "Maya", email: null, active: true, default_rate: null, pending: "0.00", earned: "300.00", paid: "0.00", owed: "300.00", payouts: [], ...over });
  const summary = (payouts: PayoutRow[]) => ({ currency: "GBP", totals: { clients_owe: "0", overdue: "0", billed: "0", collected: "0", unbilled: "0" }, receivables: [], invoices: [], payouts,
    access: { view: true, manage: true, rates_view: true } }) as unknown as MoneySummary;
  it("shows the preferred method beside Owed and prefills the payout method", async () => {
    render(<MoneyBoard workspaceId="w1" workspaceName="N" now="2026-10-27T00:00:00Z" projects={[]} access={{ view: true, manage: true, rates_view: true } as never}
      summary={summary([row({ preferred_payout_method: { method: "wise", label: "Wise" } }), row({ membership_id: "m2", name: "Theo", preferred_payout_method: null })])} />);
    expect(screen.getByRole("button", { name: /Maya prefers Wise/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Theo has no payout details yet/ })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /Pay out/ })[0]);
    expect(await screen.findByText("Maya prefers Wise.")).toBeTruthy();
    expect(screen.getByLabelText("Method").textContent).toMatch(/Wise/);
  });
  it("hides payout methods from viewers without the field", () => {
    render(<MoneyBoard workspaceId="w1" workspaceName="N" now="2026-10-27T00:00:00Z" projects={[]} access={{ view: true, manage: false, rates_view: true } as never} summary={summary([row({})])} />);
    expect(screen.queryByText(/payout details/i)).toBeNull();
  });
});
