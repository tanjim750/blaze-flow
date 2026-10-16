/** Browser-side calls for the billing (demo) routes, through the Next `/api` proxy. */
import { api } from "@/components/tasks/tasks-api";
import type { InvoiceDetail, PaymentEntry, ProjectPricing, TaskMoney } from "@/lib/money-view";

const base = (workspaceId: string) => `workspaces/${workspaceId}/billing`;

export type PaymentInput = { amount?: string | null; paid_on?: string; method?: string; note?: string };

export const getTaskMoney = (workspaceId: string, taskId: string) => api<TaskMoney>(`${base(workspaceId)}/tasks/${taskId}/`);
export const patchTaskMoney = (workspaceId: string, taskId: string, payload: { client_price?: string | null; editor_pay?: { membership_id: string; amount: string | null } }) =>
  api<TaskMoney>(`${base(workspaceId)}/tasks/${taskId}/`, "PATCH", payload);
export const getProjectPricing = (workspaceId: string, projectId: string) => api<ProjectPricing>(`${base(workspaceId)}/projects/${projectId}/`);
export const setProjectFee = (workspaceId: string, projectId: string, fee: string | null) =>
  api<ProjectPricing>(`${base(workspaceId)}/projects/${projectId}/`, "PATCH", { fee });
export const createInvoice = (workspaceId: string, projectId: string, dueDate?: string) =>
  api<InvoiceDetail>(`${base(workspaceId)}/invoices/`, "POST", { project_id: projectId, ...(dueDate ? { due_date: dueDate } : {}) });
export const sendInvoice = (workspaceId: string, invoiceId: string) => api<InvoiceDetail>(`${base(workspaceId)}/invoices/${invoiceId}/send/`, "POST");
export const deleteInvoice = (workspaceId: string, invoiceId: string) => api<void>(`${base(workspaceId)}/invoices/${invoiceId}/`, "DELETE");
/**
 * Records a client payment. Leave `amount` out to pay the whole balance: that is what the
 * "Mark as paid (demo)" button sends. Server-side both land in `billing.record_payment`.
 */
export const recordInvoicePayment = (workspaceId: string, invoiceId: string, payment: PaymentInput) =>
  api<InvoiceDetail>(`${base(workspaceId)}/invoices/${invoiceId}/payments/`, "POST", payment);
export const recordPayout = (workspaceId: string, membershipId: string, payment: PaymentInput) =>
  api<PaymentEntry>(`${base(workspaceId)}/payouts/`, "POST", { membership_id: membershipId, ...payment });
export const setMemberRate = (workspaceId: string, membershipId: string, rate: string | null) =>
  api<{ default_task_rate: string | null }>(`${base(workspaceId)}/members/${membershipId}/rate/`, "PATCH", { default_task_rate: rate });
