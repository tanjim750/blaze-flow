import { getWorkspacePermissions, listAssetFiles, listClientTeams, listProjects, listTasks, listTaskStages, listWorkspaceMembers, type ClientTeam, type Project, type ProjectFile, type Task, type TaskWorkflow, type WorkspaceMembership } from "./api";
import { loadWorkspaceContext } from "./workspace";
import { taskAccess, type TaskAccess } from "./permissions";

export type TasksView = {
  workspaceId: string | null; tasks: Task[]; projects: Project[]; clients: ClientTeam[]; members: WorkspaceMembership[]; files: ProjectFile[]; stages: TaskWorkflow["stages"]; workflowSettings: TaskWorkflow["settings"]; notice: string | null;
  /** What this viewer may change. Absent means "everything" (the server still checks). */
  access?: TaskAccess;
};
const defaultWorkflowSettings: TaskWorkflow["settings"] = { wip_warning: true, auto_notify_client: true, lock_done_editing: true };

export async function loadTasksView(): Promise<TasksView> {
  const context = await loadWorkspaceContext();
  if (!context.ok) return { workspaceId: null, tasks: [], projects: [], clients: [], members: [], files: [], stages: [], workflowSettings: defaultWorkflowSettings, notice: context.error.detail };
  const workspace = context.data.selected;
  if (!workspace) return { workspaceId: null, tasks: [], projects: [], clients: [], members: [], files: [], stages: [], workflowSettings: defaultWorkflowSettings, notice: "No workspace is selected." };
  const [tasks, projects, clients, members, workflow, files, permissions] = await Promise.all([listTasks(workspace.id), listProjects(workspace.id), listClientTeams(workspace.id), listWorkspaceMembers(workspace.id), listTaskStages(workspace.id), listAssetFiles(workspace.id), getWorkspacePermissions(workspace.id)]);
  const access = taskAccess(permissions.ok ? permissions.data : null, workspace.dashboard_role ?? null);
  const base = { workspaceId: workspace.id, projects: projects.ok ? projects.data : [], clients: clients.ok ? clients.data : [], members: members.ok ? members.data : [], files: files.ok ? files.data : [], stages: workflow.ok ? workflow.data.stages : [], workflowSettings: workflow.ok ? workflow.data.settings : defaultWorkflowSettings, access };
  // A 403 on a supporting list (the client directory, the member list, the asset library)
  // only means this viewer's role does not include it, which is not worth a banner; a
  // client never gets one. A 5xx or a network error still is.
  const failed = [projects, clients, members, workflow].find((result) => !result.ok && result.error.status !== 403);
  if (!tasks.ok) return { ...base, tasks: [], notice: access.client ? null : tasks.error.status === 403 ? "You don't have access to tasks in this workspace." : tasks.error.detail };
  return { ...base, tasks: tasks.data, notice: !access.client && failed && !failed.ok ? failed.error.detail : null };
}
