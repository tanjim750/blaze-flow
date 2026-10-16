"use server";

import { revalidatePath } from "next/cache";
import { archiveProject, createClientTeam, createFolder, createProject, deleteProjectFolder, listWorkspaces, renameProjectFolder, updateProject } from "@/lib/api";
import { selectWorkspace } from "@/lib/workspace";

/**
 * `savedAt` exists so a caller can tell a completed write from the initial state: both
 * have `error: null`, which is why the inline create forms used to stay open after
 * successfully creating something.
 */
export type ActionState = { error: string | null; savedAt: number | null };
const ok = (): ActionState => ({ error: null, savedAt: Date.now() });

async function currentWorkspaceId(): Promise<{ id: string } | ActionState> {
  const workspaces = await listWorkspaces();
  if (!workspaces.ok) return { error: workspaces.error.detail, savedAt: null };
  const workspace = await selectWorkspace(workspaces.data);
  return workspace ? { id: workspace.id } : { error: "No workspace is available for this account.", savedAt: null };
}

const isFailure = (value: { id: string } | ActionState): value is ActionState => "error" in value;

/** Creates a client team — the top level of the Projects tree. */
export async function createClientAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const name = String(form.get("name") ?? "").trim();
  if (!name) return { error: "Enter a client name.", savedAt: null };
  const workspace = await currentWorkspaceId();
  if (isFailure(workspace)) return workspace;

  const created = await createClientTeam(workspace.id, { name });
  if (!created.ok) return { error: created.error.detail, savedAt: null };
  revalidatePath("/projects");
  return ok();
}

/**
 * Creates a campaign under a client.
 *
 * A campaign is a `Project` linked directly to its client team in the same write.
 */
export async function createCampaignAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const name = String(form.get("name") ?? "").trim();
  const clientId = String(form.get("clientId") ?? "");
  if (!name) return { error: "Enter a campaign name.", savedAt: null };
  if (!clientId || clientId === "unassigned") return { error: "Select a client first.", savedAt: null };
  const workspace = await currentWorkspaceId();
  if (isFailure(workspace)) return workspace;

  const project = await createProject(workspace.id, { name, client_team_id: clientId });
  if (!project.ok) return { error: project.error.detail, savedAt: null };

  revalidatePath("/projects");
  return ok();
}

/** Creates a folder inside a campaign, optionally nested under another folder. */
export async function createFolderAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const name = String(form.get("name") ?? "").trim();
  const campaignId = String(form.get("campaignId") ?? "");
  const parentId = String(form.get("parentFolderId") ?? "");
  if (!name) return { error: "Enter a folder name.", savedAt: null };
  if (!campaignId) return { error: "Select a campaign first.", savedAt: null };
  const workspace = await currentWorkspaceId();
  if (isFailure(workspace)) return workspace;

  const folder = await createFolder(workspace.id, campaignId, parentId ? { name, parent_folder_id: parentId } : { name });
  if (!folder.ok) return { error: folder.error.detail, savedAt: null };
  revalidatePath("/projects");
  return ok();
}

/** Renames a campaign. The tree calls this one a subfolder; the API calls it a project. */
export async function renameCampaignAction(campaignId: string, name: string): Promise<ActionState> {
  const trimmed = name.trim();
  if (!trimmed) return { error: "Enter a name.", savedAt: null };
  const workspace = await currentWorkspaceId();
  if (isFailure(workspace)) return workspace;

  const updated = await updateProject(workspace.id, campaignId, { name: trimmed });
  if (!updated.ok) return { error: updated.error.detail, savedAt: null };
  revalidatePath("/projects");
  return ok();
}

/**
 * Removes a campaign from the tree.
 *
 * The API archives rather than destroys — the row and everything under it survive — which
 * is why the listing endpoint now excludes archived projects. Without that the row stayed
 * on screen and the delete looked like it had failed.
 */
export async function deleteCampaignAction(campaignId: string): Promise<ActionState> {
  const workspace = await currentWorkspaceId();
  if (isFailure(workspace)) return workspace;

  const archived = await archiveProject(workspace.id, campaignId);
  if (!archived.ok) return { error: archived.error.detail, savedAt: null };
  revalidatePath("/projects");
  revalidatePath("/files");
  revalidatePath("/tasks");
  return ok();
}

export async function renameFolderAction(campaignId: string, folderId: string, name: string): Promise<ActionState> {
  const trimmed = name.trim();
  if (!trimmed) return { error: "Enter a name.", savedAt: null };
  const workspace = await currentWorkspaceId();
  if (isFailure(workspace)) return workspace;

  const renamed = await renameProjectFolder(workspace.id, campaignId, folderId, trimmed);
  if (!renamed.ok) return { error: renamed.error.detail, savedAt: null };
  revalidatePath("/projects");
  return ok();
}

export async function deleteFolderAction(campaignId: string, folderId: string): Promise<ActionState> {
  const workspace = await currentWorkspaceId();
  if (isFailure(workspace)) return workspace;

  const removed = await deleteProjectFolder(workspace.id, campaignId, folderId);
  if (!removed.ok) return { error: removed.error.detail, savedAt: null };
  revalidatePath("/projects");
  revalidatePath("/files");
  return ok();
}
