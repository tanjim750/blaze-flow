"use server";

import { redirect } from "next/navigation";
import { createWorkspace, getCurrentUser, requestEmailVerification } from "@/lib/api";

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
  if (!created.ok) return { error: created.error.detail, message: null };
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
