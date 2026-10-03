"use client";

import { useActionState, useState, useTransition } from "react";
import { Check, KeyRound, Loader2, Mail, MailCheck, Save } from "lucide-react";
import type { NotificationSettings, WorkspaceProfile } from "@/lib/api";
import { Switch } from "@/components/ui/switch";
import { changePasswordAction, resendVerificationAction, saveNotificationSettingAction, updateNotificationsAction, updateProfileAction, type SettingsState } from "./actions";

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

/**
 * Per-kind in-app switches for this workspace plus the one email that exists (mentions).
 * Each switch saves when flipped and rolls back if the server refuses.
 */
export function NotificationSettingsForm({ initial, workspaceName }: { initial: NotificationSettings; workspaceName: string }) {
  const [settings, setSettings] = useState(initial);
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" | "error"; message?: string }>({ kind: "idle" });
  const [, startTransition] = useTransition();
  const inApp = settings.in_app ?? {};
  const mentionsInApp = inApp.REVIEW_COMMENT_MENTION !== false;

  function save(change: { in_app?: Record<string, boolean>; email_mentions_enabled?: boolean }, optimistic: NotificationSettings) {
    const previous = settings;
    setSettings(optimistic);
    setStatus({ kind: "saving" });
    startTransition(async () => {
      const result = await saveNotificationSettingAction(change);
      if (result.ok) { setSettings(result.settings); setStatus({ kind: "saved" }); }
      else { setSettings(previous); setStatus({ kind: "error", message: result.error }); }
    });
  }

  return <div className="notif-settings">
    <div className="notif-settings-head">
      <h3>In-app notifications <small>in {workspaceName}</small></h3>
      <span className={`notif-status is-${status.kind}`} role="status">
        {status.kind === "saving" && <><Loader2 size={13} className="notif-spin" />Saving…</>}
        {status.kind === "saved" && <><Check size={13} />Saved</>}
        {status.kind === "error" && status.message}
      </span>
    </div>
    <ul className="notif-list">
      {settings.kinds.map((row) => {
        const on = inApp[row.kind] !== false;
        return <li key={row.kind}>
          <span><strong>{row.label}</strong><small>{row.description}</small></span>
          <Switch checked={on} label={`${row.label} in-app notifications`} onCheckedChange={(checked) => save(
            { in_app: { [row.kind]: checked } },
            { ...settings, in_app: { ...inApp, [row.kind]: checked } },
          )} />
        </li>;
      })}
    </ul>
    <div className="notif-settings-head"><h3>Email</h3></div>
    <ul className="notif-list">
      <li className={mentionsInApp ? undefined : "is-disabled"}>
        <span>
          <strong><Mail size={13} />Email me when I&rsquo;m mentioned</strong>
          <small>{mentionsInApp ? "Sent from your account email. Mentions are the only email Blaze Flow sends for now." : "Turn on Mentions above to get mention emails: the email is sent from the in-app notification."}</small>
        </span>
        <Switch checked={settings.email_mentions_enabled && mentionsInApp} label="Email me when I am mentioned" onCheckedChange={(checked) => {
          if (!mentionsInApp) return;
          save({ email_mentions_enabled: checked }, { ...settings, email_mentions_enabled: checked });
        }} />
      </li>
    </ul>
    <p className="notif-later">Daily digests and quiet hours aren&rsquo;t available yet.</p>
  </div>;
}
