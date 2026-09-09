"use server";

import { revalidatePath } from "next/cache";
import { createRole, createWorkspaceInvite, grantProjectAccess, revokeProjectAccess, updateWorkspaceMember } from "@/lib/api";
import { loadWorkspaceContext } from "@/lib/workspace";

export type TeamActionState = { error: string | null; message: string | null; token?: string };
const fail = (error: string): TeamActionState => ({ error, message: null });
async function selectedId() { const context = await loadWorkspaceContext(); return context.ok && context.data.selected ? context.data.selected.id : null; }

export async function inviteMemberAction(_previous: TeamActionState, form: FormData): Promise<TeamActionState> {
  const workspaceId = await selectedId(); if (!workspaceId) return fail("No workspace is selected.");
  const email = String(form.get("email") ?? "").trim(); const roleId = String(form.get("role_id") ?? "");
  if (!email || !roleId) return fail("Enter an email and choose a role.");
  const result = await createWorkspaceInvite(workspaceId, { email, role_id: roleId, project_access_mode: String(form.get("project_access_mode") ?? "ALL"), expires_in_days: 7 });
  if (!result.ok) return fail(result.error.detail);
  revalidatePath("/team");
  return { error: null, message: "Invitation created. Share the temporary token securely.", token: result.data.token };
}

export async function createRoleAction(_previous: TeamActionState, form: FormData): Promise<TeamActionState> {
  const workspaceId = await selectedId(); if (!workspaceId) return fail("No workspace is selected.");
  const name = String(form.get("name") ?? "").trim(); if (!name) return fail("Enter a role name.");
  const permissions = form.getAll("permission_keys").map(String);
  const result = await createRole(workspaceId, { name, description: String(form.get("description") ?? "").trim(), permission_keys: permissions });
  if (!result.ok) return fail(result.error.detail);
  revalidatePath("/team"); return { error: null, message: "Role created." };
}

export async function updateMemberAction(_previous: TeamActionState, form: FormData): Promise<TeamActionState> {
  const workspaceId = await selectedId(); if (!workspaceId) return fail("No workspace is selected.");
  const membershipId = String(form.get("membership_id") ?? "");
  if (!membershipId) return fail("Choose a workspace member.");
  const result = await updateWorkspaceMember(workspaceId, membershipId, { role_id: String(form.get("role_id") ?? ""), project_access_mode: String(form.get("project_access_mode") ?? "ALL"), status: String(form.get("status") ?? "ACTIVE") });
  if (!result.ok) return fail(result.error.detail);
  revalidatePath("/team"); return { error: null, message: "Member access updated." };
}

export async function grantProjectAction(_previous: TeamActionState, form: FormData): Promise<TeamActionState> {
  const workspaceId = await selectedId(); if (!workspaceId) return fail("No workspace is selected.");
  const projectId = String(form.get("project_id") ?? ""); const membershipId = String(form.get("membership_id") ?? "");
  if (!projectId || !membershipId) return fail("Choose a project and member.");
  const result = await grantProjectAccess(workspaceId, projectId, membershipId); if (!result.ok) return fail(result.error.detail);
  revalidatePath("/team"); return { error: null, message: "Project access granted." };
}
export async function revokeProjectAction(projectId: string, grantId: string): Promise<TeamActionState> {
  const workspaceId = await selectedId(); if (!workspaceId) return fail("No workspace is selected.");
  const result = await revokeProjectAccess(workspaceId, projectId, grantId); if (!result.ok) return fail(result.error.detail);
  revalidatePath("/team"); return { error: null, message: "Project access revoked." };
}
