/**
 * Live money: the app polls `GET /api/workspaces/<id>/billing/money-version/` while the tab is
 * visible. The answer is a short fingerprint of the money the viewer may see; when it changes
 * the page re-renders from the server (router.refresh) and, for a new payment, a toast says so.
 * Pure logic only; the hook lives in `components/money/live-money.tsx`.
 */
import { formatMoney } from "./money";

/** How often to ask while the tab is visible. Hidden tabs run no timer at all. */
export const LIVE_MONEY_MS = 12_000;

export type MoneyEvent =
  | { id: string; kind: "payment_received"; amount: string; currency: string; client: string; invoice_number: string; invoice_id: string; provider: string; created_at: string }
  | { id: string; kind: "payout_received"; amount: string; currency: string; created_at: string };
export type MoneyPulse = { version: string; scope: "workspace" | "own"; latest: MoneyEvent | null };

export const moneyVersionPath = (workspaceId: string) => `/api/workspaces/${workspaceId}/billing/money-version/`;

/** What to do when a new pulse arrives. The first pulse only sets the baseline. */
export function nextMoneyStep(previous: MoneyPulse | null, next: MoneyPulse): { refresh: boolean; toast: MoneyEvent | null } {
  if (!previous || previous.version === next.version) return { refresh: false, toast: null };
  const fresh = next.latest && next.latest.id !== previous.latest?.id ? next.latest : null;
  return { refresh: true, toast: fresh };
}

/** "Payment received: £500.00 from Northlight Coffee for INV-0012" (or the editor's payout line). */
export function moneyToastText(event: MoneyEvent): string {
  const amount = formatMoney(event.amount, event.currency);
  if (event.kind === "payout_received") return `Payout received: ${amount}`;
  return `Payment received: ${amount}${event.client ? ` from ${event.client}` : ""}${event.invoice_number ? ` for ${event.invoice_number}` : ""}`;
}
