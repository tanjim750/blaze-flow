import { loadProjectsView } from "@/lib/projects-view";
import { loadSession } from "@/lib/session";
import { ProjectsBrowser } from "./browser";
import "./projects.css";
import { loadFilesView } from "@/lib/files-view";
import { loadTasksView } from "@/lib/tasks-view";
import "@/components/asset-library.css";

export default async function ProjectsPage({ searchParams }: PageProps<"/projects">) {
  const params = await searchParams;
  const clientId = typeof params.client === "string" ? params.client : undefined;
  const campaignId = typeof params.campaign === "string" ? params.campaign : undefined;
  // Redirects to /sign-in when the API says we are unauthenticated.
  const session = await loadSession();
  const [loaded, filesView, tasksView] = await Promise.all([loadProjectsView({ clientId, campaignId }), loadFilesView(), loadTasksView()]);
  const view = session.notice ? { ...loaded, notice: session.notice } : loaded;
  const tab = typeof params.tab === "string" ? params.tab : undefined;

  return (
    <>
      <ProjectsBrowser view={view} filesView={filesView} tasksView={tasksView} initialTab={tab} />
    </>
  );
}
