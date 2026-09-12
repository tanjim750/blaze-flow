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
export type WorkspaceProfile = {
  business_name: string | null; description: string | null; email: string | null;
  phone: string | null; website_url: string | null; address_line_1: string | null;
  address_line_2: string | null; city: string | null; state: string | null;
  postal_code: string | null; country_code: string | null; updated_at: string | null;
};
export type ClientTeamMetadata = { project_ids?: string[] } & Record<string, unknown>;
export type ClientTeam = { id: string; name: string; description: string | null; website: string | null; email: string | null; phone: string | null; address_line_1: string | null; address_line_2: string | null; city: string | null; state_region: string | null; postal_code: string | null; country_code: string | null; metadata: ClientTeamMetadata | null; status: string; created_at: string };
export type ClientTeamMember = { id: string; user: CurrentUser; title: string | null; status: string; joined_at: string; removed_at: string | null };
export type ClientTeamInvite = { id: string; invite_type: "EMAIL" | "LINK"; recipient_email: string | null; label: string | null; max_uses: number | null; use_count: number; expires_at: string; revoked_at: string | null; created_at: string; token?: string };
export type NotificationPreference = { email_mentions_enabled: boolean };
export type Project = { id: string; workspace_id: string; client_team_id: string | null; name: string; description: string | null; status: string; priority: string; start_at: string | null; due_at: string | null; created_at: string; updated_at: string };
export type ProjectFolder = { id: string; workspace_id: string; client_team_id: string | null; project_id: string | null; parent_folder_id: string | null; name: string; created_at: string };
export type MediaFile = { id: string; name: string; mime_type: string; size_bytes: number };
export type ProjectFile = { id: string; workspace_id: string; client_team_id: string | null; project_id: string | null; folder_id: string | null; task_stage_id: string | null; file: MediaFile & { checksum_sha256: string; status: string }; added_by: { id: string; name: string; email: string } | null; poster: { width: number | null; height: number | null } | null; created_at: string };
export type WorkflowStageRef = { id: string; name: string; slug: string };
export type WorkflowStageStatus = { id: string; name: string; slug: string; sort_order: number };
export type WorkflowStage = { id: string; name: string; slug: string; sort_order: number; statuses: WorkflowStageStatus[] };
export type StageHistoryEntry = { id: string; stage: WorkflowStageRef | null; entered_at: string; exited_at: string | null };
export type MediaVersion = {
  id: string; project_id: string; version_number: number; title: string; note: string | null;
  priority: string; allow_download: boolean; status: string; file: MediaFile;
  current_stage: WorkflowStageRef | null; preview_status: string; created_at: string;
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
  /** Workspace users notified by this note. The API resolves and de-duplicates the list. */
  mentions: { id: string; email: string; name: string }[];
  reactions: { emoji: string; count: number; reactors: { id: string; name: string; type: string }[] }[];
  attachments: { id: string; content_type: string; file: MediaFile & { status: string } }[];
};
export type Notification = {
  id: string; kind: string; workspace_id: string | null;
  actor: { id: string; email: string; name: string } | null;
  entity_type: string | null; entity_id: string | null;
  payload: Record<string, unknown> | null;
  unread: boolean; read_at: string | null; created_at: string;
};
export type Task = {
  id: string; workspace_id: string; client_team_id: string | null; project_id: string | null; task_stage_id: string | null; title: string;
  description: string | null; status: string; priority: string;
  start_at: string | null; due_at: string | null; completed_at: string | null;
  sort_order: number; created_at: string; updated_at: string;
  assignees: { id: string; name: string; email: string }[];
};
/**
 * A file attached to a task. `file.id` is the same `File` row a `ProjectFile` or a
 * `MediaVersion` points at, so this is what makes "Task -> attachment -> Review" open the
 * very same media rather than a copy of it.
 */
