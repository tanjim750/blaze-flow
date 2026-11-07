import { guardRoute } from "@/lib/route-guard";
import { loadProjectsView } from "@/lib/projects-view";
import { loadSession } from "@/lib/session";
import { ProjectsBrowser } from "./browser";
import "./projects.css";
import { loadFilesView } from "@/lib/files-view";
import { loadTasksView } from "@/lib/tasks-view";
import "@/components/asset-library.css";

export default async function ProjectsPage({ searchParams }: PageProps<"/projects">) {
  await guardRoute("/projects");
  const params = await searchParams;
  const clientId = typeof params.client === "string" ? params.client : undefined;
  const campaignId = typeof params.campaign === "string" ? params.campaign : undefined;
  // Redirects to /sign-in when the API says we are unauthenticated.
  const session = await loadSession();
  const [loaded, filesView, tasksView] = await Promise.all([loadProjectsView({ clientId, campaignId, all: params.view === "all" || (!params.view && !campaignId) }), loadFilesView(), loadTasksView()]);
  // Collection screens must not highlight an arbitrary first project in the rail.
  const collection = params.view === "all" || params.view === "files" || params.view === "unsorted" || (!campaignId && !params.tab);
  const selection = collection ? { ...loaded, selectedClient: null, selectedCampaign: null } : loaded;
  const view = session.notice ? { ...selection, notice: session.notice } : selection;
  const tab = typeof params.tab === "string" ? params.tab : undefined;

  return (
    <>
      <ProjectsBrowser key={`${params.view ?? "home"}:${campaignId ?? ""}:${tab ?? "Files"}`} view={view} filesView={filesView} tasksView={tasksView} initialTab={tab} initialQuery={new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => typeof entry[1] === "string")).toString()} />
    </>
  );
}
