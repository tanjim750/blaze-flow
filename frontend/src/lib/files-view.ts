import { listClientTeams, listFolders, listMediaVersions, listProjectFiles, listProjects, type ClientTeam, type MediaVersion, type ProjectFile, type ProjectFolder } from "./api";
import { loadWorkspaceContext } from "./workspace";

export type ProjectFilesGroup = { projectId: string; projectName: string; clientId: string | null; files: ProjectFile[]; folders: ProjectFolder[] };
export type FilesView = { workspaceId: string | null; clients: ClientTeam[]; groups: ProjectFilesGroup[]; notice: string | null };
export type Deliverable = { id: string; workspaceId: string; projectId: string; projectName: string; media: MediaVersion };

export async function loadFilesView(): Promise<FilesView> {
  const context = await loadWorkspaceContext();
  if (!context.ok || !context.data.selected) return { workspaceId: null, clients: [], groups: [], notice: context.ok ? "No workspace selected." : context.error.detail };
  const workspace = context.data.selected; const [projects, clients] = await Promise.all([listProjects(workspace.id), listClientTeams(workspace.id)]);
  if (!projects.ok) return { workspaceId: workspace.id, clients: clients.ok ? clients.data : [], groups: [], notice: projects.error.detail };
  const groups = await Promise.all(projects.data.map(async (project) => {
    const [files, folders] = await Promise.all([listProjectFiles(workspace.id, project.id), listFolders(workspace.id, project.id)]);
    return { projectId: project.id, projectName: project.name, clientId: project.client_team_id, files: files.ok ? files.data : [], folders: folders.ok ? folders.data : [] };
  }));
  return { workspaceId: workspace.id, clients: clients.ok ? clients.data : [], groups, notice: clients.ok ? null : clients.error.detail };
}

export async function loadDeliverables(): Promise<{ items: Deliverable[]; notice: string | null }> {
  const context = await loadWorkspaceContext();
  if (!context.ok || !context.data.selected) return { items: [], notice: context.ok ? "No workspace selected." : context.error.detail };
  const workspace = context.data.selected; const projects = await listProjects(workspace.id);
  if (!projects.ok) return { items: [], notice: projects.error.detail };
  const scans = await Promise.all(projects.data.map(async (project) => ({ project, media: await listMediaVersions(workspace.id, project.id) })));
  return { items: scans.flatMap(({ project, media }) => media.ok ? media.data.filter((item) => item.allow_download).map((item) => ({ id: item.id, workspaceId: workspace.id, projectId: project.id, projectName: project.name, media: item })) : []), notice: null };
}
