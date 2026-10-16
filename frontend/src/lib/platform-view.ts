/**
 * Types and pure formatting for the staff-only platform admin (`/platform`).
 * No React and no fetch, so it is shared by server pages, client islands and tests.
 */
export type UserRef = { id: string; email: string; name: string } | null;
export type SubscriptionInfo = { plan: "FREE" | "PRO"; status: string; trial_ends_at: string | null; current_period_end: string | null; cancel_at_period_end: boolean };
export type Page<T> = { results: T[]; total: number; limit: number; offset: number };
export type Attention = { code: string; severity: "critical" | "warning" | "info"; count: number; label: string; href: string };

export type Overview = {
  range_days: number; generated_at: string; currency: string; pro_price_minor: number; mrr_is_estimate: boolean; demo_users: number;
  /** SIGNUP_MODE and the email backend: short name (resend / smtp / console / locmem),
   *  transport label ("Resend API", "SMTP", …) and whether mail really leaves the server. */
  signup_mode?: "open" | "invite_only"; email_backend?: string; email_transport?: string; email_sending?: boolean;
  users: { total: number; signups: number; verified: number; signups_by_day: { date: string; count: number }[] };
  workspaces: { total: number; active: number };
  plans: { free: number; pro: number; pro_paying: number; trialing: number };
  revenue: { mrr_minor: number; new_pro: number; churned: number; churn_rate: number; cancelling: number; trials_ended: number; trials_converted: number; trial_conversion_rate: number | null };
  ai_qa: { runs: number; failed: number; minutes: number };
  attention: Attention[];
};

export type AuditRow = { id: string; created_at: string; actor_type: string; actor: UserRef; action: string; entity_type: string | null; entity_id: string | null; workspace: { id: string; name: string } | null; reason: string | null; request_id: string | null };
export type TicketSummary = { id: string; number: number; subject: string; category: string; status: TicketStatus; user: UserRef; assignee: UserRef; workspace: { id: string; name: string } | null; plan: string | null; is_demo: boolean; created_at: string; updated_at: string };
export type TicketStatus = "NEW" | "OPEN" | "WAITING" | "SOLVED";
export type TicketMessage = { id: string; kind: "CUSTOMER" | "REPLY" | "NOTE"; author: UserRef; body: string; created_at: string; email_sent_at: string | null };
export type TicketDetail = TicketSummary & { messages: TicketMessage[]; context?: Record<string, string | null> };

export type WorkspaceSummary = {
  id: string; name: string; slug: string; status: string; created_at: string; owner: UserRef; subscription: SubscriptionInfo | null;
  members: number; projects: number; storage_bytes: number; limits: { projects: number; storage_bytes: number }; last_active_at: string | null; is_demo: boolean;
};
export type WorkspaceDetail = WorkspaceSummary & {
  members_list: { id: string; user: UserRef; role: string | null; is_primary_owner: boolean; status: string; joined_at: string }[];
  health: { status: "healthy" | "warning" | "critical"; alerts: { severity: string; code: string; count: number }[]; deliveries: Record<string, number>; outbox: Record<string, number> };
  ai_qa_30d: { runs: number; failed: number; minutes: number };
  recent_audit: AuditRow[]; tickets: TicketSummary[];
};
export type UserSummary = { id: string; email: string; name: string; status: string; email_verified_at: string | null; created_at: string; last_login: string | null; subscription: SubscriptionInfo; is_platform_staff: boolean; is_demo: boolean };
export type UserDetail = UserSummary & {
  oauth_providers: string[];
  workspaces: { id: string; name: string; role: string | null; is_primary_owner: boolean; status: string }[];
  subscription_history: { id: string; plan: string; status: string; started_at: string; current_period_end: string | null; cancelled_at: string | null; trial_ends_at: string | null }[];
  tickets: TicketSummary[]; recent_audit: AuditRow[];
};
export type JobRow = { kind: "outbox" | "ai_qa"; id: string; topic: string; status: string; attempts: number; aggregate: string; last_error: string; payload: Record<string, unknown>; created_at: string; updated_at: string; workspace: { id: string; name: string } | null };

export const RANGES = [7, 30, 90] as const;
export function parseRange(value: unknown): number {
  const n = Number(value);
  return (RANGES as readonly number[]).includes(n) ? n : 30;
}

export function formatMoney(minor: number, currency = "GBP"): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: minor % 100 ? 2 : 0 }).format(minor / 100);
}

export function percent(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return "—";
  return `${Math.round(rate * 1000) / 10}%`;
}

export function share(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

export function relativeTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "never";
  const seconds = Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const steps: [number, string][] = [[60, "m"], [3600, "h"], [86400, "d"], [86400 * 30, "mo"]];
  let label = "";
  for (const [size, unit] of steps) if (seconds >= size) label = `${Math.floor(seconds / size)}${unit}`;
  return `${label} ago`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
}

/** `{ q: "a", empty: "" }` → `"?q=a"`; drops empty values so links stay tidy. */
export function query(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== null && value !== undefined && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
}

export const firstParam = (value: string | string[] | undefined): string => (Array.isArray(value) ? value[0] ?? "" : value ?? "");

export function planLabel(sub: SubscriptionInfo | null): string {
  if (!sub) return "FREE";
  if (sub.status === "TRIALING") return "PRO trial";
  return sub.status === "ACTIVE" ? sub.plan : `${sub.plan} · ${sub.status.replace("_", " ").toLowerCase()}`;
}

/** Largest value for a bar chart, never zero (so empty ranges do not divide by zero). */
export const chartMax = (values: number[]) => Math.max(1, ...values);

export const TICKET_STATUSES: TicketStatus[] = ["NEW", "OPEN", "WAITING", "SOLVED"];
export const statusLabel = (status: string) => status.charAt(0) + status.slice(1).toLowerCase().replace("_", " ");
