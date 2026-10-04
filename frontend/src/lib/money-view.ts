/**
 * Types for the billing (demo) API and the pure view logic the Money page and dashboard
 * cards are built from. Nothing here fetches; see `billing-api.ts` (server) and
 * `components/money/billing-client.ts` (browser).
 */
import { formatMoney, percentOf, sumMoney, toMinor } from "./money";

export type BillingAccess = { view: boolean; manage: boolean; rates_view: boolean };
export const NO_BILLING: BillingAccess = { view: false, manage: false, rates_view: false };

export type InvoiceStatus = "draft" | "sent" | "paid";
export type InvoiceDisplayStatus = InvoiceStatus | "overdue";
export type PaymentEntry = { id: string; direction: "incoming" | "outgoing"; amount: string; currency: string; paid_on: string; method: string; note: string; provider: string; created_at: string };
export type InvoiceSummary = {
  id: string; number: string; status: InvoiceStatus; display_status: InvoiceDisplayStatus; currency: string;
  client: { id: string; name: string }; project: { id: string; name: string } | null;
  issue_date: string | null; due_date: string | null; sent_at: string | null; paid_at: string | null;
  total: string; paid: string; outstanding: string; created_at: string;
};
export type Address = { name: string; email: string | null; address_line_1: string | null; address_line_2: string | null; city: string | null; region: string | null; postal_code: string | null; country_code: string | null };
export type InvoiceDetail = InvoiceSummary & {
  notes: string; lines: { id: string; kind: "project_fee" | "task"; description: string; amount: string; task_id: string | null }[];
  payments: PaymentEntry[]; bill_to: Address; from: Address; viewer_can_manage?: boolean;
};
export type Receivable = { client: { id: string; name: string }; billed: string; paid: string; outstanding: string; overdue: string; unbilled: string; invoice_count: number };
export type PayoutRow = { membership_id: string; name: string; email: string | null; active: boolean; default_rate: string | null; pending: string; earned: string; paid: string; owed: string; payouts: PaymentEntry[] };
export type MoneyTotals = {
  clients_owe: string; overdue: string; billed: string; collected: string; unbilled: string;
  we_owe_editors?: string; editors_paid?: string; editors_pending?: string; project_value?: string; editor_cost?: string; margin?: string; margin_percent?: number | null;
};
export type MoneySummary = { currency: string; totals: MoneyTotals; receivables: Receivable[]; invoices: InvoiceSummary[]; payouts?: PayoutRow[]; access: BillingAccess };
export type MyEarnings = {
  currency: string; pending: string; earned: string; paid: string; owed: string;
  lines: { task_id: string; task: string; project: string | null; amount: string; status: "pending" | "earned"; earned_at: string | null }[];
  payouts: PaymentEntry[];
};
export type ClientInvoices = { currency: string; results: InvoiceSummary[]; outstanding: string; overdue_count: number };
export type EditorPayLine = { membership_id: string; name: string; is_me: boolean; amount: string | null; default_rate: string | null; status: "pending" | "earned" | null; earned_at: string | null; frozen: boolean; assigned: boolean };
export type TaskMoney = { task_id: string; currency: string; can_manage: boolean; client_price?: string | null; editor_pay: EditorPayLine[] };
export type ProjectPricing = {
  project_id: string; currency: string; fee: string | null; tasks_total: string; total: string; invoiced: string; uninvoiced: string;
  tasks: { id: string; title: string; client_price: string | null }[]; invoices: InvoiceSummary[]; can_manage: boolean;
};

export type Tone = "neutral" | "blue" | "danger" | "success" | "warning" | "accent";

const STATUS: Record<InvoiceDisplayStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  sent: { label: "Sent", tone: "blue" },
  overdue: { label: "Overdue", tone: "danger" },
  paid: { label: "Paid", tone: "success" },
};

/** Badge for an invoice. A sent or overdue invoice with some money in says so. */
export function invoiceBadge(invoice: Pick<InvoiceSummary, "display_status" | "paid" | "outstanding">): { label: string; tone: Tone; partial: boolean } {
  const base = STATUS[invoice.display_status] ?? STATUS.sent;
  const partial = (invoice.display_status === "sent" || invoice.display_status === "overdue") && toMinor(invoice.paid) > 0 && toMinor(invoice.outstanding) > 0;
  return { ...base, partial };
}

const DAY = 86_400_000;
function dayNumber(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY;
}
function todayNumber(now: Date): number {
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY;
}
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** "Due in 5 days", "Due today", "3 days overdue", "Paid 12 Sep 2026", "Not sent". */
export function dueLabel(invoice: Pick<InvoiceSummary, "display_status" | "due_date" | "paid_at">, now: Date): string {
  if (invoice.display_status === "paid") return invoice.paid_at ? `Paid ${formatDate(invoice.paid_at)}` : "Paid";
  if (invoice.display_status === "draft") return "Not sent";
  if (!invoice.due_date) return "No due date";
  const days = dayNumber(invoice.due_date) - todayNumber(now);
  if (days === 0) return "Due today";
  if (days > 0) return `Due in ${days} ${days === 1 ? "day" : "days"}`;
  return `${-days} ${days === -1 ? "day" : "days"} overdue`;
}

