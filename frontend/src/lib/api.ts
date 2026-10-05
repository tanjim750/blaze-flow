import { cookies } from "next/headers";
import { describeErrorBody } from "./errors";
import type { ActivityPage, GuestLinkActivity } from "./activity";
import type { DecisionKind, DecisionViewer, ReviewDecision } from "./review-decisions";

/**
 * Server-side client for the Blaze Flow Django API.
 *
 * Requests go straight to the Django origin rather than through the Next rewrite,
 * so that a server component does not issue a request back into its own server.
 * Django uses SessionAuthentication, so the browser's session cookie is forwarded
 * verbatim and unsafe methods carry the matching CSRF token.
 */
const API_ORIGIN = process.env.BLAZEFLOW_API_URL ?? "http://127.0.0.1:8000";

export type Workspace = {
  id: string; name: string; slug: string; timezone: string; status: string; created_at: string;
  /** The viewer's own membership here (what task assignee ids refer to). Null via a client team; absent on older backends. */
  my_membership_id?: string | null;
  /** Which dashboard layout fits the viewer here, derived from permissions. Absent on older backends. */
  dashboard_role?: DashboardRole | null;
  /** What the viewer may do with money here (billing demo). Always all-false via a client team. Absent on older backends. */
  billing?: { view: boolean; manage: boolean; rates_view: boolean };
};
/** `owner` runs the workspace, `editor` is any other team member, `client` is in only through a client team. */
export type DashboardRole = "owner" | "editor" | "client";
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
/** GET/PATCH /notification-preferences/ with a workspace: the email switch plus per-kind in-app switches. */
export type NotificationSettings = NotificationPreference & {
  workspace_id: string | null;
  in_app: Record<string, boolean> | null;
  kinds: { kind: string; label: string; description: string }[];
};
export type Project = { id: string; workspace_id: string; client_team_id: string | null; name: string; description: string | null; status: string; priority: string; start_at: string | null; due_at: string | null; created_at: string; updated_at: string;
  /** Brief & Specs. Every key is present (null when unset); absent on older backends. */
  deliverable_specs?: { aspect_ratio: string | null; target_length_seconds: number | null; platform: string | null; resolution: string | null; notes: string | null };
  /** Whether the viewer may edit this project. Only the detail route fills it in; null elsewhere. */
  viewer_can_edit?: boolean | null;
};
export type ProjectFolder = { id: string; workspace_id: string; client_team_id: string | null; project_id: string | null; parent_folder_id: string | null; name: string; created_at: string };
export type MediaFile = { id: string; name: string; mime_type: string; size_bytes: number };
export type ProjectFile = { id: string; workspace_id: string; client_team_id: string | null; project_id: string | null; folder_id: string | null; task_stage_id: string | null; file: MediaFile & { checksum_sha256: string; status: string; duration_ms: number | null }; added_by: { id: string; name: string; email: string } | null; poster: { width: number | null; height: number | null } | null; comment_count: number;
  /** Which cut of its asset this row is, counting from 1. */
  version_number: number;
  /** The asset it is a version of. Null only for rows that predate versioning. */
  media_asset: { id: string; name: string; version_count: number; is_latest: boolean } | null;
  created_at: string;
};
export type WorkflowStageRef = { id: string; name: string; slug: string };
export type WorkflowStageStatus = { id: string; name: string; slug: string; sort_order: number };
export type WorkflowStage = { id: string; name: string; slug: string; sort_order: number; statuses: WorkflowStageStatus[] };
export type StageHistoryEntry = { id: string; stage: WorkflowStageRef | null; entered_at: string; exited_at: string | null };
export type MediaVersion = {
  id: string; project_id: string; version_number: number; title: string; note: string | null;
  priority: string; allow_download: boolean; status: string; file: MediaFile;
  /** `entered_at` / `changed_by` say who moved the cut into this stage, and when. */
  current_stage: (WorkflowStageRef & { entered_at?: string | null; changed_by?: { id: string | null; name: string; type?: "user" | "guest" } | null }) | null;
  preview_status: string; created_at: string;
  /** A video's poster frame or an image's thumbnail, once generated. Absent on older backends. */
  poster?: { url: string; width: number | null; height: number | null } | null;
};

