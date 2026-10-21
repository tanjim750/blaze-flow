import type { ProjectFile, ProjectFolder } from "./api";
import { reviewHref } from "./open-in-review";
import { startUpload } from "./upload-store";

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const csrf = decodeURIComponent(document.cookie.split("; ").find((item) => item.startsWith("csrftoken="))?.slice(10) ?? "");
  const response = await fetch(`/api${path}`, { ...init, credentials: "include", headers: { Accept: "application/json", ...(csrf ? { "X-CSRFToken": csrf } : {}), ...(init.headers ?? {}) } });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.detail || `Asset request failed (${response.status}).`);
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const createAssetFolder = (workspaceId: string, body: { name: string; client_team_id: string | null; project_id: string | null; parent_folder_id: string | null }) =>
  call<ProjectFolder>(`/workspaces/${workspaceId}/asset-folders/`, json("POST", body));
export const updateAssetFolder = (workspaceId: string, id: string, body: Record<string, unknown>) => call<ProjectFolder>(`/workspaces/${workspaceId}/asset-folders/${id}/`, json("PATCH", body));
export const deleteAssetFolder = (workspaceId: string, id: string) => call<void>(`/workspaces/${workspaceId}/asset-folders/${id}/`, { method: "DELETE" });
export const uploadAssetFile = (workspaceId: string, file: File, relationships: { client_team_id: string | null; project_id: string | null; folder_id: string | null; task_stage_id?: string | null }) => {
  const body = new FormData(); body.append("file", file); Object.entries(relationships).forEach(([key, value]) => { if (value) body.append(key, value); });
  return call<ProjectFile>(`/workspaces/${workspaceId}/asset-files/`, { method: "POST", body });
};
export const updateAssetFile = (workspaceId: string, id: string, body: Record<string, unknown>) => call<ProjectFile & SyncedTasks>(`/workspaces/${workspaceId}/asset-files/${id}/`, json("PATCH", body));
/** Copies an asset in place. The server names it "… (copy)" and re-scans the bytes. */
export const duplicateAssetFile = (workspaceId: string, id: string) =>
  call<ProjectFile>(`/workspaces/${workspaceId}/asset-files/${id}/duplicate/`, { method: "POST" });
/** Makes `sourceId` the next version of the asset `targetId` belongs to. */
export const addAssetFileVersion = (workspaceId: string, targetId: string, sourceId: string) =>
  call<ProjectFile>(`/workspaces/${workspaceId}/asset-files/${targetId}/versions/`, json("POST", { file_id: sourceId }));
export const deleteAssetFile = (workspaceId: string, id: string) => call<void>(`/workspaces/${workspaceId}/asset-files/${id}/`, { method: "DELETE" });

/**
 * `uploadAssetFile` through the global upload queue, so the tray shows it (progress, scan,
 * preview) and it survives page changes. Rejects on failure like `call`. `onRetried` runs if
 * the user retries a failed upload from the tray and it lands.
 */
export function uploadAssetFileTracked(workspaceId: string, file: File, relationships: { client_team_id: string | null; project_id: string | null; folder_id: string | null; task_stage_id?: string | null }, destination: string | null, onRetried?: (saved: ProjectFile) => void): Promise<ProjectFile> {
  const fields: Record<string, string> = {};
  Object.entries(relationships).forEach(([key, value]) => { if (value) fields[key] = value; });
  let first = true;
  const { done } = startUpload({
    url: `/api/workspaces/${workspaceId}/asset-files/`, file, fields, source: "files", destination,
    // Straight to R2 when the server has direct uploads on; otherwise the same form POST.
    direct: { workspaceId },
    describe: (data) => { const saved = data as ProjectFile; return { workspaceId, fileId: saved.file.id, href: reviewHref({ mediaId: saved.file.id }) }; },
    onSuccess: (data) => { if (!first) onRetried?.(data as ProjectFile); },
  });
  return done.then((result) => { first = false; if (result.ok) return result.data as ProjectFile; throw new Error(result.error); });
}

/** The PATCH response also lists tasks that followed the file into an Approval/Revisions/Client review column. */
export type SyncedTasks = { synced_tasks?: { id: string; title: string }[] };

/** "Hero cut moved too" / "3 tasks moved too", or null when no task followed the file. */
export function syncedTasksMessage(result: SyncedTasks | null | undefined, stageName?: string | null): string | null {
  const tasks = result?.synced_tasks ?? [];
  if (!tasks.length) return null;
  const where = stageName ? ` to ${stageName}` : "";
  return tasks.length === 1 ? `Task “${tasks[0].title}” moved${where} too` : `${tasks.length} linked tasks moved${where} too`;
}
