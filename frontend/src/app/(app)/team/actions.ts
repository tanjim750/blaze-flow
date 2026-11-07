"use server";

import { revalidatePath } from "next/cache";
import { createRole, createWorkspaceInvite, resendWorkspaceInvite, revokeWorkspaceInvite, grantProjectAccess, revokeProjectAccess, updateWorkspaceMember } from "@/lib/api";
import { loadWorkspaceContext } from "@/lib/workspace";
import { inviteFieldErrors } from "@/lib/invites";

export type TeamActionState = { error: string | null; message: string | null; token?: string; email?: string; emailSent?: boolean; fieldErrors?: Record<string, string> };
const fail = (error: string): TeamActionState => ({ error, message: null });
async function selectedId() { const context = await loadWorkspaceContext(); return context.ok && context.data.selected ? context.data.selected.id : null; }

export async function inviteMemberAction(_previous: TeamActionState, form: FormData): Promise<TeamActionState> {
  const workspaceId = await selectedId(); if (!workspaceId) return fail("No workspace is selected.");
  const email = String(form.get("email") ?? "").trim(); const roleId = String(form.get("role_id") ?? "");
  const fieldErrors = inviteFieldErrors(email, roleId);
  if (fieldErrors) return { error: null, message: null, fieldErrors, email };
  const result = await createWorkspaceInvite(workspaceId, { email, role_id: roleId, project_access_mode: String(form.get("project_access_mode") ?? "ALL"), expires_in_days: 7 });
  if (!result.ok) return { ...fail(result.error.detail), email };
  revalidatePath("/team");
  return { error: null, message: result.data.email_sent ? `Invitation emailed to ${email}.` : "Invitation created, but the email could not be sent. Copy the link below and share it.", token: result.data.token, email, emailSent: Boolean(result.data.email_sent) };
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

export type InviteMutation = { error: string | null; token?: string; emailSent?: boolean };

/** Resend: a fresh link (the old one stops working) and the email again. */
export async function resendInviteAction(inviteId: string): Promise<InviteMutation> {
  const workspaceId = await selectedId(); if (!workspaceId) return { error: "No workspace is selected." };
  const result = await resendWorkspaceInvite(workspaceId, inviteId);
  if (!result.ok) return { error: result.error.detail };
  revalidatePath("/team");
  return { error: null, token: result.data.token, emailSent: Boolean(result.data.email_sent) };
}

export async function revokeInviteAction(inviteId: string): Promise<InviteMutation> {
  const workspaceId = await selectedId(); if (!workspaceId) return { error: "No workspace is selected." };
  const result = await revokeWorkspaceInvite(workspaceId, inviteId);
  if (!result.ok) return { error: result.error.detail };
  revalidatePath("/team");
  return { error: null };
}
