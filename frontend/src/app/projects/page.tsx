import { AppShell } from "@/components/app-shell";
import { loadProjectsView } from "@/lib/projects-view";
import { loadSession } from "@/lib/session";
import { toShellUser } from "@/lib/user";
import { ProjectsBrowser } from "./browser";
import "./projects.css";
import { loadWorkspaceContext } from "@/lib/workspace";

export default async function ProjectsPage({ searchParams }: PageProps<"/projects">) {
  const params = await searchParams;
  const clientId = typeof params.client === "string" ? params.client : undefined;
  const campaignId = typeof params.campaign === "string" ? params.campaign : undefined;
  // Redirects to /sign-in when the API says we are unauthenticated.
  const session = await loadSession();
  const loaded = await loadProjectsView({ clientId, campaignId });
  const view = session.notice ? { ...loaded, notice: session.notice } : loaded;
  const tab = typeof params.tab === "string" ? params.tab : undefined;
  const listMode = params.view === "list";
  const workspaceContext = await loadWorkspaceContext();

  return (
    <AppShell flush user={session.user && toShellUser(session.user)} workspaces={workspaceContext.ok ? workspaceContext.data.workspaces : []} selectedWorkspaceId={workspaceContext.ok ? workspaceContext.data.selected?.id : null}>
      <ProjectsBrowser view={view} initialTab={tab} initialDense={listMode} />
    </AppShell>
  );
}
