"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { logout } from "@/lib/api";
import { WORKSPACE_COOKIE } from "@/lib/workspace";
import { activateWorkspace } from "@/lib/workspace-cookie";

/**
 * Ends the session and returns to sign-in.
 *
 * Django's `logout()` flushes the session row, so the cookie the browser still holds is
 * already worthless — but a server-side fetch's `Set-Cookie` does not reach the browser,
 * so the cookies are cleared here too. Without that the browser keeps sending a dead
 * `sessionid` and every page would take an API round trip to discover it is signed out.
 *
 * The API call is best-effort: if it fails, clearing the cookies and leaving is still the
 * right outcome for someone who asked to sign out.
 */
export async function signOutAction(): Promise<void> {
  await logout();
  const jar = await cookies();
  jar.delete("sessionid");
  jar.delete("csrftoken");
  // The next person to sign in on this browser must not inherit this account's selection.
  jar.delete(WORKSPACE_COOKIE);
  redirect("/sign-in?signed_out=1");
}

export async function switchWorkspaceAction(form: FormData): Promise<void> {
  const workspaceId = String(form.get("workspaceId") ?? "");
  const returnTo = String(form.get("returnTo") ?? "/");
  if (!workspaceId) return;
  await activateWorkspace(workspaceId);
  redirect(returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/");
}