export type CurrentUser = {
  id: string; email: string; first_name: string; last_name: string;
  avatar_url: string | null; timezone: string; status: string;
  email_verified_at: string | null; created_at: string;
};
export type CommentAuthor = { id: string; email: string; name: string; type: "user" | "guest" };
/** One review note. `text` is null when the comment carries only attachments. */
export type CommentVisibility = "team" | "client";
export type ReviewComment = {
  id: string; parent_comment_id: string | null; author: CommentAuthor | null; text: string | null;
  start_time_ms: number | null; end_time_ms: number | null;
  resolved: boolean; resolved_by_user_id: string | null; resolved_at: string | null;
  /** `team` notes are internal: the guest endpoints never return them. Absent on old payloads. */
  visibility?: CommentVisibility;
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
  /** Attached `File` ids in attach order (joined to asset files for thumbnails). Older payloads omit it. */
  attachment_file_ids?: string[];
};
/**
 * A file attached to a task. `file.id` is the same `File` row a `ProjectFile` or a
 * `MediaVersion` points at, so this is what makes "Task -> attachment -> Review" open the
 * very same media rather than a copy of it.
 */
export type TaskAttachment = { id: string; file: MediaFile & { checksum_sha256: string; status: string }; attached_at: string };
/** What a stage means, independent of its name. `custom` for user-made stages; absent on older payloads. */
export type TaskStageKind = "todo" | "in_progress" | "review" | "client_review" | "revisions" | "approved" | "custom";
export type TaskStage = { id: string; name: string; color: string; sort_order: number; wip_limit: number | null; is_done: boolean; automation_enabled: boolean; task_count: number; kind?: TaskStageKind };
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

/** Exported for feature modules that keep their routes in their own file (e.g. `billing-api.ts`). */
export async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
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
/** The viewer's effective permission keys here (and on one project). See lib/permissions.ts. */
export const getWorkspacePermissions = (workspaceId: string, projectId?: string | null) =>
  request<import("./permissions").PermissionsAnswer>(`/workspaces/${workspaceId}/permissions/${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ""}`);
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
/** The client portal's upload area: projects this viewer may send files to, and what they sent. */
export const getMessageUnread = (workspaceId: string) => request<import("./messages").UnreadSummary>(`/workspaces/${workspaceId}/messages/unread/`);
export const getChatChannels = (workspaceId: string) => request<import("./messages").ChatList>(`/workspaces/${workspaceId}/chat/channels/`);
export const getClientPortalData = (workspaceId: string) => request<import("./client-uploads").ClientPortal>(`/workspaces/${workspaceId}/client-portal/`);
export const getClientProjectOverview = (workspaceId: string, projectId: string) => request<import("./portal").ProjectOverview>(`/workspaces/${workspaceId}/client-portal/projects/${projectId}/`);
export const listProjectRequests = (workspaceId: string, status?: string) => request<import("./portal").ProjectRequestList>(`/workspaces/${workspaceId}/project-requests/${status ? `?status=${encodeURIComponent(status)}` : ""}`);
export const getBranding = (workspaceId: string) => request<import("./portal").Branding>(`/workspaces/${workspaceId}/branding/`);
export const listProjects = (workspaceId: string) => request<Project[]>(`/workspaces/${workspaceId}/projects/`);
export const getProject = (workspaceId: string, projectId: string) => request<Project>(`/workspaces/${workspaceId}/projects/${projectId}/`);
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
export const getNotificationSettings = (workspaceId: string) => request<NotificationSettings>(`/notification-preferences/?workspace=${encodeURIComponent(workspaceId)}`);
export const updateNotificationSettings = (payload: { workspace_id: string; in_app?: Record<string, boolean>; email_mentions_enabled?: boolean }) =>
  request<NotificationSettings>("/notification-preferences/", { ...jsonBody(payload), method: "PATCH" });
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
export const getTask = (workspaceId: string, taskId: string) => request<Task>(`/workspaces/${workspaceId}/tasks/${taskId}/`);
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
  payload: { text: string; start_time_ms?: number; end_time_ms?: number; parent_comment_id?: string; mentioned_user_ids?: string[]; visibility?: CommentVisibility },
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
export const createAnnotation = (workspaceId: string, projectId: string, mediaVersionId: string, payload: { start_time_ms?: number; end_time_ms?: number; review_comment_id?: string; elements: Omit<AnnotationElement, "id">[] }) => request<Annotation>(`/workspaces/${workspaceId}/projects/${projectId}/media-versions/${mediaVersionId}/annotations/`, jsonBody(payload));
export const updateAnnotation = (workspaceId: string, projectId: string, mediaVersionId: string, annotationId: string, payload: { start_time_ms?: number; elements: Omit<AnnotationElement, "id">[] }) => request<Annotation>(`/workspaces/${workspaceId}/projects/${projectId}/media-versions/${mediaVersionId}/annotations/${annotationId}/`, { ...jsonBody(payload), method: "PATCH" });
export const deleteAnnotation = (workspaceId: string, projectId: string, mediaVersionId: string, annotationId: string) => request<void>(`/workspaces/${workspaceId}/projects/${projectId}/media-versions/${mediaVersionId}/annotations/${annotationId}/`, { method: "DELETE" });

