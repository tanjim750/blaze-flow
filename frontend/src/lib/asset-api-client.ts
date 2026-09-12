import type { ProjectFile, ProjectFolder } from "./api";

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
export const updateAssetFile = (workspaceId: string, id: string, body: Record<string, unknown>) => call<ProjectFile>(`/workspaces/${workspaceId}/asset-files/${id}/`, json("PATCH", body));
/** Copies an asset in place. The server names it "… (copy)" and re-scans the bytes. */
export const duplicateAssetFile = (workspaceId: string, id: string) =>
  call<ProjectFile>(`/workspaces/${workspaceId}/asset-files/${id}/duplicate/`, { method: "POST" });
export const deleteAssetFile = (workspaceId: string, id: string) => call<void>(`/workspaces/${workspaceId}/asset-files/${id}/`, { method: "DELETE" });
