"use server";

import { acceptClientTeamInvite, acceptWorkspaceInvite } from "@/lib/api";

export async function acceptInviteAction(token: string, kind: "workspace" | "client_team") {
  const result = kind === "workspace" ? await acceptWorkspaceInvite(token) : await acceptClientTeamInvite(token);
  return result.ok ? { ok: true as const } : { ok: false as const, error: result.error.detail };
}