export type TaskAttachment = { id: string; file: MediaFile & { checksum_sha256: string; status: string }; attached_at: string };
export type TaskStage = { id: string; name: string; color: string; sort_order: number; wip_limit: number | null; is_done: boolean; automation_enabled: boolean; task_count: number };
export type TaskWorkflowSettings = { wip_warning: boolean; auto_notify_client: boolean; lock_done_editing: boolean };
export type TaskWorkflow = { stages: TaskStage[]; settings: TaskWorkflowSettings };
export type Role = { id: string; name: string; description: string; is_system: boolean; status: string; permissions: string[] };
export type WorkspaceMembership = {
  id: string; principal_type: string; user: CurrentUser | null; client_team: ClientTeam | null;
  role: Role | null; project_access_mode: string; is_primary_owner: boolean; status: string; joined_at: string;
};
export type WorkspaceInvite = { id: string; email: string; role_id: string; project_access_mode: string; expires_at: string; created_at: string; token?: string };
export type ResourceAccess = { id: string; membership: WorkspaceMembership; created_at: string };
export type AnnotationElement = { id?: string; element_type: "POINT" | "RECTANGLE" | "ELLIPSE" | "ARROW" | "PATH" | "TEXT"; geometry: Record<string, unknown>; style: Record<string, unknown>; payload: Record<string, unknown> };
export type Annotation = { id: string; review_comment_id: string | null; author_user_id: string | null; start_time_ms: number | null; end_time_ms: number | null; elements: AnnotationElement[]; revision_count: number; created_at: string; updated_at: string };

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
export const createWorkspace = (payload: { name: string; slug?: string; timezone: string }) =>
  request<Workspace & { membership_id: string }>("/workspaces/", jsonBody(payload));
export const getWorkspaceProfile = (workspaceId: string) =>
  request<WorkspaceProfile>(`/workspaces/${workspaceId}/profile/`);
export const updateWorkspaceProfile = (workspaceId: string, payload: Partial<Omit<WorkspaceProfile, "updated_at">>) =>
  request<WorkspaceProfile>(`/workspaces/${workspaceId}/profile/`, {
    ...jsonBody(payload), method: "PATCH",
  });
export const listClientTeams = (workspaceId: string) => request<ClientTeam[]>(`/workspaces/${workspaceId}/client-teams/`);
export const listClientTeamMembers = (workspaceId: string, clientTeamId: string) => request<ClientTeamMember[]>(`/workspaces/${workspaceId}/client-teams/${clientTeamId}/members/`);
export const addClientTeamMember = (workspaceId: string, clientTeamId: string, payload: { email: string; title?: string }) => request<ClientTeamMember>(`/workspaces/${workspaceId}/client-teams/${clientTeamId}/members/`, jsonBody(payload));
export const removeClientTeamMember = (workspaceId: string, clientTeamId: string, memberId: string) => request<void>(`/workspaces/${workspaceId}/client-teams/${clientTeamId}/members/${memberId}/`, { method: "DELETE" });
export const listClientTeamInvites = (workspaceId: string, clientTeamId: string) => request<ClientTeamInvite[]>(`/workspaces/${workspaceId}/client-teams/${clientTeamId}/invites/`);
export const createClientTeamInvite = (workspaceId: string, clientTeamId: string, payload: { invite_type: "EMAIL" | "LINK"; recipient_email?: string; label?: string; max_uses?: number; expires_in_days: number }) => request<ClientTeamInvite>(`/workspaces/${workspaceId}/client-teams/${clientTeamId}/invites/`, jsonBody(payload));
export const revokeClientTeamInvite = (workspaceId: string, clientTeamId: string, inviteId: string) => request<void>(`/workspaces/${workspaceId}/client-teams/${clientTeamId}/invites/${inviteId}/`, { method: "DELETE" });
export const listProjects = (workspaceId: string) => request<Project[]>(`/workspaces/${workspaceId}/projects/`);
export const listFolders = (workspaceId: string, projectId: string) => request<ProjectFolder[]>(`/workspaces/${workspaceId}/projects/${projectId}/folders/`);
export const listProjectFiles = (workspaceId: string, projectId: string) => request<ProjectFile[]>(`/workspaces/${workspaceId}/projects/${projectId}/files/`);
export const listAssetFolders = (workspaceId: string) => request<ProjectFolder[]>(`/workspaces/${workspaceId}/asset-folders/`);
export const listAssetFiles = (workspaceId: string) => request<ProjectFile[]>(`/workspaces/${workspaceId}/asset-files/`);
export const listMediaVersions = (workspaceId: string, projectId: string) => request<MediaVersion[]>(`/workspaces/${workspaceId}/projects/${projectId}/media-versions/`);
export const controlMediaRender = (workspaceId: string, projectId: string, mediaVersionId: string, action: "retry" | "cancel") => request<{ status: string }>(`/workspaces/${workspaceId}/projects/${projectId}/media-versions/${mediaVersionId}/render/`, jsonBody({ action }));
export const listWorkflowStages = (workspaceId: string) => request<WorkflowStage[]>(`/workspaces/${workspaceId}/workflow-stages/`);
export const listRoles = (workspaceId: string) => request<Role[]>(`/workspaces/${workspaceId}/roles/`);
export const createRole = (workspaceId: string, payload: { name: string; description?: string; permission_keys: string[] }) =>
  request<Role>(`/workspaces/${workspaceId}/roles/`, jsonBody(payload));
