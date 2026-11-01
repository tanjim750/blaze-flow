/** Browser-side calls for the Tasks board. Every request goes through the Next `/api` proxy. */
import type { Task, TaskAttachment } from "@/lib/api";

export type MoveResult = { task: Task; order: { id: string; sort_order: number }[]; side_effects: string[] };

function csrf(): string {
  return decodeURIComponent(document.cookie.split("; ").find((part) => part.startsWith("csrftoken="))?.slice(10) ?? "");
}

export async function api<T>(path: string, method = "GET", payload?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method, credentials: "include",
    headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | Record<string, string[]> | null;
    const detail = body && "detail" in body && typeof body.detail === "string" ? body.detail : body ? Object.values(body).flat().join(" ") : "";
    throw Error(detail || `Request failed (${response.status}).`);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

function workspace(workspaceId: string | null): string {
  if (!workspaceId) throw Error("No workspace selected.");
  return `workspaces/${workspaceId}`;
}

export const createTask = (workspaceId: string | null, payload: Record<string, unknown>) => api<Task>(`${workspace(workspaceId)}/tasks/`, "POST", payload);
export const patchTask = (workspaceId: string | null, taskId: string, payload: Record<string, unknown>) => api<Task>(`${workspace(workspaceId)}/tasks/${taskId}/`, "PATCH", payload);
export const deleteTask = (workspaceId: string | null, taskId: string) => api<void>(`${workspace(workspaceId)}/tasks/${taskId}/`, "DELETE");
export const moveTask = (workspaceId: string | null, taskId: string, stageId: string, position: number | null) =>
  api<MoveResult>(`${workspace(workspaceId)}/tasks/${taskId}/move/`, "POST", { task_stage_id: stageId, position });
export const listAttachments = (workspaceId: string | null, taskId: string) => api<TaskAttachment[]>(`${workspace(workspaceId)}/tasks/${taskId}/attachments/`);
export const linkAttachment = (workspaceId: string | null, taskId: string, fileId: string) =>
  api<TaskAttachment>(`${workspace(workspaceId)}/tasks/${taskId}/attachments/`, "POST", { file_id: fileId });
export const stageRequest = <T,>(workspaceId: string | null, path: string, method: string, payload?: unknown) =>
  api<T>(`${workspace(workspaceId)}/task-stages/${path}`, method, payload);
