"use server";

import { redirect } from "next/navigation";
import { createWorkspace, getCurrentUser, listWorkspaces, requestEmailVerification } from "@/lib/api";
import { activateWorkspace } from "@/lib/workspace-cookie";

export type OnboardingState = { error: string | null; message: string | null };

export async function createWorkspaceAction(_previous: OnboardingState, form: FormData): Promise<OnboardingState> {
  const name = String(form.get("name") ?? "").trim();
  const slug = String(form.get("slug") ?? "").trim();
  const timezone = String(form.get("timezone") ?? "").trim() || "UTC";
  if (!name) return { error: "Enter a workspace name.", message: null };

  const user = await getCurrentUser();
  if (!user.ok) return { error: user.error.detail, message: null };
  if (!user.data.email_verified_at) {
    return { error: "Verify your email address before creating a workspace.", message: null };
  }

  const created = await createWorkspace({ name, timezone, ...(slug ? { slug } : {}) });
  if (!created.ok) {
    // A second submit (double click, Back then submit again, a retry after a slow first
    // answer) reaches the API after the first one already made the workspace, and is
    // refused by the slug check or the plan's workspace limit. The person did get their
    // workspace, so take them into it instead of showing an error for a request that worked.
    const existing = await listWorkspaces();
    const recent = Date.now() - 10 * 60 * 1000;
    const made = existing.ok
      ? existing.data.find((workspace) => workspace.name === name && Date.parse(workspace.created_at) >= recent) ?? null
      : null;
    if (!made) return { error: created.error.detail, message: null };
    await activateWorkspace(made.id);
    redirect("/");
  }
  // Select the new workspace and drop the cached app shell, so the dashboard and the
  // workspace switcher show it straight away rather than after a manual refresh.
  await activateWorkspace(created.data.id);
  redirect("/");
}

export async function resendOnboardingVerificationAction(
  previous: OnboardingState,
  form: FormData,
): Promise<OnboardingState> {
  void previous; void form;
  const user = await getCurrentUser();
  if (!user.ok) return { error: user.error.detail, message: null };
  const sent = await requestEmailVerification(user.data.email);
  if (!sent.ok) return { error: sent.error.detail, message: null };
  return { error: null, message: "Verification instructions requested. Check your inbox, then refresh this page." };
}