export const listWorkspaceMembers = (workspaceId: string) => request<WorkspaceMembership[]>(`/workspaces/${workspaceId}/members/`);
export const updateWorkspaceMember = (workspaceId: string, membershipId: string, payload: { role_id?: string; project_access_mode?: string; status?: string }) =>
  request<WorkspaceMembership>(`/workspaces/${workspaceId}/members/${membershipId}/`, { ...jsonBody(payload), method: "PATCH" });
export const createWorkspaceInvite = (workspaceId: string, payload: { email: string; role_id: string; project_access_mode: string; expires_in_days: number }) =>
  request<WorkspaceInvite>(`/workspaces/${workspaceId}/invitations/`, jsonBody(payload));
export const listProjectAccess = (workspaceId: string, projectId: string) => request<ResourceAccess[]>(`/workspaces/${workspaceId}/projects/${projectId}/access/`);
export const grantProjectAccess = (workspaceId: string, projectId: string, membershipId: string) => request<ResourceAccess>(`/workspaces/${workspaceId}/projects/${projectId}/access/`, jsonBody({ membership_id: membershipId }));
export const revokeProjectAccess = (workspaceId: string, projectId: string, grantId: string) => request<void>(`/workspaces/${workspaceId}/projects/${projectId}/access/${grantId}/`, { method: "DELETE" });

export const createClientTeam = (workspaceId: string, payload: { name: string; description?: string; email?: string; website?: string; metadata?: ClientTeamMetadata }) =>
  request<ClientTeam>(`/workspaces/${workspaceId}/client-teams/`, jsonBody(payload));

/**
 * `Project` has no foreign key to `ClientTeam`, so which campaigns belong to a client is
 * recorded in the client team's existing `metadata` JSON field. See README notes in
 * `projects/actions.ts` — a real `Project.client_team` column would replace this.
 */
export const updateClientTeam = (workspaceId: string, clientTeamId: string, payload: Partial<Omit<ClientTeam, "id" | "status" | "created_at">>) =>
  request<ClientTeam>(`/workspaces/${workspaceId}/client-teams/${clientTeamId}/`, { ...jsonBody(payload), method: "PATCH" });
export const archiveClientTeam = (workspaceId: string, clientTeamId: string) => request<void>(`/workspaces/${workspaceId}/client-teams/${clientTeamId}/`, { method: "DELETE" });
export const getNotificationPreferences = () => request<NotificationPreference>("/notification-preferences/");
export const updateNotificationPreferences = (payload: NotificationPreference) => request<NotificationPreference>("/notification-preferences/", { ...jsonBody(payload), method: "PATCH" });

export const createProject = (workspaceId: string, payload: { name: string; client_team_id?: string; description?: string; priority?: string; due_at?: string }) =>
  request<Project>(`/workspaces/${workspaceId}/projects/`, jsonBody(payload));

