/** Server-side calls for the billing (demo) routes. Same transport as `api.ts`. */
import { request } from "./api";
import type { ClientInvoices, InvoiceDetail, MoneySummary, MyEarnings, ProjectPricing } from "./money-view";

const base = (workspaceId: string) => `/workspaces/${workspaceId}/billing`;

/** Totals, receivables, invoices and (with rates visibility) payouts. 403 without billing.view. */
export const getMoneySummary = (workspaceId: string) => request<MoneySummary>(`${base(workspaceId)}/summary/`);
/** Team members with billing.view, or a client-team member for their own client's sent invoice (404 otherwise). */
export const getInvoice = (workspaceId: string, invoiceId: string) => request<InvoiceDetail>(`${base(workspaceId)}/invoices/${invoiceId}/`);
/** The viewer's own pay. 403 for someone in only through a client team. */
export const getMyEarnings = (workspaceId: string) => request<MyEarnings>(`${base(workspaceId)}/my-earnings/`);
/** A client-team member's own client's invoices. 403 for team members. */
export const getMyInvoices = (workspaceId: string) => request<ClientInvoices>(`${base(workspaceId)}/my-invoices/`);
export const getProjectPricing = (workspaceId: string, projectId: string) => request<ProjectPricing>(`${base(workspaceId)}/projects/${projectId}/`);
