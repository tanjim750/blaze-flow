/**
 * Upload links and client uploads: types, the browser-side calls, and the pure rules the
 * drop zone checks before a byte leaves the machine (the server checks them again).
 *
 * Calls go through same-origin `/api/*` (the Next rewrite to Django). The public endpoints
 * are `@authentication_classes([])`, so they need no CSRF token; the signed-in ones read it
 * from the `csrftoken` cookie like the rest of the browser-side clients.
 */

export type UploadKind = "video" | "image" | "audio" | "document";
export const UPLOAD_KINDS: { value: UploadKind; label: string }[] = [
  { value: "video", label: "Video" },
  { value: "image", label: "Images" },
  { value: "audio", label: "Audio" },
  { value: "document", label: "Documents" },
];

export type UploadLinkStatus = "active" | "expired" | "revoked";
export type UploadLink = {
  id: string; project_id: string; label: string; instructions: string; token: string; path: string;
  due_at: string | null; expires_at: string | null; max_file_bytes: number | null; allowed_kinds: UploadKind[];
  status: UploadLinkStatus; created_by: { id: string; name: string; email: string } | null; created_at: string;
  revoked_at: string | null; upload_count: number; last_upload_at: string | null;
};
export type ClientUploadRow = {
  id: string; project_id: string; project_file_id: string; folder_id: string | null; file_name: string;
  mime_type: string; size_bytes: number; kind: UploadKind; status: string; removed: boolean;
  uploader_name: string; uploader_email: string; via: "link" | "portal"; upload_link_label: string | null;
  batch_id: string; created_at: string;
};
export type PublicUploadLink = {
  studio_name: string; project_name: string; label: string; instructions: string;
  due_at: string | null; expires_at: string | null; max_file_bytes: number; allowed_kinds: UploadKind[]; accept: string[];
  /** Absent on backends older than client portal v2. */
  branding?: import("./portal").Branding;
};
export type ClientPortal = {
  projects: { id: string; name: string; status: string }[];
  recent_uploads: ClientUploadRow[]; max_file_bytes: number; accept: string[];
  branding?: import("./portal").Branding;
};
export type UploadLinkInput = {
  label: string; instructions?: string; due_at?: string | null; expires_at?: string | null;
  max_file_bytes?: number | null; allowed_kinds?: UploadKind[];
};

// ------------------------------------------------------------------ pure rules

const DOCUMENT_EXTENSIONS = ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "rtf"];

/** What kind a picked file is, from its type (or its extension when the browser gives none). */
export function kindOf(file: { name: string; type: string }): UploadKind | null {
  const head = file.type.split("/")[0];
  if (head === "video" || head === "image" || head === "audio") return head;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (file.type === "application/pdf" || file.type.includes("officedocument") || file.type.includes("msword") || DOCUMENT_EXTENSIONS.includes(extension)) return "document";
  if (["mov", "mp4", "m4v", "webm", "mkv"].includes(extension)) return "video";
  return null;
}

/** "1.5 GB", "320 MB", "48 KB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "?";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value >= 10 || Number.isInteger(value) ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

const kindList = (kinds: UploadKind[]) => {
  const labels = kinds.map((kind) => UPLOAD_KINDS.find((entry) => entry.value === kind)?.label.toLowerCase() ?? kind);
  return labels.length <= 1 ? labels.join("") : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
};

/** Why this file will be refused, or null when it may go. Mirrors the server's checks. */
export function rejectReason(file: { name: string; type: string; size: number }, rules: { maxBytes: number; allowedKinds: UploadKind[] }): string | null {
  if (file.size <= 0) return "This file is empty.";
  if (file.size > rules.maxBytes) return `Too large: ${formatBytes(file.size)}, the limit is ${formatBytes(rules.maxBytes)}.`;
  const kind = kindOf(file);
  if (!kind) return "This type of file is not accepted.";
  if (rules.allowedKinds.length && !rules.allowedKinds.includes(kind)) return `Only ${kindList(rules.allowedKinds)} can be sent here.`;
  return null;
}