export const createFolder = (workspaceId: string, projectId: string, payload: { name: string; parent_folder_id?: string }) =>
  request<ProjectFolder>(`/workspaces/${workspaceId}/projects/${projectId}/folders/`, jsonBody(payload));

export const updateProject = (workspaceId: string, projectId: string, payload: { name?: string; status?: string; priority?: string }) =>
  request<Project>(`/workspaces/${workspaceId}/projects/${projectId}/`, { ...jsonBody(payload), method: "PATCH" });

/** Archives rather than destroys: the API keeps the row and flips its status. */
export const archiveProject = (workspaceId: string, projectId: string) =>
  request<void>(`/workspaces/${workspaceId}/projects/${projectId}/`, { method: "DELETE" });

export const renameProjectFolder = (workspaceId: string, projectId: string, folderId: string, name: string) =>
  request<ProjectFolder>(`/workspaces/${workspaceId}/projects/${projectId}/folders/${folderId}/`, { ...jsonBody({ name }), method: "PATCH" });

export const deleteProjectFolder = (workspaceId: string, projectId: string, folderId: string) =>
  request<void>(`/workspaces/${workspaceId}/projects/${projectId}/folders/${folderId}/`, { method: "DELETE" });

export const uploadMediaVersion = (workspaceId: string, projectId: string, payload: FormData) =>
  request<MediaVersion>(`/workspaces/${workspaceId}/projects/${projectId}/media-versions/`, {
    method: "POST", body: payload,
  });

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
export const listTaskAttachments = (workspaceId: string, taskId: string) => request<TaskAttachment[]>(`/workspaces/${workspaceId}/tasks/${taskId}/attachments/`);
export const listTaskStages = (workspaceId: string) => request<TaskWorkflow>(`/workspaces/${workspaceId}/task-stages/`);
export const createTask = (workspaceId: string, payload: { title: string; client_team_id?: string | null; project_id?: string | null; assignee_id?: string | null; task_stage_id?: string | null; description?: string; priority?: string; status?: string; due_at?: string | null; sort_order?: number }) =>
  request<Task>(`/workspaces/${workspaceId}/tasks/`, jsonBody(payload));
export const updateTask = (workspaceId: string, taskId: string, payload: Partial<Pick<Task, "title" | "description" | "status" | "priority" | "start_at" | "due_at" | "sort_order" | "client_team_id" | "project_id" | "task_stage_id">> & { assignee_id?: string | null }) =>
  request<Task>(`/workspaces/${workspaceId}/tasks/${taskId}/`, { ...jsonBody(payload), method: "PATCH" });

/**
 * Review comments are offset-paginated (`app/pagination.py`): the body is a plain array
 * and the page metadata rides on `X-Pagination-*` headers. One page of up to
 * `REVIEW_MAX_PAGE_SIZE` covers every review the UI renders today.
 */
export const listReviewComments = (workspaceId: string, projectId: string, mediaVersionId: string) =>
  request<ReviewComment[]>(`/workspaces/${workspaceId}/projects/${projectId}/media-versions/${mediaVersionId}/comments/?limit=200`);

