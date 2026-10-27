import { describe, expect, it } from "vitest";
import { moneyToastText, nextMoneyStep, type MoneyPulse } from "./live-money";
import { describeNotification, type NotificationItem } from "./notifications";

const paid = { id: "p1", kind: "payment_received" as const, amount: "500.00", currency: "GBP", client: "Northlight Coffee", invoice_number: "INV-0012", invoice_id: "i1", provider: "stripe", created_at: "" };
const pulse = (version: string, latest: MoneyPulse["latest"] = null): MoneyPulse => ({ version, scope: "workspace", latest });

describe("nextMoneyStep", () => {
  it("only sets a baseline on the first pulse, even when a payment already exists", () => {
    expect(nextMoneyStep(null, pulse("a", paid))).toEqual({ refresh: false, toast: null });
  });
  it("does nothing while the version is unchanged", () => {
    expect(nextMoneyStep(pulse("a", paid), pulse("a", paid))).toEqual({ refresh: false, toast: null });
  });
  it("refreshes and toasts a new payment", () => {
    expect(nextMoneyStep(pulse("a"), pulse("b", paid))).toEqual({ refresh: true, toast: paid });
  });
  it("refreshes without a toast when money moved but no new payment (refund, payout, editor pay)", () => {
    expect(nextMoneyStep(pulse("a", paid), pulse("b", paid))).toEqual({ refresh: true, toast: null });
  });
});

describe("moneyToastText", () => {
  it("names amount, client and invoice", () => {
    expect(moneyToastText(paid)).toBe("Payment received: £500.00 from Northlight Coffee for INV-0012");
  });
  it("tells an editor only about their own payout", () => {
    expect(moneyToastText({ id: "x", kind: "payout_received", amount: "100", currency: "GBP", created_at: "" })).toBe("Payout received: £100.00");
  });
});

it("describes an \"I've paid\" claim for the team", () => {
  const item = {
    id: "n", kind: "PAYMENT_CLAIMED", workspace_id: "w", actor: null, entity_type: "payment_claim", entity_id: "c",
    payload: { actor_name: "Rachel Kim", provider: "wise", amount: "500.00", currency: "USD", invoice_number: "INV-0012", payer_reference: "TRX-9" },
    link: "/money/invoices/i1", snippet: null, poster_url: null, unread: true, read_at: null, created_at: "",
  } as unknown as NotificationItem;
  const d = describeNotification(item);
  expect(`${d.actor} ${d.verb} ${d.subject}`).toBe("Rachel Kim says they paid USD 500.00 by Wise for INV-0012");
  expect(d.href).toBe("/money/invoices/i1");
});
