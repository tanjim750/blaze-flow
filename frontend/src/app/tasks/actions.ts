"use server";

import { revalidatePath } from "next/cache";
import { createTask, updateTask } from "@/lib/api";
import { loadWorkspaceContext } from "@/lib/workspace";

export type TaskActionState = { error: string | null; message: string | null };
const fail = (error: string): TaskActionState => ({ error, message: null });

async function workspaceId(): Promise<string | TaskActionState> {
  const context = await loadWorkspaceContext();
  if (!context.ok) return fail(context.error.detail);
  return context.data.selected?.id ?? fail("No workspace is selected.");
}

export async function setTaskCompletedAction(taskId: string, completed: boolean): Promise<TaskActionState> {
  const selected = await workspaceId();
  if (typeof selected !== "string") return selected;
  const result = await updateTask(selected, taskId, { status: completed ? "COMPLETED" : "TODO" });
  if (!result.ok) return fail(result.error.detail);
  revalidatePath("/"); revalidatePath("/tasks");
  return { error: null, message: completed ? "Task completed." : "Task reopened." };
}

export async function createTaskAction(_previous: TaskActionState, form: FormData): Promise<TaskActionState> {
  const selected = await workspaceId();
  if (typeof selected !== "string") return selected;
  const title = String(form.get("title") ?? "").trim();
  if (!title) return fail("Enter a task title.");
  const projectId = String(form.get("project_id") ?? "");
  const due = String(form.get("due_at") ?? "");
  const result = await createTask(selected, {
    title, project_id: projectId || undefined,
    description: String(form.get("description") ?? "").trim(),
    priority: String(form.get("priority") ?? "MEDIUM"),
    due_at: due ? new Date(due).toISOString() : null,
  });
  if (!result.ok) return fail(result.error.detail);
  revalidatePath("/"); revalidatePath("/tasks");
  return { error: null, message: "Task created." };
}
