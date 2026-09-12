import { loadTasksView } from "@/lib/tasks-view";
import { TasksBoard } from "./board";
import "./tasks.css";

export default async function TasksPage() {
  const view = await loadTasksView();
  return <>
    <TasksBoard view={view} />
  </>;
}
