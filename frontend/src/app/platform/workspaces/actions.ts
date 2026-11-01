"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { request } from "@/lib/api";
import { WORKSPACE_COOKIE } from "@/lib/workspace";

const COOKIE = { httpOnly: true, sameSite: "lax" as const, path: "/", secure: process.env.NODE_ENV === "production" };

/** Starts a read-only staff view (audited by the API) and opens the workspace in the app. */
export async function viewWorkspaceAction(form: FormData): Promise<void> {
  const workspaceId = String(form.get("workspaceId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) return;
  const result = await request<{ id: string }>(`/platform/workspaces/${workspaceId}/view/`, {
    method: "POST", body: JSON.stringify({ reason: "Viewing workspace from platform admin" }), headers: { "Content-Type": "application/json" },
  });
  if (!result.ok) redirect(`/platform/workspaces/${workspaceId}?view_error=1`);
  const jar = await cookies();
  // Remember where staff came from so Exit can put their own workspace back.
  const previous = jar.get(WORKSPACE_COOKIE)?.value;
  if (previous && previous !== workspaceId && !jar.get("blazeflow_view_return")) jar.set("blazeflow_view_return", previous, { ...COOKIE, maxAge: 60 * 60 * 2 });
  jar.set(WORKSPACE_COOKIE, workspaceId, { ...COOKIE, maxAge: 60 * 60 * 2 });
  redirect("/");
}

/** Ends the staff view (audited), restores the staff member's own workspace and returns to /platform. */
export async function exitWorkspaceViewAction(form: FormData): Promise<void> {
  const workspaceId = String(form.get("workspaceId") ?? "");
  await request("/platform/view/end/", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
  const jar = await cookies();
  const previous = jar.get("blazeflow_view_return")?.value;
  jar.delete("blazeflow_view_return");
  if (previous) jar.set(WORKSPACE_COOKIE, previous, { ...COOKIE, maxAge: 60 * 60 * 24 * 365 });
  else jar.delete(WORKSPACE_COOKIE);
  redirect(/^[0-9a-f-]{36}$/i.test(workspaceId) ? `/platform/workspaces/${workspaceId}` : "/platform/workspaces");
}
