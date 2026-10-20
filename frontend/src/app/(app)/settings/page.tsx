import { guardRoute } from "@/lib/route-guard";
import { Bell, BookA, Building2, CircleUserRound, Coins, FileText, Palette, ShieldCheck } from "lucide-react";
import { getGlossary, getInvoiceSettings, getRates } from "@/lib/studio-settings-server";
import { GlossaryForm, InvoiceSettingsForm, RatesForm } from "@/components/settings/studio-settings";
import { getBranding, getNotificationPreferences, getNotificationSettings, getWorkspaceProfile } from "@/lib/api";
import { BrandingForm } from "@/components/portal/branding-form";
import "@/components/portal/portal.css";
import { loadSession } from "@/lib/session";
import { displayName } from "@/lib/user";
import { NotificationPreferencesForm, NotificationSettingsForm, PasswordForm, VerificationForm, WorkspaceProfileForm } from "./forms";
import "./settings.css";
import { loadWorkspaceContext } from "@/lib/workspace";
import { roleFor } from "@/lib/dashboard-role";

export default async function SettingsPage() {
  await guardRoute("/settings");
  const session = await loadSession();
  if (!session.user) {
    return <><div className="settings-page">
      <header><p className="eyebrow">Account & workspace</p><h1>Settings</h1></header>
      <p className="form-error" role="alert">{session.notice} Account settings are unavailable until the API reconnects.</p>
    </div></>;
  }
  const workspaceContext = await loadWorkspaceContext();
  const workspace = workspaceContext.ok ? workspaceContext.data.selected : null;
  // Editors get their own account here; the studio's profile and branding are the owners'.
  const studio = Boolean(workspace && roleFor(workspace) === "owner");
  const [loadedProfile, loadedBranding] = workspace && studio
    ? await Promise.all([getWorkspaceProfile(workspace.id), getBranding(workspace.id)])
    : [null, null];
  const [loadedNotifications, loadedSettings] = await Promise.all([
    getNotificationPreferences(),
    workspace ? getNotificationSettings(workspace.id) : Promise.resolve(null),
  ]);
  const profile = loadedProfile?.ok ? loadedProfile.data : null;
  // Each section shows only when the viewer's role can load it (billing view, rates view, AI QA on).
  const billing = workspace?.billing;
  const [invoicing, rates, glossary] = workspace && studio
    ? await Promise.all([
      billing?.view ? getInvoiceSettings(workspace.id) : null,
      billing?.rates_view ? getRates(workspace.id) : null,
      getGlossary(workspace.id),
    ])
    : [null, null, null];
  const user = session.user;

  return <><div className="settings-page">
    <header><p className="eyebrow">Account & workspace</p><h1>{studio ? "Settings" : "My profile"}</h1><p>{studio ? "Manage your identity, studio profile, and account security." : "Your account, notifications and password."}</p></header>
    <section className="settings-card identity-card">
      <div className="settings-title"><CircleUserRound /><div><h2>Account profile</h2><p>Your sign-in identity is managed by Blaze Flow.</p></div></div>
      <div className="identity-values"><span><small>Name</small><strong>{displayName(user)}</strong></span><span><small>Email</small><strong>{user.email}</strong></span><span><small>Timezone</small><strong>{user.timezone || "UTC"}</strong></span></div>
      <VerificationForm verified={Boolean(user.email_verified_at)} />
    </section>
    <section className="settings-card" id="notifications">
      <div className="settings-title"><Bell /><div><h2>Notifications</h2><p>Choose what shows up in your bell, and when Blaze Flow should also send email.</p></div></div>
      {workspace && loadedSettings?.ok
        ? <NotificationSettingsForm initial={loadedSettings.data} workspaceName={workspace.name} />
        : <>
          {workspace && loadedSettings && !loadedSettings.ok && <p className="form-error" role="alert">In-app settings could not be loaded: {loadedSettings.error.detail}</p>}
          <NotificationPreferencesForm emailMentionsEnabled={loadedNotifications.ok ? loadedNotifications.data.email_mentions_enabled : true} />
        </>}
    </section>
    {(studio || !workspace) && <section className="settings-card">
      <div className="settings-title"><Building2 /><div><h2>Workspace profile</h2><p>{workspace ? `Public business details for ${workspace.name}.` : "Create a workspace to add business details."}</p></div></div>
      {workspace ? <WorkspaceProfileForm profile={profile} /> : <p className="settings-muted">No workspace is available.</p>}
    </section>}
    {workspace && loadedBranding?.ok && <section className="settings-card" id="branding">
      <div className="settings-title"><Palette /><div><h2>Client portal branding</h2><p>Your logo, colour and welcome line on the client portal and on upload pages.</p></div></div>
      <BrandingForm workspaceId={workspace.id} initial={loadedBranding.data} canEdit={loadedBranding.data.can_edit === true} />
    </section>}
    {workspace && invoicing?.ok && <section className="settings-card" id="invoicing">
      <div className="settings-title"><FileText /><div><h2>Invoicing</h2><p>Invoice numbering, payment terms and the currency for prices and invoices.</p></div></div>
      <InvoiceSettingsForm workspaceId={workspace.id} initial={invoicing.data} canEdit={billing?.manage === true} />
    </section>}
    {workspace && rates?.ok && <section className="settings-card" id="rates">
      <div className="settings-title"><Coins /><div><h2>Editors&rsquo; default rates</h2><p>Pre-fills an editor&rsquo;s pay when they&rsquo;re assigned a task. You can still change it per task.</p></div></div>
      <RatesForm workspaceId={workspace.id} currency={rates.data.currency} rows={rates.data.results} canEdit={billing?.manage === true} />
    </section>}
    {workspace && glossary?.ok && <section className="settings-card" id="glossary">
      <div className="settings-title"><BookA /><div><h2>AI QA glossary</h2><p>Words AI QA should treat as spelled correctly: brands, products, names and acronyms.</p></div></div>
      <GlossaryForm workspaceId={workspace.id} initial={glossary.data} canEdit />
    </section>}
    <section className="settings-card">
      <div className="settings-title"><ShieldCheck /><div><h2>Password & security</h2><p>Use a strong password you do not reuse elsewhere.</p></div></div>
      <PasswordForm />
    </section>
  </div></>;
}
