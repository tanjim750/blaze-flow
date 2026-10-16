import { listProjectAccess, listProjects, listRoles, listWorkspaceMembers, type Project, type ResourceAccess, type Role, type WorkspaceMembership } from "./api";
import { loadWorkspaceContext } from "./workspace";

export type TeamProjectAccess = { project: Project; grants: ResourceAccess[] };
export type TeamView = { workspaceId: string | null; workspaceName: string; roles: Role[]; members: WorkspaceMembership[]; projects: TeamProjectAccess[]; notice: string | null };

export async function loadTeamView(): Promise<TeamView> {
  const context = await loadWorkspaceContext();
  if (!context.ok) return { workspaceId: null, workspaceName: "Workspace", roles: [], members: [], projects: [], notice: context.error.detail };
  const workspace = context.data.selected;
  if (!workspace) return { workspaceId: null, workspaceName: "Workspace", roles: [], members: [], projects: [], notice: "No workspace is selected." };
  const [roles, members, projectResult] = await Promise.all([listRoles(workspace.id), listWorkspaceMembers(workspace.id), listProjects(workspace.id)]);
  const projects = projectResult.ok ? await Promise.all(projectResult.data.map(async (project) => { const access = await listProjectAccess(workspace.id, project.id); return { project, grants: access.ok ? access.data : [] }; })) : [];
  const notice = !roles.ok ? roles.error.detail : !members.ok ? members.error.detail : !projectResult.ok ? projectResult.error.detail : null;
  return { workspaceId: workspace.id, workspaceName: workspace.name, roles: roles.ok ? roles.data : [], members: members.ok ? members.data : [], projects, notice };
}
