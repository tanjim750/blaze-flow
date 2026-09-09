import { cookies } from "next/headers";
import { describeErrorBody } from "./errors";

/**
 * Server-side client for the Blaze Flow Django API.
 *
 * Requests go straight to the Django origin rather than through the Next rewrite,
 * so that a server component does not issue a request back into its own server.
 * Django uses SessionAuthentication, so the browser's session cookie is forwarded
 * verbatim and unsafe methods carry the matching CSRF token.
 */
const API_ORIGIN = process.env.BLAZEFLOW_API_URL ?? "http://127.0.0.1:8000";

export type Workspace = { id: string; name: string; slug: string; timezone: string; status: string; created_at: string };
export type ClientTeamMetadata = { project_ids?: string[] } & Record<string, unknown>;
export type ClientTeam = { id: string; name: string; description: string | null; website: string | null; email: string | null; metadata: ClientTeamMetadata | null; status: string; created_at: string };
export type Project = { id: string; workspace_id: string; name: string; description: string | null; status: string; priority: string; start_at: string | null; due_at: string | null; created_at: string; updated_at: string };
export type ProjectFolder = { id: string; project_id: string; parent_folder_id: string | null; name: string; created_at: string };
export type MediaFile = { id: string; name: string; mime_type: string; size_bytes: number };
export type WorkflowStageRef = { id: string; name: string; slug: string };
export type WorkflowStageStatus = { id: string; name: string; slug: string; sort_order: number };
export type WorkflowStage = { id: string; name: string; slug: string; sort_order: number; statuses: WorkflowStageStatus[] };
export type MediaVersion = {
  id: string; project_id: string; version_number: number; title: string; note: string | null;
  priority: string; allow_download: boolean; status: string; file: MediaFile;
  current_stage: WorkflowStageRef | null; created_at: string;
};

export type CurrentUser = {
  id: string; email: string; first_name: string; last_name: string;
  avatar_url: string | null; timezone: string; status: string;
  email_verified_at: string | null; created_at: string;
};
export type CommentAuthor = { id: string; email: string; name: string; type: "user" | "guest" };
/** One review note. `text` is null when the comment carries only attachments. */
export type ReviewComment = {
  id: string; parent_comment_id: string | null; author: CommentAuthor | null; text: string | null;
  start_time_ms: number | null; end_time_ms: number | null;
  resolved: boolean; resolved_by_user_id: string | null; resolved_at: string | null;
  revision_count: number; created_at: string; updated_at: string;
};
export type Notification = {
  id: string; kind: string; workspace_id: string | null;
  actor: { id: string; email: string; name: string } | null;
  entity_type: string | null; entity_id: string | null;
  payload: Record<string, unknown> | null;
  unread: boolean; read_at: string | null; created_at: string;
};
export type Task = {
  id: string; workspace_id: string; project_id: string | null; title: string;
  description: string | null; status: string; priority: string;
  start_at: string | null; due_at: string | null; completed_at: string | null;
  sort_order: number; created_at: string; updated_at: string;
};

export type ApiFailure = { status: number; detail: string };
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiFailure };

const failure = (status: number, detail: string): ApiResult<never> => ({ ok: false, error: { status, detail } });

