import { listClientTeams, listFolders, listMediaVersions, listProjects, listWorkspaces } from "./api";
import type { ProjectFolder } from "./api";
import { selectWorkspace } from "./workspace";

export type CampaignNode = { id: string; name: string; assetCount: number; folders: FolderNode[] };
export type FolderNode = { id: string; name: string; parentId: string | null };
export type ClientNode = { id: string; name: string; initial: string; assetCount: number; campaigns: CampaignNode[] };
export type ProjectsView = {
  workspaceId: string | null;
  workspaceName: string;
  clients: ClientNode[];
  selectedClient: ClientNode | null;
  selectedCampaign: CampaignNode | null;
  /** Non-null when the API could not supply the page and demo content is shown instead. */
  notice: string | null;
};

function buildFolders(folders: ProjectFolder[]): FolderNode[] {
  return folders.map((folder) => ({ id: folder.id, name: folder.name, parentId: folder.parent_folder_id }));
}

/**
 * Loads the Projects page from the Django API.
 *
 * Client → campaign grouping comes from `Project.client_team_id`. Unassigned projects stay
 * reachable in a synthetic group.
 */
/** Demo fallback that still honours the ?client / ?campaign selection, so the tree stays navigable. */
function demoView(params: { clientId?: string; campaignId?: string }, notice: string): ProjectsView {
  const client = DEMO_VIEW.clients.find((item) => item.id === params.clientId) ?? DEMO_VIEW.selectedClient;
  const campaign = client?.campaigns.find((item) => item.id === params.campaignId) ?? client?.campaigns[0] ?? null;
  return { ...DEMO_VIEW, selectedClient: client, selectedCampaign: campaign, notice };
}

export async function loadProjectsView(params: { clientId?: string; campaignId?: string }): Promise<ProjectsView> {
  const workspaces = await listWorkspaces();
  if (!workspaces.ok) return demoView(params, describe(workspaces.error.status, workspaces.error.detail));
  const workspace = await selectWorkspace(workspaces.data);
  if (!workspace) return demoView(params, "This account has no workspace yet, so demo content is shown.");

  const [teams, projects] = await Promise.all([listClientTeams(workspace.id), listProjects(workspace.id)]);
  if (!teams.ok) return demoView(params, describe(teams.error.status, teams.error.detail));
  if (!projects.ok) return demoView(params, describe(projects.error.status, projects.error.detail));

  const claimed = new Set<string>();
  const clients: ClientNode[] = teams.data.map((team) => {
    const campaigns = projects.data
      .filter((project) => project.client_team_id === team.id)
      .map((project) => {
        claimed.add(project.id);
        return { id: project.id, name: project.name, assetCount: 0, folders: [] as FolderNode[] };
      });
    return { id: team.id, name: team.name, initial: team.name.charAt(0).toUpperCase(), assetCount: 0, campaigns };
  });

  const orphans = projects.data.filter((project) => !claimed.has(project.id));
  if (orphans.length) {
    clients.push({
      id: "unassigned", name: "Unassigned", initial: "?", assetCount: 0,
      campaigns: orphans.map((project) => ({ id: project.id, name: project.name, assetCount: 0, folders: [] })),
    });
  }

  const selectedClient =
    clients.find((client) => client.id === params.clientId) ?? clients.find((client) => client.campaigns.length) ?? clients[0] ?? null;
  const selectedCampaign =
    selectedClient?.campaigns.find((campaign) => campaign.id === params.campaignId) ?? selectedClient?.campaigns[0] ?? null;

  if (selectedCampaign) {
    const [media, folders] = await Promise.all([
      listMediaVersions(workspace.id, selectedCampaign.id),
      listFolders(workspace.id, selectedCampaign.id),
    ]);
    if (media.ok) selectedCampaign.assetCount = media.data.length;
    if (folders.ok) selectedCampaign.folders = buildFolders(folders.data);
  }
  if (selectedClient) {
    selectedClient.assetCount = selectedClient.campaigns.reduce((total, campaign) => total + campaign.assetCount, 0);
  }

  return {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    clients,
    selectedClient,
    selectedCampaign,
    notice: null,
  };
}

const describe = (status: number, detail: string) =>
  status === 0
    ? `${detail} Showing demo content until the API is running.`
    : status === 401 || status === 403
      ? "You are not signed in to the Blaze Flow API, so demo content is shown."
      : `The API returned ${status}: ${detail}. Showing demo content.`;

const demoCampaign: CampaignNode = { id: "demo-q1", name: "Q1 2026 Campaign", assetCount: 14, folders: [] };
const demoClient: ClientNode = {
  id: "demo-aurora", name: "Aurora Athletics", initial: "A", assetCount: 42,
  campaigns: [
    demoCampaign,
    { id: "demo-jan", name: "January 2026 (Launch)", assetCount: 8, folders: [] },
    { id: "demo-feb", name: "February 2026 (Reels)", assetCount: 11, folders: [] },
    { id: "demo-apr", name: "April Filmday", assetCount: 9, folders: [] },
  ],
};

export const DEMO_VIEW: ProjectsView = {
  workspaceId: null,
  workspaceName: "Studio Core",
  clients: [
    demoClient,
    { id: "demo-northwind", name: "Northwind Coffee", initial: "N", assetCount: 0, campaigns: [{ id: "nw1", name: "Retail Launch", assetCount: 0, folders: [] }, { id: "nw2", name: "Packaging Films", assetCount: 0, folders: [] }, { id: "nw3", name: "Barista Series", assetCount: 0, folders: [] }] },
    { id: "demo-atlas", name: "Atlas Finance", initial: "A", assetCount: 0, campaigns: [{ id: "af1", name: "Annual Report", assetCount: 0, folders: [] }, { id: "af2", name: "Brand Refresh", assetCount: 0, folders: [] }] },
    { id: "demo-vanguard", name: "Vanguard Media", initial: "V", assetCount: 0, campaigns: [{ id: "vm1", name: "Series Titles", assetCount: 0, folders: [] }, { id: "vm2", name: "Promo Reels", assetCount: 0, folders: [] }, { id: "vm3", name: "Docu Shorts", assetCount: 0, folders: [] }, { id: "vm4", name: "Trailer Cuts", assetCount: 0, folders: [] }] },
  ],
  selectedClient: demoClient,
  selectedCampaign: demoCampaign,
  notice: null,
};
