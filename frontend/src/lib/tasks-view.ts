import { listProjects, listTasks, type Project, type Task } from "./api";
import { loadWorkspaceContext } from "./workspace";

export type TasksView = {
  tasks: Task[]; projects: Project[]; notice: string | null;
};

export async function loadTasksView(): Promise<TasksView> {
  const context = await loadWorkspaceContext();
  if (!context.ok) return { tasks: [], projects: [], notice: context.error.detail };
  const workspace = context.data.selected;
  if (!workspace) return { tasks: [], projects: [], notice: "No workspace is selected." };
  const [tasks, projects] = await Promise.all([listTasks(workspace.id), listProjects(workspace.id)]);
  if (!tasks.ok) return { tasks: [], projects: projects.ok ? projects.data : [], notice: tasks.error.detail };
  return { tasks: tasks.data, projects: projects.ok ? projects.data : [], notice: projects.ok ? null : projects.error.detail };
}
