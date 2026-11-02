import { redirect } from "next/navigation";
import { listWorkspaces } from "@/lib/api";
import { landingFor } from "@/lib/role-nav";
import { selectWorkspace } from "@/lib/workspace";

/** Where sign-in lands: the first item of this workspace's sidebar (Files by default). */
export default async function Start() {
  const workspaces = await listWorkspaces();
  if (!workspaces.ok) redirect("/");
  if (workspaces.data.length === 0) redirect("/onboarding");
  redirect(landingFor(await selectWorkspace(workspaces.data)));
}
