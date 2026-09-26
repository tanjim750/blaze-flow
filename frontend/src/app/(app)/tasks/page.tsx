import { loadTasksView } from "@/lib/tasks-view";
import { TasksBoard } from "./board";
import "./tasks.css";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function TasksPage({ searchParams }: { searchParams: SearchParams }) {
  const [view, params] = await Promise.all([loadTasksView(), searchParams]);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (typeof value === "string") query.set(key, value);
  return <TasksBoard view={view} initialQuery={query.toString()} syncUrl />;
}
