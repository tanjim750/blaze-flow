"use server";

import { revalidatePath } from "next/cache";
import { changePassword, getCurrentUser, requestEmailVerification, updateNotificationPreferences, updateWorkspaceProfile } from "@/lib/api";
import { loadWorkspaceContext } from "@/lib/workspace";

export type SettingsState = { error: string | null; message: string | null };
const success = (message: string): SettingsState => ({ error: null, message });
const fail = (error: string): SettingsState => ({ error, message: null });

export async function updateProfileAction(_previous: SettingsState, form: FormData): Promise<SettingsState> {
  const context = await loadWorkspaceContext();
  if (!context.ok) return fail(context.error.detail);
  const workspace = context.data.selected;
  if (!workspace) return fail("Create a workspace before editing its profile.");
  const value = (name: string) => String(form.get(name) ?? "").trim() || null;
  const updated = await updateWorkspaceProfile(workspace.id, {
    business_name: value("business_name"), description: value("description"),
    email: value("email"), phone: value("phone"), website_url: value("website_url"),
    city: value("city"), country_code: value("country_code")?.toUpperCase() ?? null,
  });
  if (!updated.ok) return fail(updated.error.detail);
  revalidatePath("/settings");
  return success("Workspace profile saved.");
}

export async function changePasswordAction(_previous: SettingsState, form: FormData): Promise<SettingsState> {
  const currentPassword = String(form.get("current_password") ?? "");
  const newPassword = String(form.get("new_password") ?? "");
  const confirmation = String(form.get("confirmation") ?? "");
  if (!currentPassword || !newPassword) return fail("Enter your current and new password.");
  if (newPassword !== confirmation) return fail("New password confirmation does not match.");
  const changed = await changePassword({ current_password: currentPassword, new_password: newPassword });
  return changed.ok ? success("Password changed successfully.") : fail(changed.error.detail);
}

export async function resendVerificationAction(previous: SettingsState, form: FormData): Promise<SettingsState> {
  void previous; void form;
  const user = await getCurrentUser();
  if (!user.ok) return fail(user.error.detail);
  if (user.data.email_verified_at) return success("Your email is already verified.");
  const sent = await requestEmailVerification(user.data.email);
  return sent.ok ? success("Verification instructions requested. Check your inbox.") : fail(sent.error.detail);
}

export async function updateNotificationsAction(_previous: SettingsState, form: FormData): Promise<SettingsState> {
  const result = await updateNotificationPreferences({ email_mentions_enabled: form.get("email_mentions_enabled") === "on" });
  if (!result.ok) return fail(result.error.detail); revalidatePath("/settings"); return success("Notification preferences saved.");
}
