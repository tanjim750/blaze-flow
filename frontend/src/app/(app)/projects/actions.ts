"use server";

import { revalidatePath } from "next/cache";
import { createClientTeam, createFolder, createProject, listWorkspaces } from "@/lib/api";
import { selectWorkspace } from "@/lib/workspace";

export type ActionState = { error: string | null };
const ok: ActionState = { error: null };

async function currentWorkspaceId(): Promise<{ id: string } | ActionState> {
  const workspaces = await listWorkspaces();
  if (!workspaces.ok) return { error: workspaces.error.detail };
  const workspace = await selectWorkspace(workspaces.data);
  return workspace ? { id: workspace.id } : { error: "No workspace is available for this account." };
}

const isFailure = (value: { id: string } | ActionState): value is ActionState => "error" in value;

/** Creates a client team — the top level of the Projects tree. */
export async function createClientAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const name = String(form.get("name") ?? "").trim();
  if (!name) return { error: "Enter a client name." };
  const workspace = await currentWorkspaceId();
  if (isFailure(workspace)) return workspace;

  const created = await createClientTeam(workspace.id, { name });
  if (!created.ok) return { error: created.error.detail };
  revalidatePath("/projects");
  return ok;
}

/**
 * Creates a campaign under a client.
 *
 * A campaign is a `Project` linked directly to its client team in the same write.
 */
export async function createCampaignAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const name = String(form.get("name") ?? "").trim();
  const clientId = String(form.get("clientId") ?? "");
  if (!name) return { error: "Enter a campaign name." };
  if (!clientId || clientId === "unassigned") return { error: "Select a client first." };
  const workspace = await currentWorkspaceId();
  if (isFailure(workspace)) return workspace;

  const project = await createProject(workspace.id, { name, client_team_id: clientId });
  if (!project.ok) return { error: project.error.detail };

  revalidatePath("/projects");
  return ok;
}

/** Creates a folder inside a campaign, optionally nested under another folder. */
export async function createFolderAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const name = String(form.get("name") ?? "").trim();
  const campaignId = String(form.get("campaignId") ?? "");
  const parentId = String(form.get("parentFolderId") ?? "");
  if (!name) return { error: "Enter a folder name." };
  if (!campaignId) return { error: "Select a campaign first." };
  const workspace = await currentWorkspaceId();
  if (isFailure(workspace)) return workspace;

  const folder = await createFolder(workspace.id, campaignId, parentId ? { name, parent_folder_id: parentId } : { name });
  if (!folder.ok) return { error: folder.error.detail };
  revalidatePath("/projects");
  return ok;
}
