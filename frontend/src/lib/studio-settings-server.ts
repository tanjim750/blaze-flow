/** Server-side loaders for the studio settings sections. */
import { request } from "./api";
import type { GlossaryTerm, InvoiceSettings, RateRow } from "./studio-settings";

export const getInvoiceSettings = (workspaceId: string) => request<InvoiceSettings>(`/workspaces/${workspaceId}/billing/settings/`);
export const getRates = (workspaceId: string) => request<{ currency: string; results: RateRow[] }>(`/workspaces/${workspaceId}/billing/rates/`);
export const getGlossary = (workspaceId: string) => request<GlossaryTerm[]>(`/workspaces/${workspaceId}/ai-glossary/`);