export const transitionMediaVersion = (workspaceId: string, projectId: string, mediaVersionId: string, workflowStageId: string) =>
  request<StageHistoryEntry>(
    `/workspaces/${workspaceId}/projects/${projectId}/media-versions/${mediaVersionId}/workflow/`,
    jsonBody({ workflow_stage_id: workflowStageId }),
  );

export const listNotifications = () => request<Notification[]>("/notifications/");

/**
 * The activity feed, already permission-scoped by the API. `type` is a category (tasks, comments, media, guests).
 * `mine` keeps only what other people did on the viewer's own tasks and cuts.
 */
export const listActivity = (workspaceId: string, options: { pageSize?: number; page?: number; projectId?: string; type?: string; mine?: boolean } = {}) => {
  const query = new URLSearchParams({ page: String(options.page ?? 1), page_size: String(options.pageSize ?? 30) });
  if (options.type) query.set("type", options.type);
  if (options.mine) query.set("mine", "1");
  const base = options.projectId ? `/workspaces/${workspaceId}/projects/${options.projectId}/activity/` : `/workspaces/${workspaceId}/activity/`;
  return request<ActivityPage>(`${base}?${query.toString()}`);
};

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
  // "Allow decisions": approve or request changes on the cut being viewed.
  "review.decision.create",
] as const;
export type GuestPermission = (typeof GUEST_PERMISSIONS)[number];
export type GuestAccess = {
  id: string; guest_session_id: string; name: string; email: string;
  permissions: GuestPermission[]; last_accessed_at: string | null;
  revoked_at: string | null; created_at: string;
};
export type GuestInvite = {
  id: string; project_id: string; label: string; permissions: GuestPermission[];
  /** Whether guests on this link may approve or request changes. Absent on older backends. */
  allow_decisions?: boolean;
  expires_at: string; revoked_at: string | null; created_at: string;
  accesses: GuestAccess[];
  /** Built from guest events: last opened, on which cut, and that cut's decision. List route only. */
  activity?: GuestLinkActivity | null;
  /** Returned only by the create call, and only once. */
  token?: string;
};

export const listGuestInvites = (workspaceId: string, projectId: string) =>
  request<GuestInvite[]>(`/workspaces/${workspaceId}/projects/${projectId}/guest-invites/`);
export const createGuestInvite = (workspaceId: string, projectId: string, payload: { label?: string; permissions: GuestPermission[]; expires_in_hours: number }) =>
  request<GuestInvite & { token: string }>(`/workspaces/${workspaceId}/projects/${projectId}/guest-invites/`, jsonBody(payload));
