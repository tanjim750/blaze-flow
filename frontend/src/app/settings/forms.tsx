"use client";

import { useActionState } from "react";
import { KeyRound, MailCheck, Save } from "lucide-react";
import type { WorkspaceProfile } from "@/lib/api";
import { changePasswordAction, resendVerificationAction, updateNotificationsAction, updateProfileAction, type SettingsState } from "./actions";

const initial: SettingsState = { error: null, message: null };

function Feedback({ state }: { state: SettingsState }) {
  if (state.error) return <p className="form-error" role="alert">{state.error}</p>;
  return state.message ? <p className="settings-success" role="status">{state.message}</p> : null;
}

export function WorkspaceProfileForm({ profile }: { profile: WorkspaceProfile | null }) {
  const [state, action, pending] = useActionState(updateProfileAction, initial);
  return <form action={action} className="settings-form">
    <div className="settings-grid">
      <label>Business name<input name="business_name" defaultValue={profile?.business_name ?? ""} /></label>
      <label>Contact email<input name="email" type="email" defaultValue={profile?.email ?? ""} /></label>
      <label>Phone<input name="phone" defaultValue={profile?.phone ?? ""} /></label>
      <label>Website<input name="website_url" type="url" placeholder="https://" defaultValue={profile?.website_url ?? ""} /></label>
      <label>City<input name="city" defaultValue={profile?.city ?? ""} /></label>
      <label>Country code<input name="country_code" maxLength={2} placeholder="GB" defaultValue={profile?.country_code ?? ""} /></label>
    </div>
    <label>Description<textarea name="description" rows={4} defaultValue={profile?.description ?? ""} /></label>
    <Feedback state={state} />
    <button className="settings-button" disabled={pending}><Save size={15} />{pending ? "Saving…" : "Save profile"}</button>
  </form>;
}

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, initial);
  return <form action={action} className="settings-form compact">
    <label>Current password<input name="current_password" type="password" autoComplete="current-password" required /></label>
    <label>New password<input name="new_password" type="password" autoComplete="new-password" required /></label>
    <label>Confirm new password<input name="confirmation" type="password" autoComplete="new-password" required /></label>
    <Feedback state={state} />
    <button className="settings-button" disabled={pending}><KeyRound size={15} />{pending ? "Changing…" : "Change password"}</button>
  </form>;
}

export function VerificationForm({ verified }: { verified: boolean }) {
  const [state, action, pending] = useActionState(resendVerificationAction, initial);
  return <form action={action} className="verification-row">
    <div><strong>{verified ? "Email verified" : "Email verification required"}</strong><p>{verified ? "Your account can create workspaces." : "Verify your email to unlock workspace creation."}</p></div>
    {!verified && <button className="settings-button" disabled={pending}><MailCheck size={15} />{pending ? "Requesting…" : "Resend email"}</button>}
    <Feedback state={state} />
  </form>;
}

export function NotificationPreferencesForm({ emailMentionsEnabled }: { emailMentionsEnabled: boolean }) {
  const [state, action, pending] = useActionState(updateNotificationsAction, initial);
  return <form action={action} className="settings-form compact"><label className="settings-check"><input type="checkbox" name="email_mentions_enabled" defaultChecked={emailMentionsEnabled} /><span><strong>Email me when I am mentioned</strong><small>In-app notifications always remain available.</small></span></label><Feedback state={state} /><button className="settings-button" disabled={pending}><Save size={15} />{pending ? "Saving…" : "Save notifications"}</button></form>;
}
