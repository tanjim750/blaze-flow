import { listClientTeamInvites, listClientTeamMembers, listClientTeams, listProjects, type ClientTeam, type ClientTeamInvite, type ClientTeamMember, type Project } from "./api";
import { loadWorkspaceContext } from "./workspace";

export type ClientCard = ClientTeam & { projects: Project[]; members: ClientTeamMember[]; invites: ClientTeamInvite[] };
export type ClientsView = { workspaceId: string | null; workspaceName: string; clients: ClientCard[]; notice: string | null };

export async function loadClientsView(): Promise<ClientsView> {
  const context = await loadWorkspaceContext();
  if (!context.ok || !context.data.selected) return { workspaceId: null, workspaceName: "Workspace", clients: [], notice: context.ok ? "No workspace selected." : context.error.detail };
  const workspace = context.data.selected;
  const [clients, projects] = await Promise.all([listClientTeams(workspace.id), listProjects(workspace.id)]);
  if (!clients.ok) return { workspaceId: workspace.id, workspaceName: workspace.name, clients: [], notice: clients.error.detail };
  const cards = await Promise.all(clients.data.map(async (client) => { const [members, invites] = await Promise.all([listClientTeamMembers(workspace.id, client.id), listClientTeamInvites(workspace.id, client.id)]); return { ...client, projects: projects.ok ? projects.data.filter((project) => project.client_team_id === client.id) : [], members: members.ok ? members.data : [], invites: invites.ok ? invites.data : [] }; }));
  return { workspaceId: workspace.id, workspaceName: workspace.name, clients: cards, notice: projects.ok ? null : projects.error.detail };
}