export const createReviewComment = (
  workspaceId: string, projectId: string, mediaVersionId: string,
  payload: { text: string; start_time_ms?: number; parent_comment_id?: string; mentioned_user_ids?: string[] },
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
export const setCommentReaction = (workspaceId: string, projectId: string, mediaVersionId: string, commentId: string, emoji: string, remove = false) =>
  request<ReviewComment | void>(`/workspaces/${workspaceId}/projects/${projectId}/media-versions/${mediaVersionId}/comments/${commentId}/reactions/`, { ...jsonBody({ emoji }), method: remove ? "DELETE" : "POST" });
export const requestMediaRevision = (workspaceId: string, projectId: string, mediaVersionId: string, payload: { text: string; start_time_ms?: number }) =>
  request<{ comment: ReviewComment; workflow: StageHistoryEntry; workflow_transitioned: boolean }>(`/workspaces/${workspaceId}/projects/${projectId}/media-versions/${mediaVersionId}/revision-requests/`, jsonBody(payload));
export const listAnnotations = (workspaceId: string, projectId: string, mediaVersionId: string) => request<Annotation[]>(`/workspaces/${workspaceId}/projects/${projectId}/media-versions/${mediaVersionId}/annotations/?limit=200`);
export const createAnnotation = (workspaceId: string, projectId: string, mediaVersionId: string, payload: { start_time_ms?: number; elements: Omit<AnnotationElement, "id">[] }) => request<Annotation>(`/workspaces/${workspaceId}/projects/${projectId}/media-versions/${mediaVersionId}/annotations/`, jsonBody(payload));
export const updateAnnotation = (workspaceId: string, projectId: string, mediaVersionId: string, annotationId: string, payload: { start_time_ms?: number; elements: Omit<AnnotationElement, "id">[] }) => request<Annotation>(`/workspaces/${workspaceId}/projects/${projectId}/media-versions/${mediaVersionId}/annotations/${annotationId}/`, { ...jsonBody(payload), method: "PATCH" });
export const deleteAnnotation = (workspaceId: string, projectId: string, mediaVersionId: string, annotationId: string) => request<void>(`/workspaces/${workspaceId}/projects/${projectId}/media-versions/${mediaVersionId}/annotations/${annotationId}/`, { method: "DELETE" });

export const transitionMediaVersion = (workspaceId: string, projectId: string, mediaVersionId: string, workflowStageId: string) =>
  request<StageHistoryEntry>(
    `/workspaces/${workspaceId}/projects/${projectId}/media-versions/${mediaVersionId}/workflow/`,
    jsonBody({ workflow_stage_id: workflowStageId }),
  );

export const listNotifications = () => request<Notification[]>("/notifications/");

/**
 * A guest review link, plus every guest who has exchanged it for a session.
 *
 * One invite can be redeemed by several people — each redemption becomes a
 * `GuestReviewAccess` with its own key — so a link is revoked as a whole, and an
 * individual reviewer is revoked through their access row.
 */
export const GUEST_PERMISSIONS = [
  "media.read", "media.download", "review.comment.read", "review.comment.create",
  "review.comment.edit", "review.comment.delete", "review.reaction.create",
  "review.attachment.create", "review.attachment.delete",
  "annotation.read", "annotation.create", "annotation.edit", "annotation.delete",
] as const;
export type GuestPermission = (typeof GUEST_PERMISSIONS)[number];
export type GuestAccess = {
  id: string; guest_session_id: string; name: string; email: string;
  permissions: GuestPermission[]; last_accessed_at: string | null;
  revoked_at: string | null; created_at: string;
};
export type GuestInvite = {
  id: string; project_id: string; label: string; permissions: GuestPermission[];
  expires_at: string; revoked_at: string | null; created_at: string;
  accesses: GuestAccess[];
  /** Returned only by the create call, and only once. */
  token?: string;
};

export const listGuestInvites = (workspaceId: string, projectId: string) =>
  request<GuestInvite[]>(`/workspaces/${workspaceId}/projects/${projectId}/guest-invites/`);
export const createGuestInvite = (workspaceId: string, projectId: string, payload: { label?: string; permissions: GuestPermission[]; expires_in_hours: number }) =>
  request<GuestInvite & { token: string }>(`/workspaces/${workspaceId}/projects/${projectId}/guest-invites/`, jsonBody(payload));
export const revokeGuestInvite = (workspaceId: string, projectId: string, inviteId: string) =>
  request<void>(`/workspaces/${workspaceId}/projects/${projectId}/guest-invites/${inviteId}/`, { method: "DELETE" });
export const revokeGuestAccess = (workspaceId: string, projectId: string, accessId: string) =>
  request<void>(`/workspaces/${workspaceId}/projects/${projectId}/guest-access/${accessId}/`, { method: "DELETE" });
