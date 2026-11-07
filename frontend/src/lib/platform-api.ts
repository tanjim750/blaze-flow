/** Server-side reads for `/platform`. Same transport (session cookie + CSRF) as `api.ts`. */
import { request } from "./api";
import type { AuditRow, JobRow, Overview, Page, TicketDetail, TicketSummary, TicketStatus, UserDetail, UserSummary, WorkspaceDetail, WorkspaceSummary } from "./platform-view";
import { query } from "./platform-view";

type Params = Record<string, string | number | null | undefined>;

export const getOverview = (days: number) => request<Overview>(`/platform/overview/${query({ days })}`);
export const listPlatformWorkspaces = (params: Params) => request<Page<WorkspaceSummary>>(`/platform/workspaces/${query(params)}`);
export const getPlatformWorkspace = (id: string) => request<WorkspaceDetail>(`/platform/workspaces/${id}/`);
export const listPlatformUsers = (params: Params) => request<Page<UserSummary>>(`/platform/users/${query(params)}`);
export const getPlatformUser = (id: string) => request<UserDetail>(`/platform/users/${id}/`);
export const listJobs = (params: Params) => request<Page<JobRow>>(`/platform/jobs/${query(params)}`);
export const listTickets = (params: Params) => request<Page<TicketSummary> & { counts: Record<TicketStatus, number> }>(`/platform/tickets/${query(params)}`);
export const getTicket = (id: string) => request<TicketDetail>(`/platform/tickets/${id}/`);
export const listAudit = (params: Params) => request<Page<AuditRow>>(`/platform/audit/${query(params)}`);
