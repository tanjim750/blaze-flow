import { listClientTeams, listFolders, listMediaVersions, listProjects, listWorkflowStages, listWorkspaces } from "./api";
import type { MediaVersion, Project, ProjectFolder } from "./api";

/** Shape the Projects browser renders, independent of where the rows came from. */
export type AssetCard = {
  id: string; title: string; note: string; version: string; stage: string;
  tone: AssetTone; comments: number | null; duration: string | null;
  format: string | null; date: string; thumb: string | null;
};
export type AssetTone = "review" | "approved" | "grading" | "retouch" | "vfx" | "offline";
export type CampaignNode = { id: string; name: string; assetCount: number; folders: FolderNode[] };
export type FolderNode = { id: string; name: string; parentId: string | null };
export type ClientNode = { id: string; name: string; initial: string; assetCount: number; campaigns: CampaignNode[] };
/** A card on the Status board. Fields the API cannot supply are null and simply omitted. */
export type BoardCard = {
  id: string; title: string; version: string | null; duration: string | null;
  owner: string | null; ownerInitials: string[]; date: string; overdue: boolean;
  badge: string | null; placeholder: string | null; thumb: string | null;
  comments: number | null; downloads: number | null; tone: AssetTone;
};
export type ColumnTone = "todo" | "revisions" | "qa" | "review" | "done";
export type BoardColumn = { id: string; name: string; tone: ColumnTone; cards: BoardCard[] };

