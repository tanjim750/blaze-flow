import { listAssetFiles, listClientTeams, listProjects, listTasks, listTaskStages, listWorkspaceMembers, type ClientTeam, type Project, type ProjectFile, type Task, type TaskWorkflow, type WorkspaceMembership } from "./api";
import { loadWorkspaceContext } from "./workspace";

export type TasksView = {
  workspaceId: string | null; tasks: Task[]; projects: Project[]; clients: ClientTeam[]; members: WorkspaceMembership[]; files: ProjectFile[]; stages: TaskWorkflow["stages"]; workflowSettings: TaskWorkflow["settings"]; notice: string | null;
};
const defaultWorkflowSettings: TaskWorkflow["settings"] = { wip_warning: true, auto_notify_client: true, lock_done_editing: true };

export async function loadTasksView(): Promise<TasksView> {
  const context = await loadWorkspaceContext();
  if (!context.ok) return { workspaceId: null, tasks: [], projects: [], clients: [], members: [], files: [], stages: [], workflowSettings: defaultWorkflowSettings, notice: context.error.detail };
  const workspace = context.data.selected;
  if (!workspace) return { workspaceId: null, tasks: [], projects: [], clients: [], members: [], files: [], stages: [], workflowSettings: defaultWorkflowSettings, notice: "No workspace is selected." };
  const [tasks, projects, clients, members, workflow, files] = await Promise.all([listTasks(workspace.id), listProjects(workspace.id), listClientTeams(workspace.id), listWorkspaceMembers(workspace.id), listTaskStages(workspace.id), listAssetFiles(workspace.id)]);
  if (!tasks.ok) return { workspaceId: workspace.id, tasks: [], projects: projects.ok ? projects.data : [], clients: clients.ok ? clients.data : [], members: members.ok ? members.data : [], files: files.ok ? files.data : [], stages: workflow.ok ? workflow.data.stages : [], workflowSettings: workflow.ok ? workflow.data.settings : defaultWorkflowSettings, notice: tasks.error.detail };
  const failed = [projects, clients, members, workflow].find((result) => !result.ok);
  return { workspaceId: workspace.id, tasks: tasks.data, projects: projects.ok ? projects.data : [], clients: clients.ok ? clients.data : [], members: members.ok ? members.data : [], files: files.ok ? files.data : [], stages: workflow.ok ? workflow.data.stages : [], workflowSettings: workflow.ok ? workflow.data.settings : defaultWorkflowSettings, notice: failed && !failed.ok ? failed.error.detail : null };
}
