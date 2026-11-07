import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { WORKSPACE_COOKIE } from "./workspace";

const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Makes `workspaceId` the selected workspace and drops every cached render of the signed-in
 * app, so the next page (and the shell's workspace switcher) is rebuilt from a fresh
 * `/workspaces/` list instead of the client router's copy from before the change.
 */
export async function activateWorkspace(workspaceId: string): Promise<void> {
  const jar = await cookies();
  jar.set(WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production", maxAge: ONE_YEAR,
  });
  revalidatePath("/", "layout");
}