/** Turns "Allow decisions" on or off for a link and everyone already using it. */
export const updateGuestInvite = (workspaceId: string, projectId: string, inviteId: string, payload: { allow_decisions: boolean }) =>
  request<GuestInvite>(`/workspaces/${workspaceId}/projects/${projectId}/guest-invites/${inviteId}/`, { ...jsonBody(payload), method: "PATCH" });
/** Client decisions recorded on one cut, and which review-bar buttons the viewer may use. */
export const listMediaDecisions = (workspaceId: string, projectId: string, mediaVersionId: string) =>
  request<{ results: ReviewDecision[]; viewer: DecisionViewer }>(`/workspaces/${workspaceId}/projects/${projectId}/media-versions/${mediaVersionId}/decisions/`);
/** A client-team member's Approve / Request changes. Team members use the workflow routes. */
export const createMediaDecision = (workspaceId: string, projectId: string, mediaVersionId: string, payload: { decision: DecisionKind; message?: string; start_time_ms?: number }) =>
  request<ReviewDecision>(`/workspaces/${workspaceId}/projects/${projectId}/media-versions/${mediaVersionId}/decisions/`, jsonBody(payload));
export const revokeGuestInvite = (workspaceId: string, projectId: string, inviteId: string) =>
  request<void>(`/workspaces/${workspaceId}/projects/${projectId}/guest-invites/${inviteId}/`, { method: "DELETE" });
export const revokeGuestAccess = (workspaceId: string, projectId: string, accessId: string) =>
  request<void>(`/workspaces/${workspaceId}/projects/${projectId}/guest-access/${accessId}/`, { method: "DELETE" });

/* Role dashboards ------------------------------------------------------------------- */

export type DashboardPerson = { type: "user" | "guest"; id: string | null; name: string; initials: string; avatar_url: string | null };
/** A cut as the dashboard routes describe it. `stage` is its workflow stage, null if it has none. */
export type DashboardCutRef = {
  id: string; title: string; version_number: number; file_id: string;
  project: { id: string; name: string };
  stage: { id: string; name: string; slug: string; entered_at: string | null } | null;
};
/** Why a cut is the viewer's: they uploaded it, or it is linked to a task assigned to them. */
export type CutReason = "uploaded" | "assigned";
export type NoteToAddress = {
  id: string; text: string | null; start_time_ms: number | null; end_time_ms: number | null;
  visibility: CommentVisibility; author: DashboardPerson; reply_count: number; created_at: string;
  reasons: CutReason[]; media: DashboardCutRef;
  /** `/review?media=<file>&comment=<id>&t=<ms>`: opens the cut at the note. */
  href: string;
};
export type MyCut = DashboardCutRef & {
  created_at: string; reasons: CutReason[]; open_notes: number; href: string;
  poster: { url: string; width: number | null; height: number | null } | null;
};
export type WorkloadRow = {
  membership_id: string; user: Omit<DashboardPerson, "type">;
  open: number; overdue: number; due_this_week: number;
};
export type TeamWorkload = { results: WorkloadRow[]; unassigned: { open: number; overdue: number }; total_open: number; generated_at: string };

/** Unresolved notes from other people on the viewer's cuts. Team-only notes never reach client members. */
export const listNotesToAddress = (workspaceId: string, limit = 20) =>
  request<{ results: NoteToAddress[]; count: number }>(`/workspaces/${workspaceId}/dashboard/notes-to-address/?limit=${limit}`);
export const listMyCuts = (workspaceId: string, limit = 20) =>
  request<{ results: MyCut[]; count: number }>(`/workspaces/${workspaceId}/dashboard/my-cuts/?limit=${limit}`);
/** Open tasks per team member. Owners and admins only (403 otherwise). */
export const getTeamWorkload = (workspaceId: string) => request<TeamWorkload>(`/workspaces/${workspaceId}/dashboard/workload/`);
