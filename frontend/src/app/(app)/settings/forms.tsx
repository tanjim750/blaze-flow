"use client";

import { useActionState, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { Check, KeyRound, Loader2, Mail, MailCheck, Save, TriangleAlert } from "@/components/icons";
import type { NotificationSettings, WhatsAppSettings, WorkspaceProfile } from "@/lib/api";
import { Switch } from "@/components/ui/switch";
import { changePasswordAction, resendVerificationAction, saveNotificationSettingAction, saveWhatsAppSettingsAction, updateNotificationsAction, updateProfileAction, type SettingsState } from "./actions";
import { Select } from "@/components/ui/select";

const initial: SettingsState = { error: null, message: null };
const BUSINESS_NAME_REQUIRED = "Business name is required.";

function Feedback({ state }: { state: SettingsState }) {
  if (state.error) return <p className="form-error" role="alert">{state.error}</p>;
  return state.message ? <p className="settings-success" role="status">{state.message}</p> : null;
}

export function WorkspaceProfileForm({ profile, workspaceName = "" }: { profile: WorkspaceProfile | null; workspaceName?: string }) {
  const [state, action, pending] = useActionState(updateProfileAction, initial);
  const [blank, setBlank] = useState(false);
  const [dirty, setDirty] = useState(false);
  const nameError = blank || (!dirty && state.error === BUSINESS_NAME_REQUIRED);
  // noValidate: our inline message replaces the browser's native "Please fill out this field" bubble.
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    const input = event.currentTarget.elements.namedItem("business_name") as HTMLInputElement | null;
    if (input && !input.value.trim()) { event.preventDefault(); setBlank(true); input.focus(); return; }
    setBlank(false); setDirty(false);
  };
  return <form action={action} onSubmit={onSubmit} noValidate className="settings-form">
    <div className="settings-grid">
      <label><span className="settings-label-row">Business name<small className="settings-required">Required</small></span><input name="business_name" required aria-required="true" maxLength={255} defaultValue={profile?.business_name || workspaceName} aria-invalid={nameError} aria-describedby={nameError ? "business-name-error" : undefined} onChange={(e) => { setDirty(true); if (blank && e.currentTarget.value.trim()) setBlank(false); }} />{nameError && <span id="business-name-error" className="settings-field-error" role="alert">{BUSINESS_NAME_REQUIRED}</span>}</label>
      <label>Contact email<input name="email" type="email" defaultValue={profile?.email ?? ""} /></label>
      <label>Phone<input name="phone" defaultValue={profile?.phone ?? ""} /></label>
      <label>Website<input name="website_url" type="url" placeholder="https://" defaultValue={profile?.website_url ?? ""} /></label>
      <label>City<input name="city" defaultValue={profile?.city ?? ""} /></label>
      <label>Country code<input name="country_code" maxLength={2} placeholder="GB" defaultValue={profile?.country_code ?? ""} /></label>
    </div>
    <label>Description<textarea name="description" rows={4} defaultValue={profile?.description ?? ""} /></label>
    {state.error !== BUSINESS_NAME_REQUIRED && <Feedback state={state} />}
    <button className="settings-button" disabled={pending}><Save size={15} />{pending ? "Saving…" : "Save profile"}</button>
  </form>;
}

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, initial);
  const form = useRef<HTMLFormElement>(null);
  // Every result (mismatch, wrong current password or success) starts the three fields over together.
  useEffect(() => { if (state.error || state.message) form.current?.reset(); }, [state]);
  return <form ref={form} action={action} className="settings-form compact">
    <label>Current password<input name="current_password" type="password" autoComplete="current-password" required /></label>
    <label>New password<input name="new_password" type="password" autoComplete="new-password" required /></label>
    <label>Confirm new password<input name="confirmation" type="password" autoComplete="new-password" required /></label>
    <Feedback state={state} />
    <button className="settings-button" disabled={pending}><KeyRound size={15} />{pending ? "Changing…" : "Change password"}</button>
  </form>;
}

export function VerificationForm({ verified, email }: { verified: boolean; email?: string }) {
  const [state, action, pending] = useActionState(resendVerificationAction, initial);
  return <form action={action} className="verification-row">
    <div>
      <span className={`verification-badge ${verified ? "is-verified" : "is-pending"}`}>{verified ? <><MailCheck size={13} />Verified</> : <><TriangleAlert size={13} />Not verified</>}</span>
      <strong>{verified ? "Email verified" : "Email verification required"}</strong>
      <p>{email && <><span className="verification-email">{email}</span> · </>}{verified ? "Your account can create workspaces." : "Verify your email to unlock workspace creation."}</p>
    </div>
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

/** Workspace switch for WhatsApp approval messages, with the month's usage against the plan cap. */
export function WhatsAppSettingsForm({ initial: start }: { initial: WhatsAppSettings }) {
  const [settings, setSettings] = useState(start);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const save = (change: { enabled?: boolean; link_expiry_hours?: number }) => { setSaved(false); startTransition(async () => {
    const result = await saveWhatsAppSettingsAction(change);
    if (result.ok) { setSettings(result.settings); setError(null); setSaved(true); } else setError(result.error);
  }); };
  const { used, limit, plan } = settings.usage;
  return <div className="settings-form whatsapp-settings">
    <div className="whatsapp-row">
      <div><strong>Send WhatsApp when work is ready to approve</strong><p>Clients who agreed get a WhatsApp message with a Review now link. Email always goes too.</p></div>
      <Switch checked={settings.enabled} onCheckedChange={(enabled) => { if (!pending) save({ enabled }); }} label="WhatsApp approval messages" />
    </div>
    <div className="whatsapp-row">
      <label>Review links expire after<Select
        aria-label="Review links expire after" value={String(settings.link_expiry_hours)} disabled={pending}
        onValueChange={(next) => save({ link_expiry_hours: Number(next) })}
        options={[
          ...([[24, "1 day"], [72, "3 days"], [168, "7 days"], [336, "14 days"], [720, "30 days"]] as const).map(([hours, label]) => ({ value: String(hours), label })),
          ...(![24, 72, 168, 336, 720].includes(settings.link_expiry_hours) ? [{ value: String(settings.link_expiry_hours), label: `${settings.link_expiry_hours} hours` }] : []),
        ]}
      /></label>
      <p className="whatsapp-usage"><span>{used} / {limit}</span> messages this month on the {plan} plan</p>
    </div>
    {settings.test_mode && <p className="whatsapp-test" role="note">Test mode: messages are logged, not sent. Nothing reaches a phone until WhatsApp is connected.</p>}
    {pending && <p className="settings-muted" role="status"><Loader2 size={13} className="spin" /> Saving…</p>}
    {!pending && saved && !error && <p className="settings-success" role="status"><Check size={13} /> Saved</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}
