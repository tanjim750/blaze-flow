import { describe, expect, it } from "vitest";
import {
  addressLines, buildClientInvoices, buildEarnings, buildOwnerMoneyCards, buildTotals, dueLabel, filterCounts, invoiceBadge,
  type InvoiceSummary, type MoneyTotals,
} from "./money-view";

const NOW = new Date(2026, 9, 4, 12, 0);
const invoice = (over: Partial<InvoiceSummary>): InvoiceSummary => ({
  id: "i1", number: "INV-0001", status: "sent", display_status: "sent", currency: "GBP",
  client: { id: "c1", name: "Northlight Coffee" }, project: { id: "p1", name: "Spring Launch" },
  issue_date: "2026-09-20", due_date: "2026-10-09", sent_at: null, paid_at: null,
  total: "1400.00", paid: "0.00", outstanding: "1400.00", created_at: "2026-09-20T10:00:00Z", ...over,
});

const ownerTotals: MoneyTotals = {
  clients_owe: "8330.00", overdue: "6380.00", billed: "16480.00", collected: "8150.00", unbilled: "11300.00",
  we_owe_editors: "760.00", editors_paid: "260.00", editors_pending: "1880.00", project_value: "21200.00", editor_cost: "2900.00", margin: "18300.00", margin_percent: 86.3,
};

describe("buildTotals", () => {
  it("shows clients owe / we owe editors / margin / collected for a rates viewer", () => {
    const cards = buildTotals({ currency: "GBP", totals: ownerTotals });
    expect(cards.map((card) => [card.id, card.value])).toEqual([
      ["clients_owe", "£8,330"], ["we_owe_editors", "£760"], ["margin", "£18,300"], ["collected", "£8,150"],
    ]);
    expect(cards[0]).toMatchObject({ hint: "£6,380 overdue", tone: "danger" });
    expect(cards[1].hint).toBe("£1,880 more pending approval");
    expect(cards[2].hint).toBe("86.3% of £21,200 priced work");
    expect(cards[3].hint).toBe("of £16,480 billed · £11,300 not billed yet");
  });
  it("leaves out editor numbers the API did not send", () => {
    const cards = buildTotals({ currency: "GBP", totals: { clients_owe: "0.00", overdue: "0.00", billed: "0.00", collected: "0.00", unbilled: "0.00" } });
    expect(cards.map((card) => card.id)).toEqual(["clients_owe", "collected"]);
    expect(cards[0]).toMatchObject({ hint: "Nothing overdue", tone: "neutral" });
  });
  it("flags a negative margin", () => {
    const cards = buildTotals({ currency: "USD", totals: { ...ownerTotals, margin: "-120.00", margin_percent: -4 } });
    expect(cards.find((card) => card.id === "margin")).toMatchObject({ value: "-US$120", tone: "danger" });
  });
  it("relabels three cards for the owner dashboard", () => {
    expect(buildOwnerMoneyCards({ currency: "GBP", totals: ownerTotals }).map((card) => `${card.label}: ${card.value}`))
      .toEqual(["Revenue collected: £8,150", "Outstanding: £8,330", "Owed to editors: £760"]);
  });
});

describe("invoice status and due labels", () => {
  it("marks part-paid invoices", () => {
    expect(invoiceBadge(invoice({ paid: "560.00", outstanding: "840.00" }))).toEqual({ label: "Sent", tone: "blue", partial: true });
    expect(invoiceBadge(invoice({ display_status: "overdue" }))).toEqual({ label: "Overdue", tone: "danger", partial: false });
    expect(invoiceBadge(invoice({ display_status: "paid", status: "paid", paid: "1400.00", outstanding: "0.00" }))).toMatchObject({ label: "Paid", partial: false });
  });
  it("counts days to or past the due date", () => {
    expect(dueLabel(invoice({}), NOW)).toBe("Due in 5 days");
    expect(dueLabel(invoice({ due_date: "2026-10-04" }), NOW)).toBe("Due today");
    expect(dueLabel(invoice({ display_status: "overdue", due_date: "2026-10-03" }), NOW)).toBe("1 day overdue");
    expect(dueLabel(invoice({ display_status: "overdue", due_date: "2026-09-27" }), NOW)).toBe("7 days overdue");
    expect(dueLabel(invoice({ display_status: "paid", paid_at: "2026-09-22T09:00:00Z" }), NOW)).toMatch(/^Paid 22 Sep/);
    expect(dueLabel(invoice({ display_status: "draft", status: "draft" }), NOW)).toBe("Not sent");
  });
  it("counts invoices per filter", () => {
    const counts = filterCounts([
      invoice({ id: "a" }), invoice({ id: "b", display_status: "overdue" }),
      invoice({ id: "c", status: "draft", display_status: "draft" }), invoice({ id: "d", status: "paid", display_status: "paid" }),
    ]);
    expect(counts).toEqual({ all: 4, outstanding: 2, overdue: 1, draft: 1, paid: 1 });
  });
});

describe("dashboard cards", () => {
  it("builds My earnings from pending / earned / paid", () => {
    const view = buildEarnings({
      currency: "GBP", pending: "800.00", earned: "580.00", paid: "260.00", owed: "320.00", payouts: [],
      lines: [{ task_id: "t1", task: "Hero 30s: v1 assembly", project: "Spring Launch", amount: "320.00", status: "earned", earned_at: "2026-10-03T10:00:00Z" },
        { task_id: "t2", task: "Reel 21", project: "Q4 Social Reels", amount: "220.00", status: "pending", earned_at: null }],
    });
    expect([view.pending, view.earned, view.paid, view.owed]).toEqual(["£800.00", "£580.00", "£260.00", "£320.00"]);
    expect(view.paidShare).toBe(44.8);
    expect(view.recent.map((row) => row.status)).toEqual(["Earned", "Pending approval"]);
  });
  it("builds Your invoices for a client", () => {
    const view = buildClientInvoices({ currency: "GBP", outstanding: "840.00", overdue_count: 0, results: [invoice({ paid: "560.00", outstanding: "840.00" })] }, NOW);
    expect(view).toMatchObject({ outstanding: "£840.00", hasOutstanding: true });
    expect(view.rows[0]).toMatchObject({ number: "INV-0001", amount: "£1,400.00", due: "Due in 5 days", href: "/money/invoices/i1" });
    expect(view.rows[0].badge.partial).toBe(true);
  });
});

it("drops blank address parts", () => {
  expect(addressLines({ name: "Northlight", email: "a@b.c", address_line_1: "14 Harbourside Lane", address_line_2: " ", city: "Bristol", region: null, postal_code: "BS1 5TT", country_code: "GB" }))
    .toEqual(["14 Harbourside Lane", "Bristol, BS1 5TT", "GB", "a@b.c"]);
});
