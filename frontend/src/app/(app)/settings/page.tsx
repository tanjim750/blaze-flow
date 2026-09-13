import { Bell, Building2, CircleUserRound, ShieldCheck } from "lucide-react";
import { getNotificationPreferences, getWorkspaceProfile } from "@/lib/api";
import { loadSession } from "@/lib/session";
import { displayName } from "@/lib/user";
import { NotificationPreferencesForm, PasswordForm, VerificationForm, WorkspaceProfileForm } from "./forms";
import "./settings.css";
import { loadWorkspaceContext } from "@/lib/workspace";

export default async function SettingsPage() {
  const session = await loadSession();
  if (!session.user) {
    return <><div className="settings-page">
      <header><p className="eyebrow">Account & workspace</p><h1>Settings</h1></header>
      <p className="form-error" role="alert">{session.notice} Account settings are unavailable until the API reconnects.</p>
    </div></>;
  }
  const workspaceContext = await loadWorkspaceContext();
  const workspace = workspaceContext.ok ? workspaceContext.data.selected : null;
  const loadedProfile = workspace ? await getWorkspaceProfile(workspace.id) : null;
  const loadedNotifications = await getNotificationPreferences();
  const profile = loadedProfile?.ok ? loadedProfile.data : null;
  const user = session.user;

  return <><div className="settings-page">
    <header><p className="eyebrow">Account & workspace</p><h1>Settings</h1><p>Manage your identity, studio profile, and account security.</p></header>
    <section className="settings-card identity-card">
      <div className="settings-title"><CircleUserRound /><div><h2>Account profile</h2><p>Your sign-in identity is managed by Blaze Flow.</p></div></div>
      <div className="identity-values"><span><small>Name</small><strong>{displayName(user)}</strong></span><span><small>Email</small><strong>{user.email}</strong></span><span><small>Timezone</small><strong>{user.timezone || "UTC"}</strong></span></div>
      <VerificationForm verified={Boolean(user.email_verified_at)} />
    </section>
    <section className="settings-card">
      <div className="settings-title"><Bell /><div><h2>Notifications</h2><p>Choose when Blaze Flow should also send email.</p></div></div>
      <NotificationPreferencesForm emailMentionsEnabled={loadedNotifications.ok ? loadedNotifications.data.email_mentions_enabled : true} />
    </section>
    <section className="settings-card">
      <div className="settings-title"><Building2 /><div><h2>Workspace profile</h2><p>{workspace ? `Public business details for ${workspace.name}.` : "Create a workspace to add business details."}</p></div></div>
      {workspace ? <WorkspaceProfileForm profile={profile} /> : <p className="settings-muted">No workspace is available.</p>}
    </section>
    <section className="settings-card">
      <div className="settings-title"><ShieldCheck /><div><h2>Password & security</h2><p>Use a strong password you do not reuse elsewhere.</p></div></div>
      <PasswordForm />
    </section>
  </div></>;
}
