import { AppShell } from "@/components/app-shell";
import { loadSession } from "@/lib/session";
import { loadTasksView } from "@/lib/tasks-view";
import { toShellUser } from "@/lib/user";
import { loadWorkspaceContext } from "@/lib/workspace";
import { TasksBoard } from "./board";
import "./tasks.css";

export default async function TasksPage() {
  const [session, context, view] = await Promise.all([loadSession(), loadWorkspaceContext(), loadTasksView()]);
  return <AppShell user={session.user && toShellUser(session.user)} workspaces={context.ok ? context.data.workspaces : []} selectedWorkspaceId={context.ok ? context.data.selected?.id : null}>
    <TasksBoard view={view} />
  </AppShell>;
}