/** "Video, images and documents" for the drop zone; "Any video, image, audio or document" when unrestricted. */
export function acceptedSummary(kinds: UploadKind[]): string {
  if (!kinds.length || kinds.length === UPLOAD_KINDS.length) return "Video, images, audio and documents";
  const text = kindList(kinds);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Oct 14, 17:00" in the viewer's zone. */
export function shortDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "?";
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** The status line under a link in the manager: "Active · expires Oct 14, 17:00 · 3 files". */
export function linkSummary(link: Pick<UploadLink, "status" | "expires_at" | "due_at" | "upload_count" | "revoked_at">): string {
  const parts: string[] = [];
  if (link.status === "revoked") parts.push(link.revoked_at ? `Turned off ${shortDateTime(link.revoked_at)}` : "Turned off");
  else if (link.status === "expired") parts.push(link.expires_at ? `Expired ${shortDateTime(link.expires_at)}` : "Expired");
  else {
    parts.push("Active");
    if (link.due_at) parts.push(`due ${shortDateTime(link.due_at)}`);
    if (link.expires_at) parts.push(`closes ${shortDateTime(link.expires_at)}`);
  }
  parts.push(link.upload_count === 1 ? "1 file" : `${link.upload_count} files`);
  return parts.join(" · ");
}

/** A datetime-local value ("2026-10-14T17:00") as an ISO string, or null when empty. */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** MB typed in the form → bytes (null when blank). */
export function megabytesToBytes(value: string): number | null {
  const number = Number(value);
  return value.trim() && Number.isFinite(number) && number > 0 ? Math.round(number * 1024 * 1024) : null;
}

// ------------------------------------------------------------------ network

const csrfToken = () =>
  typeof document === "undefined" ? "" : decodeURIComponent(document.cookie.split("; ").find((item) => item.startsWith("csrftoken="))?.slice(10) ?? "");

export type CallResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export async function call<T>(path: string, init: RequestInit = {}): Promise<CallResult<T>> {
  let response: Response;
  try {
    const csrf = csrfToken();
    response = await fetch(`/api${path}`, {
      ...init, credentials: "include",
      headers: { Accept: "application/json", ...(csrf ? { "X-CSRFToken": csrf } : {}), ...(init.headers ?? {}) },
    });
  } catch {
    return { ok: false, status: 0, error: "Blaze Flow could not be reached. Check your connection and try again." };
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null;
    return { ok: false, status: response.status, error: body?.detail || `Request failed (${response.status}).` };
  }
  return { ok: true, data: (response.status === 204 ? undefined : await response.json()) as T };
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const project = (workspaceId: string, projectId: string) => `/workspaces/${workspaceId}/projects/${projectId}`;

export const listUploadLinks = (workspaceId: string, projectId: string) => call<UploadLink[]>(`${project(workspaceId, projectId)}/upload-links/`);
export const createUploadLink = (workspaceId: string, projectId: string, input: UploadLinkInput) =>
  call<UploadLink>(`${project(workspaceId, projectId)}/upload-links/`, json("POST", input));
export const revokeUploadLink = (workspaceId: string, projectId: string, linkId: string) =>
  call<UploadLink>(`${project(workspaceId, projectId)}/upload-links/${linkId}/`, { method: "DELETE" });
export const listClientUploads = (workspaceId: string, projectId: string) => call<ClientUploadRow[]>(`${project(workspaceId, projectId)}/client-uploads/`);
export const getClientPortal = (workspaceId: string) => call<ClientPortal>(`/workspaces/${workspaceId}/client-portal/`);

export const publicUploadUrl = (token: string) => `/api/public/upload-links/${encodeURIComponent(token)}/files/`;
export const portalUploadUrl = (workspaceId: string, projectId: string) => `/api${project(workspaceId, projectId)}/client-uploads/`;

/** Progress as a fraction 0..1, or null while the browser cannot tell yet. */
export type ProgressHandler = (fraction: number | null) => void;

/**
 * POSTs one file with XHR, because `fetch` cannot report upload progress. Resolves with the
 * server's message on failure rather than throwing, so a queue can carry on with the rest.
 */
export function sendFile(url: string, file: File, fields: Record<string, string>, onProgress: ProgressHandler, signal?: AbortSignal): Promise<CallResult<unknown>> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const body = new FormData();
    Object.entries(fields).forEach(([key, value]) => body.append(key, value));
    body.append("file", file);
    xhr.open("POST", url);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Accept", "application/json");
    const csrf = csrfToken();
    if (csrf) xhr.setRequestHeader("X-CSRFToken", csrf);
    xhr.upload.onprogress = (event) => onProgress(event.lengthComputable ? event.loaded / event.total : null);
    xhr.onload = () => {
      let data: unknown = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* not JSON (proxy error page) */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve({ ok: true, data });
      else resolve({ ok: false, status: xhr.status, error: uploadError(xhr.status, data) });
    };
    xhr.onerror = () => resolve({ ok: false, status: 0, error: "The upload was interrupted. Check your connection and try again." });
    xhr.onabort = () => resolve({ ok: false, status: 0, error: "Cancelled." });
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(body);
  });
}

/** The server's own words when it gave any; a plain sentence for throttling and proxies. */
export function uploadError(status: number, data: unknown): string {
  const body = data as { detail?: unknown; file?: unknown; name?: unknown; email?: unknown } | null;
  if (body && typeof body.detail === "string") return status === 429 && !/limit/i.test(body.detail) ? "Too many uploads in a short time. Wait a few minutes and try again." : body.detail;
  for (const key of ["file", "name", "email"] as const) {
    const value = body?.[key];
    if (Array.isArray(value) && typeof value[0] === "string") return `${key === "file" ? "File" : key === "name" ? "Name" : "Email"}: ${value[0]}`;
  }
  if (status === 413) return "This file is larger than the server accepts.";
  if (status === 429) return "Too many uploads in a short time. Wait a few minutes and try again.";
  return `The upload failed (${status || "network error"}).`;
}

export const newBatchId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