async function authHeaders(): Promise<Record<string, string>> {
  const jar = await cookies();
  const cookieHeader = jar.getAll().map(({ name, value }) => `${name}=${value}`).join("; ");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (cookieHeader) headers.Cookie = cookieHeader;
  const csrf = jar.get("csrftoken")?.value;
  if (csrf) headers["X-CSRFToken"] = csrf;
  return headers;
}

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}/api${path}`, {
      ...init,
      headers: { ...(await authHeaders()), ...(init?.headers ?? {}) },
      cache: "no-store",
    });
  } catch {
    // Django unreachable — surfaced to the page so it can explain itself rather than crash.
    return failure(0, `Cannot reach the Blaze Flow API at ${API_ORIGIN}.`);
  }
  if (!response.ok) {
    return failure(response.status, describeErrorBody(response.status, await response.text(), response.statusText));
  }
  if (response.status === 204) return { ok: true, data: undefined as T };
  return { ok: true, data: (await response.json()) as T };
}

const jsonBody = (payload: unknown): RequestInit => ({
  method: "POST",
  body: JSON.stringify(payload),
  headers: { "Content-Type": "application/json" },
});

export const listWorkspaces = () => request<Workspace[]>("/workspaces/");
export const listClientTeams = (workspaceId: string) => request<ClientTeam[]>(`/workspaces/${workspaceId}/client-teams/`);
export const listProjects = (workspaceId: string) => request<Project[]>(`/workspaces/${workspaceId}/projects/`);
export const listFolders = (workspaceId: string, projectId: string) => request<ProjectFolder[]>(`/workspaces/${workspaceId}/projects/${projectId}/folders/`);
export const listMediaVersions = (workspaceId: string, projectId: string) => request<MediaVersion[]>(`/workspaces/${workspaceId}/projects/${projectId}/media-versions/`);
export const listWorkflowStages = (workspaceId: string) => request<WorkflowStage[]>(`/workspaces/${workspaceId}/workflow-stages/`);

export const createClientTeam = (workspaceId: string, payload: { name: string; description?: string; email?: string; website?: string; metadata?: ClientTeamMetadata }) =>
  request<ClientTeam>(`/workspaces/${workspaceId}/client-teams/`, jsonBody(payload));

/**
 * `Project` has no foreign key to `ClientTeam`, so which campaigns belong to a client is
 * recorded in the client team's existing `metadata` JSON field. See README notes in
 * `projects/actions.ts` — a real `Project.client_team` column would replace this.
 */
export const updateClientTeam = (workspaceId: string, clientTeamId: string, payload: { name?: string; metadata?: ClientTeamMetadata }) =>
  request<ClientTeam>(`/workspaces/${workspaceId}/client-teams/${clientTeamId}/`, { ...jsonBody(payload), method: "PATCH" });

export const createProject = (workspaceId: string, payload: { name: string; description?: string; priority?: string; due_at?: string }) =>
  request<Project>(`/workspaces/${workspaceId}/projects/`, jsonBody(payload));

export const createFolder = (workspaceId: string, projectId: string, payload: { name: string; parent_folder_id?: string }) =>
  request<ProjectFolder>(`/workspaces/${workspaceId}/projects/${projectId}/folders/`, jsonBody(payload));

export const getCurrentUser = () => request<CurrentUser>("/auth/me/");

/**
 * Ends the Django session. Session-authenticated, so unlike the public auth endpoints this
 * one is CSRF-enforced — `authHeaders` supplies the token from the cookie jar.
 */
export const logout = () => request<void>("/auth/logout/", { method: "POST" });

export const changePassword = (payload: { current_password: string; new_password: string }) =>
  request<void>("/auth/password/change/", jsonBody(payload));

/** Resends verification to the signed-in user's own address. Enumeration-safe 202 either way. */
export const requestEmailVerification = (email: string) =>
  request<{ detail: string }>("/auth/email-verification/request/", jsonBody({ email }));
export const listTasks = (workspaceId: string) => request<Task[]>(`/workspaces/${workspaceId}/tasks/`);

/**
 * Review comments are offset-paginated (`app/pagination.py`): the body is a plain array
 * and the page metadata rides on `X-Pagination-*` headers. One page of up to
 * `REVIEW_MAX_PAGE_SIZE` covers every review the UI renders today.
 */
export const listReviewComments = (workspaceId: string, projectId: string, mediaVersionId: string) =>
  request<ReviewComment[]>(`/workspaces/${workspaceId}/projects/${projectId}/media-versions/${mediaVersionId}/comments/?limit=200`);

export const createReviewComment = (
  workspaceId: string, projectId: string, mediaVersionId: string,
  payload: { text: string; start_time_ms?: number; parent_comment_id?: string },
) => request<ReviewComment>(
  `/workspaces/${workspaceId}/projects/${projectId}/media-versions/${mediaVersionId}/comments/`,
  jsonBody(payload),
);

export const setCommentResolution = (
  workspaceId: string, projectId: string, mediaVersionId: string, commentId: string, resolved: boolean,
) => request<ReviewComment>(
  `/workspaces/${workspaceId}/projects/${projectId}/media-versions/${mediaVersionId}/comments/${commentId}/resolution/`,
  jsonBody({ resolved }),
);

export const listNotifications = () => request<Notification[]>("/notifications/");