export type ProjectsView = {
  workspaceId: string | null;
  workspaceName: string;
  clients: ClientNode[];
  selectedClient: ClientNode | null;
  selectedCampaign: CampaignNode | null;
  assets: AssetCard[];
  board: BoardColumn[];
  /** Non-null when the API could not supply the page and demo content is shown instead. */
  notice: string | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, "0")}`;
};

/** Maps a media version's workflow stage (or status fallback) onto the mockup's badge palette. */
function toneFor(label: string): AssetTone {
  const value = label.toLowerCase();
  if (value.includes("approv")) return "approved";
  if (value.includes("grad") || value.includes("color") || value.includes("colour")) return "grading";
  if (value.includes("retouch")) return "retouch";
  if (value.includes("vfx") || value.includes("composit")) return "vfx";
  if (value.includes("offline") || value.includes("draft")) return "offline";
  return "review";
}

function columnTone(label: string): ColumnTone {
  const value = label.toLowerCase();
  if (value.includes("revision")) return "revisions";
  if (value.includes("qa") || value.includes("check")) return "qa";
  if (value.includes("review") || value.includes("approv")) return "review";
  if (value.includes("done") || value.includes("complete") || value.includes("deliver")) return "done";
  return "todo";
}

const titleCase = (value: string) =>
  value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

function toAssetCard(media: MediaVersion): AssetCard {
  const stage = media.current_stage?.name ?? titleCase(media.status);
  return {
    id: media.id,
    title: media.title,
    note: media.note ?? "",
    version: `v${media.version_number}`,
    stage,
    tone: toneFor(stage),
    // The API exposes no comment count, duration or resolution for a media version.
    comments: null,
    duration: null,
    format: media.file?.mime_type?.split("/")[1]?.toUpperCase() ?? null,
    date: shortDate(media.created_at),
    // The list serializer exposes no poster frame; the card falls back to a tinted plate.
    thumb: null,
  };
}

function toBoardCard(media: MediaVersion): BoardCard {
  const stage = media.current_stage?.name ?? titleCase(media.status);
  return {
    id: media.id,
    title: media.title,
    version: `v${media.version_number}`,
    // No duration, uploader, comment or download counts on the media list serializer.
    duration: null, owner: null, ownerInitials: [],
    date: shortDate(media.created_at), overdue: false,
    badge: null, placeholder: null, thumb: null,
    comments: null, downloads: null, tone: toneFor(stage),
  };
}

/** Groups the campaign's media versions into one column per active workflow stage. */
function buildBoard(stages: { id: string; name: string }[], media: MediaVersion[]): BoardColumn[] {
  const columns: BoardColumn[] = stages.map((stage) => ({
    id: stage.id, name: stage.name, tone: columnTone(stage.name), cards: [],
  }));
  const byStage = new Map(columns.map((column) => [column.id, column]));
  const unstaged: BoardCard[] = [];
  for (const item of media) {
    const card = toBoardCard(item);
    const column = item.current_stage ? byStage.get(item.current_stage.id) : undefined;
    if (column) column.cards.push(card);
    else unstaged.push(card);
  }
  if (unstaged.length) columns.push({ id: "unstaged", name: "Unstaged", tone: "todo", cards: unstaged });
  return columns;
}

function buildFolders(folders: ProjectFolder[]): FolderNode[] {
  return folders.map((folder) => ({ id: folder.id, name: folder.name, parentId: folder.parent_folder_id }));
}

/**
 * Loads the Projects page from the Django API.
 *
 * Client → campaign grouping comes from `ClientTeam.metadata.project_ids`, because the
 * backend has no `Project.client_team` relation. Projects not claimed by any client are
 * grouped under "Unassigned" so they stay reachable.
 */
/** Demo fallback that still honours the ?client / ?campaign selection, so the tree stays navigable. */
function demoView(params: { clientId?: string; campaignId?: string }, notice: string): ProjectsView {
  const client = DEMO_VIEW.clients.find((item) => item.id === params.clientId) ?? DEMO_VIEW.selectedClient;
  const campaign = client?.campaigns.find((item) => item.id === params.campaignId) ?? client?.campaigns[0] ?? null;
  const onDemoCampaign = campaign?.id === demoCampaign.id;
  const assets = onDemoCampaign ? demoAssets : [];
  const board = onDemoCampaign ? demoBoard : [];
  return { ...DEMO_VIEW, selectedClient: client, selectedCampaign: campaign, assets, board, notice };
}

export async function loadProjectsView(params: { clientId?: string; campaignId?: string }): Promise<ProjectsView> {
  const workspaces = await listWorkspaces();
  if (!workspaces.ok) return demoView(params, describe(workspaces.error.status, workspaces.error.detail));
  const workspace = workspaces.data[0];
  if (!workspace) return demoView(params, "This account has no workspace yet, so demo content is shown.");

  const [teams, projects] = await Promise.all([listClientTeams(workspace.id), listProjects(workspace.id)]);
  if (!teams.ok) return demoView(params, describe(teams.error.status, teams.error.detail));
  if (!projects.ok) return demoView(params, describe(projects.error.status, projects.error.detail));

  const byId = new Map<string, Project>(projects.data.map((project) => [project.id, project]));
  const claimed = new Set<string>();
  const clients: ClientNode[] = teams.data.map((team) => {
    const ids = Array.isArray(team.metadata?.project_ids) ? (team.metadata!.project_ids as string[]) : [];
    const campaigns = ids
      .map((id) => byId.get(id))
      .filter((project): project is Project => Boolean(project))
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

  let assets: AssetCard[] = [];
  let board: BoardColumn[] = [];
  if (selectedCampaign) {
    const [media, folders, stages] = await Promise.all([
      listMediaVersions(workspace.id, selectedCampaign.id),
      listFolders(workspace.id, selectedCampaign.id),
      listWorkflowStages(workspace.id),
    ]);
    if (media.ok) {
      assets = media.data.map(toAssetCard).reverse();
      selectedCampaign.assetCount = media.data.length;
      board = buildBoard(stages.ok ? stages.data : [], media.data);
    }
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
    assets,
    board,
    notice: null,
  };
}

const describe = (status: number, detail: string) =>
  status === 0
    ? `${detail} Showing demo content until the API is running.`
    : status === 401 || status === 403
      ? "You are not signed in to the Blaze Flow API, so demo content is shown."
      : `The API returned ${status}: ${detail}. Showing demo content.`;

/** Content from the Stitch reference, used only when the API cannot answer. */
const demoAssets: AssetCard[] = [
  { id: "d1", title: "Hero Runner Spot - 60s Cut", note: "Main 60s commercial broadcast delivery, graded in Rec.709", version: "v2.1", stage: "In Review", tone: "review", comments: 14, duration: "00:45", format: "4K UHD", date: "Oct 14" , thumb: "/images/review-1.jpg" },
  { id: "d2", title: "Urban Sprint - Social Cut 30s", note: "Vertical campaign reels with kinetic typography and mixed audio", version: "v1.4", stage: "Approved", tone: "approved", comments: 8, duration: "00:30", format: "1080x1920", date: "Oct 14" , thumb: "/images/review-2.jpg" },
  { id: "d3", title: "Night Neon Transition - B-Roll", note: "ACEScg color pipeline preview with anamorphic flare correction", version: "v1.0", stage: "Color Grading", tone: "grading", comments: 6, duration: "00:15", format: "4K DCI", date: "Oct 13" , thumb: "/images/review-3.jpg" },
  { id: "d4", title: "Athlete Close-Up - Beauty Pass", note: "Flame clean-up pass and high dynamic range skin-tone balance", version: "v2.0", stage: "Retouching", tone: "retouch", comments: 12, duration: "00:09", format: "4K UHD", date: "Oct 13" , thumb: "/images/review-1.jpg" },
  { id: "d5", title: "Morning Warmup & Track Sprint", note: "Golden hour lighting sequence with motion stabilized tracking", version: "v1.2", stage: "Approved", tone: "approved", comments: 3, duration: "00:11", format: "4K UHD", date: "Oct 12" , thumb: "/images/review-2.jpg" },
  { id: "d6", title: "Shoe Silhouette - Teaser Loop", note: "CGI product spin seamless loop for Instagram Story placements", version: "v1.8", stage: "VFX Compositing", tone: "vfx", comments: 5, duration: "00:21", format: "1080x1920", date: "Oct 11" , thumb: "/images/review-3.jpg" },
  { id: "d7", title: "Directors Cut - Narrative Edit", note: "Extended emotional narrative montage with temp score", version: "v0.9", stage: "Offline Cut", tone: "offline", comments: 1, duration: "00:32", format: "4K UHD", date: "Oct 10" , thumb: "/images/review-1.jpg" },
  { id: "d8", title: "End Card & Animated Logo Pack", note: "Motion graphics package with alpha channel for overlays", version: "v1.5", stage: "In Review", tone: "review", comments: 2, duration: "00:03", format: "4K UHD", date: "Oct 09" , thumb: "/images/review-2.jpg" },
];

/** Board content from the Stitch kanban reference, used only when the API cannot answer. */
const demoBoard: BoardColumn[] = [
  {
    id: "todo", name: "To Do", tone: "todo",
    cards: [
      { id: "b1", title: "Podcast cold open", version: null, duration: "02:10", owner: "Max Cohen", ownerInitials: ["MC"], date: "Mar 18", overdue: false, badge: "Audio Cut", placeholder: "Script Approved", thumb: null, comments: 2, downloads: 0, tone: "offline" },
      { id: "b2", title: "VSL 16:9", version: null, duration: "--:--", owner: "Max Cohen", ownerInitials: ["MC", "EK"], date: "Mar 15", overdue: false, badge: "16:9", placeholder: "Awaiting Footage", thumb: null, comments: 0, downloads: 1, tone: "offline" },
    ],
  },
  {
    id: "revisions", name: "Revisions", tone: "revisions",
    cards: [
      { id: "b3", title: "Funnel Hack 4|5", version: "v1.2", duration: "00:48", owner: "Max Cohen", ownerInitials: ["MC"], date: "Mar 15", overdue: true, badge: null, placeholder: null, thumb: "/images/review-3.jpg", comments: 6, downloads: 3, tone: "review" },
    ],
  },
  {
    id: "qa", name: "Internal QA", tone: "qa",
    cards: [
      { id: "b4", title: "Ad 5 hook B", version: "v1.8", duration: null, owner: "Max Cohen", ownerInitials: ["MC", "SR"], date: "Mar 20", overdue: false, badge: null, placeholder: null, thumb: "/images/review-2.jpg", comments: 4, downloads: 1, tone: "vfx" },
    ],
  },
];

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
  assets: demoAssets,
  board: demoBoard,
  notice: null,
};