export type InvoiceFilter = "all" | "outstanding" | "overdue" | "draft" | "paid";
export const INVOICE_FILTERS: { id: InvoiceFilter; label: string }[] = [
  { id: "all", label: "All" }, { id: "outstanding", label: "Outstanding" }, { id: "overdue", label: "Overdue" },
  { id: "draft", label: "Drafts" }, { id: "paid", label: "Paid" },
];
export function matchesFilter(invoice: InvoiceSummary, filter: InvoiceFilter): boolean {
  if (filter === "all") return true;
  if (filter === "outstanding") return invoice.status === "sent";
  return invoice.display_status === filter;
}
export function filterCounts(invoices: InvoiceSummary[]): Record<InvoiceFilter, number> {
  return Object.fromEntries(INVOICE_FILTERS.map(({ id }) => [id, invoices.filter((invoice) => matchesFilter(invoice, id)).length])) as Record<InvoiceFilter, number>;
}

export type TotalCard = { id: string; label: string; value: string; hint: string; tone: Tone };

/**
 * The Money page headline: clients owe us / we owe editors / margin, plus cash collected.
 * The editor-side cards only exist when the API sent editor numbers (rates visibility).
 */
export function buildTotals(summary: Pick<MoneySummary, "currency" | "totals">): TotalCard[] {
  const { currency, totals } = summary;
  const money = (value: string | undefined | null) => formatMoney(value ?? "0", currency, { whole: true });
  const cards: TotalCard[] = [{
    id: "clients_owe", label: "Clients owe us", value: money(totals.clients_owe),
    hint: toMinor(totals.overdue) > 0 ? `${money(totals.overdue)} overdue` : "Nothing overdue",
    tone: toMinor(totals.overdue) > 0 ? "danger" : "neutral",
  }];
  if (totals.we_owe_editors !== undefined) {
    cards.push({
      id: "we_owe_editors", label: "We owe editors", value: money(totals.we_owe_editors),
      hint: `${money(totals.editors_pending)} more pending approval`, tone: toMinor(totals.we_owe_editors) > 0 ? "warning" : "neutral",
    });
  }
  if (totals.margin !== undefined) {
    const percent = totals.margin_percent ?? percentOf(totals.margin, totals.project_value);
    cards.push({
      id: "margin", label: "Margin", value: money(totals.margin),
      hint: percent === null ? "No priced work yet" : `${percent}% of ${money(totals.project_value)} priced work`,
      tone: toMinor(totals.margin) < 0 ? "danger" : "success",
    });
  }
  cards.push({
    id: "collected", label: "Collected", value: money(totals.collected),
    hint: `of ${money(totals.billed)} billed${toMinor(totals.unbilled) > 0 ? ` · ${money(totals.unbilled)} not billed yet` : ""}`, tone: "accent",
  });
  return cards;
}

/** Owner dashboard: three money cards (revenue collected, outstanding, owed to editors). */
export function buildOwnerMoneyCards(summary: Pick<MoneySummary, "currency" | "totals">): TotalCard[] {
  const cards = buildTotals(summary);
  const byId = new Map(cards.map((card) => [card.id, card]));
  const revenue = { ...byId.get("collected")!, label: "Revenue collected" };
  const outstanding = { ...byId.get("clients_owe")!, label: "Outstanding" };
  const owed = byId.get("we_owe_editors");
  return owed ? [revenue, outstanding, { ...owed, label: "Owed to editors" }] : [revenue, outstanding];
}

/** Editor dashboard "My earnings": pending / earned / paid, and what is still owed. */
export function buildEarnings(earnings: MyEarnings) {
  const money = (value: string) => formatMoney(value, earnings.currency);
  const earnedTotal = sumMoney([earnings.earned]);
  return {
    pending: money(earnings.pending), earned: money(earnings.earned), paid: money(earnings.paid), owed: money(earnings.owed),
    owedMinor: toMinor(earnings.owed),
    paidShare: percentOf(earnings.paid, earnedTotal) ?? 0,
    recent: earnings.lines.slice(0, 4).map((line) => ({
      id: line.task_id, task: line.task, project: line.project, amount: money(line.amount),
      status: line.status === "earned" ? "Earned" : "Pending approval", tone: (line.status === "earned" ? "success" : "neutral") as Tone,
    })),
    empty: earnings.lines.length === 0,
  };
}

/** Client dashboard "Your invoices": newest first, with amount, status and a due line. */
export function buildClientInvoices(data: ClientInvoices, now: Date) {
  return {
    outstanding: formatMoney(data.outstanding, data.currency),
    hasOutstanding: toMinor(data.outstanding) > 0,
    overdueCount: data.overdue_count,
    rows: data.results.slice(0, 5).map((invoice) => ({
      id: invoice.id, number: invoice.number, project: invoice.project?.name ?? null,
      amount: formatMoney(invoice.total, invoice.currency), outstanding: formatMoney(invoice.outstanding, invoice.currency),
      badge: invoiceBadge(invoice), due: dueLabel(invoice, now), href: `/money/invoices/${invoice.id}`,
    })),
  };
}

export const PAYMENT_METHODS = [
  { id: "bank_transfer", label: "Bank transfer" }, { id: "card", label: "Card" }, { id: "cash", label: "Cash" }, { id: "other", label: "Other" },
] as const;
export const methodLabel = (id: string) => PAYMENT_METHODS.find((method) => method.id === id)?.label ?? id;

/** Address lines for the printable invoice, blank parts dropped. */
export function addressLines(address: Address): string[] {
  const cityLine = [address.city, address.region, address.postal_code].filter(Boolean).join(", ");
  return [address.address_line_1, address.address_line_2, cityLine, address.country_code, address.email].filter((line): line is string => Boolean(line && line.trim()));
}
