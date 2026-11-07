import { cookies } from "next/headers";
import { listWorkspaces, type ApiResult, type Workspace } from "./api";

export const WORKSPACE_COOKIE = "blazeflow_workspace";

export type WorkspaceContext = { workspaces: Workspace[]; selected: Workspace | null };

export async function selectWorkspace(workspaces: Workspace[]): Promise<Workspace | null> {
  const selectedId = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  return workspaces.find((workspace) => workspace.id === selectedId) ?? workspaces[0] ?? null;
}

export async function loadWorkspaceContext(): Promise<ApiResult<WorkspaceContext>> {
  const result = await listWorkspaces();
  if (!result.ok) return result;
  return { ok: true, data: { workspaces: result.data, selected: await selectWorkspace(result.data) } };
}
