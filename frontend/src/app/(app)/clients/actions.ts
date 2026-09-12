"use server";

import { revalidatePath } from "next/cache";
import { addClientTeamMember, archiveClientTeam, createClientTeam, createClientTeamInvite, removeClientTeamMember, revokeClientTeamInvite, updateClientTeam } from "@/lib/api";
import { loadWorkspaceContext } from "@/lib/workspace";

export type ClientActionState = { error: string | null; message: string | null };
const fail = (error: string): ClientActionState => ({ error, message: null });
const ok = (message: string): ClientActionState => ({ error: null, message });
async function workspaceId() { const context = await loadWorkspaceContext(); return context.ok ? context.data.selected?.id ?? null : null; }

export async function createClientAction(_state: ClientActionState, form: FormData): Promise<ClientActionState> {
  const workspace = await workspaceId(); if (!workspace) return fail("No workspace selected.");
  const name = String(form.get("name") ?? "").trim(); if (!name) return fail("Client name is required.");
  const result = await createClientTeam(workspace, { name, email: String(form.get("email") ?? "").trim(), website: String(form.get("website") ?? "").trim(), description: String(form.get("description") ?? "").trim() });
  if (!result.ok) return fail(result.error.detail); revalidatePath("/clients"); return ok("Client created.");
}

export async function updateClientAction(_state: ClientActionState, form: FormData): Promise<ClientActionState> {
  const workspace = await workspaceId(); if (!workspace) return fail("No workspace selected.");
  const clientId = String(form.get("client_id") ?? ""); const value = (key: string) => String(form.get(key) ?? "").trim() || null;
  const result = await updateClientTeam(workspace, clientId, { name: value("name") ?? undefined, email: value("email"), website: value("website"), phone: value("phone"), city: value("city"), country_code: value("country_code")?.toUpperCase() ?? null, description: value("description") });
  if (!result.ok) return fail(result.error.detail); revalidatePath("/clients"); return ok("Client updated.");
}

export async function archiveClientAction(clientId: string): Promise<ClientActionState> {
  const workspace = await workspaceId(); if (!workspace) return fail("No workspace selected.");
  const result = await archiveClientTeam(workspace, clientId); if (!result.ok) return fail(result.error.detail); revalidatePath("/clients"); return ok("Client archived.");
}

export async function addClientMemberAction(_state: ClientActionState, form: FormData): Promise<ClientActionState> { const workspace = await workspaceId(); if (!workspace) return fail("No workspace selected."); const clientId = String(form.get("client_id") ?? ""); const result = await addClientTeamMember(workspace, clientId, { email: String(form.get("email") ?? "").trim(), title: String(form.get("title") ?? "").trim() }); if (!result.ok) return fail(result.error.detail); revalidatePath("/clients"); return ok("Client member added."); }
export async function removeClientMemberAction(clientId: string, memberId: string): Promise<ClientActionState> { const workspace = await workspaceId(); if (!workspace) return fail("No workspace selected."); const result = await removeClientTeamMember(workspace, clientId, memberId); if (!result.ok) return fail(result.error.detail); revalidatePath("/clients"); return ok("Client member removed."); }
export type ClientInviteState = ClientActionState & { token?: string };
export async function inviteClientMemberAction(_state: ClientInviteState, form: FormData): Promise<ClientInviteState> { const workspace = await workspaceId(); if (!workspace) return fail("No workspace selected."); const clientId = String(form.get("client_id") ?? ""); const email = String(form.get("email") ?? "").trim(); const inviteType = email ? "EMAIL" : "LINK"; const result = await createClientTeamInvite(workspace, clientId, { invite_type: inviteType, ...(email ? { recipient_email: email } : {}), label: String(form.get("label") ?? "").trim(), expires_in_days: Number(form.get("expires_in_days") ?? 14) }); if (!result.ok) return fail(result.error.detail); revalidatePath("/clients"); return { error: null, message: "Client invitation created.", token: result.data.token }; }
export async function revokeClientInviteAction(clientId: string, inviteId: string): Promise<ClientActionState> { const workspace = await workspaceId(); if (!workspace) return fail("No workspace selected."); const result = await revokeClientTeamInvite(workspace, clientId, inviteId); if (!result.ok) return fail(result.error.detail); revalidatePath("/clients"); return ok("Invitation revoked."); }
