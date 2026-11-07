import { redirect } from "next/navigation";
import { guardFor } from "./role-nav";
import { loadWorkspaceContext } from "./workspace";

/**
 * Sends a viewer away from a page their role doesn't use, to their own dashboard with a
 * one-line reason. Called at the top of each guarded page (server side). It never widens
 * access: the API still checks every request.
 */
export async function guardRoute(path: string): Promise<void> {
  const context = await loadWorkspaceContext();
  if (!context.ok) return;
  const target = guardFor(context.data.selected, path);
  if (!target) return;
  const [base, hash] = target.to.split("#");
  redirect(`${base}?notice=${target.notice}${hash ? `#${hash}` : ""}`);
}
