/** Browser-side staff actions for `/platform`. Each one carries the `reason` the API audits. */
import { describeErrorBody } from "./errors";
import type { TicketDetail } from "./platform-view";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; detail: string };

function csrfToken(): string {
  return decodeURIComponent(document.cookie.split("; ").find((item) => item.startsWith("csrftoken="))?.slice(10) ?? "");
}

export async function send<T>(path: string, method: "POST" | "PATCH", payload: unknown): Promise<ActionResult<T>> {
  try {
    const response = await fetch(`/api${path}`, {
      method, credentials: "include", cache: "no-store",
      headers: { "Content-Type": "application/json", "X-CSRFToken": csrfToken() },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    if (!response.ok) return { ok: false, detail: describeErrorBody(response.status, text, response.statusText) };
    return { ok: true, data: (text ? JSON.parse(text) : null) as T };
  } catch {
    return { ok: false, detail: "Network error. Check your connection and try again." };
  }
}

export const platformActions = {
  userAction: (userId: string, action: "resend-verification" | "password-reset", reason: string) =>
    send<{ detail: string }>(`/platform/users/${userId}/${action}/`, "POST", { reason }),
  retryJobs: (items: { kind: "outbox" | "ai_qa"; id: string }[], reason: string) =>
    send<{ retried: number; results: { id: string; ok: boolean; detail?: string }[] }>("/platform/jobs/retry/", "POST", { items, reason }),
  postMessage: (ticketId: string, kind: "REPLY" | "NOTE", body: string, reason: string) =>
    send<TicketDetail>(`/platform/tickets/${ticketId}/messages/`, "POST", { kind, body, reason }),
  updateTicket: (ticketId: string, changes: { status?: string; assignee?: "me" | "none" }, reason: string) =>
    send<TicketDetail>(`/platform/tickets/${ticketId}/`, "PATCH", { ...changes, reason }),
};

export type ReportPayload = { category: string; subject: string; body: string; workspace_id?: string | null; context: Record<string, string> };
export const reportProblem = (payload: ReportPayload) => send<{ id: string; number: number }>("/support/tickets/", "POST", payload);
