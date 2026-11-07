import Link from "next/link";
import { ChevronLeft } from "@/components/icons";
import { guardRoute } from "@/lib/route-guard";
import { listArchivedProjects, listClientTeams, listWorkspaces } from "@/lib/api";
import { selectWorkspace } from "@/lib/workspace";
import { ArchivedList } from "./list";
import "../projects.css";

export default async function ArchivedProjectsPage() {
  await guardRoute("/projects");
  const workspaces = await listWorkspaces();
  const workspace = workspaces.ok ? await selectWorkspace(workspaces.data) : null;
  const [projects, clients] = workspace
    ? await Promise.all([listArchivedProjects(workspace.id), listClientTeams(workspace.id)])
    : [null, null];
  const clientName = new Map((clients?.ok ? clients.data : []).map((client) => [client.id, client.name]));
  const rows = (projects?.ok ? projects.data : []).map((project) => ({
    id: project.id, name: project.name, client: project.client_team_id ? clientName.get(project.client_team_id) ?? "" : "", updatedAt: project.updated_at,
  }));
  return (
    <main className="pb-archived">
      <Link href="/projects" className="pb-archived-back"><ChevronLeft size={14} />Projects</Link>
      <header>
        <h1>Archived projects</h1>
        <p>Archived projects keep their files, reviews and invoices, and don&rsquo;t count towards your plan&rsquo;s project limit.</p>
      </header>
      {projects && !projects.ok ? <p className="pb-archive-error" role="alert">{projects.error.detail}</p> : <ArchivedList rows={rows} />}
    </main>
  );
}
