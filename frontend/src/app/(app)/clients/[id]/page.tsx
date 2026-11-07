import { notFound } from "next/navigation";
import { guardRoute } from "@/lib/route-guard";
import { getClientTeamOverview, listClientTeamInvites, listClientTeamMembers, listClientTeams, listProjects } from "@/lib/api";
import { loadWorkspaceContext } from "@/lib/workspace";
import { ClientDetail } from "./detail";
import "../clients.css";
import "./detail.css";

/** One client: what is done, what is in progress, who works on it and (owners/admins) what has been paid. */
export default async function ClientDetailPage({ params }: PageProps<"/clients/[id]">) {
  await guardRoute("/clients");
  const [{ id }, context] = await Promise.all([params, loadWorkspaceContext()]);
  const workspace = context.ok ? context.data.selected : null;
  if (!workspace) notFound();
  const [clients, projects, members, invites, overview] = await Promise.all([
    listClientTeams(workspace.id), listProjects(workspace.id), listClientTeamMembers(workspace.id, id), listClientTeamInvites(workspace.id, id), getClientTeamOverview(workspace.id, id),
  ]);
  const client = clients.ok ? clients.data.find((item) => item.id === id) : undefined;
  if (!client) notFound();
  const card = { ...client, projects: projects.ok ? projects.data.filter((project) => project.client_team_id === id) : [], members: members.ok ? members.data : [], invites: invites.ok ? invites.data : [] };
  return <ClientDetail client={card} overview={overview.ok ? overview.data : null} notice={overview.ok ? null : overview.error.detail} />;
}
