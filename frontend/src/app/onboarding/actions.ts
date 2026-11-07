"use server";

import { createWorkspace, getCurrentUser, listWorkspaces, requestEmailVerification } from "@/lib/api";
import { activateWorkspace } from "@/lib/workspace-cookie";

export type OnboardingState = { error: string | null; message: string | null; redirectTo?: string };

/**
 * Where a successful create sends the person. The action returns this instead of calling
 * `redirect()`: a server-action redirect is applied by the client router, which could reuse
 * the "/" entry cached on the first visit (an empty workspace list, so "/" redirected to
 * onboarding) and land the person straight back on this form. The form navigates itself and
 * falls back to a full page load, see `form.tsx`.
 */
const created = (): OnboardingState => ({ error: null, message: "Workspace created. Opening your dashboard…", redirectTo: "/" });

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

  const result = await createWorkspace({ name, timezone, ...(slug ? { slug } : {}) });
  if (!result.ok) {
    // A second submit (double click, Back then submit again, a retry after a slow first
    // answer) reaches the API after the first one already made the workspace, and is
    // refused by the slug check or the plan's workspace limit. The person did get their
    // workspace, so take them into it instead of showing an error for a request that worked.
    const existing = await listWorkspaces();
    const recent = Date.now() - 10 * 60 * 1000;
    const made = existing.ok
      ? existing.data.find((workspace) => workspace.name === name && Date.parse(workspace.created_at) >= recent) ?? null
      : null;
    if (!made) return { error: result.error.detail, message: null };
    await activateWorkspace(made.id);
    return created();
  }
  // Select the new workspace and drop the cached app shell, so the dashboard and the
  // workspace switcher show it straight away rather than after a manual refresh.
  await activateWorkspace(result.data.id);
  return created();
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
