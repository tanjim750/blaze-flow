"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { logout } from "@/lib/api";
import { WORKSPACE_COOKIE } from "@/lib/workspace";

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
  redirect("/sign-in");
}

export async function switchWorkspaceAction(form: FormData): Promise<void> {
  const workspaceId = String(form.get("workspaceId") ?? "");
  const returnTo = String(form.get("returnTo") ?? "/");
  if (!workspaceId) return;
  const jar = await cookies();
  jar.set(WORKSPACE_COOKIE, workspaceId, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 365 });
  redirect(returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/");
}
