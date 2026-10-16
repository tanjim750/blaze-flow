"use client";

import { useActionState } from "react";
import { Building2, MailCheck, RefreshCw } from "lucide-react";
import { createWorkspaceAction, resendOnboardingVerificationAction, type OnboardingState } from "./actions";

const initial: OnboardingState = { error: null, message: null };

export function OnboardingForm({ verified, email, defaultTimezone }: { verified: boolean; email: string; defaultTimezone: string }) {
  const [workspaceState, createAction, creating] = useActionState(createWorkspaceAction, initial);
  const [verifyState, resendAction, resending] = useActionState(resendOnboardingVerificationAction, initial);

  if (!verified) {
    return (
      <section className="onboarding-card">
        <span className="onboarding-icon"><MailCheck /></span>
        <p className="eyebrow">One quick check</p>
        <h1>Verify your work email</h1>
        <p>We sent a verification link to <strong>{email}</strong>. Open it before creating your first workspace.</p>
        <form action={resendAction}>
          <button className="onboarding-primary" disabled={resending}><RefreshCw size={15} />{resending ? "Requesting…" : "Resend verification email"}</button>
        </form>
        {verifyState.error && <p className="form-error" role="alert">{verifyState.error}</p>}
        {verifyState.message && <p className="form-success" role="status">{verifyState.message}</p>}
        <button className="onboarding-link" onClick={() => location.reload()}>I’ve verified — refresh</button>
      </section>
    );
  }

  return (
    <section className="onboarding-card">
      <span className="onboarding-icon"><Building2 /></span>
      <p className="eyebrow">Welcome to Blaze Flow</p>
      <h1>Create your workspace</h1>
      <p>This is the home for your clients, campaigns, reviews, and team.</p>
      <form action={createAction} className="onboarding-form">
        <label>Workspace name<input name="name" placeholder="Northstar Studio" required autoFocus /></label>
        <label>Workspace URL <div className="slug-field"><span>blazeflow /</span><input name="slug" placeholder="northstar-studio" pattern="[a-z0-9-]+" /></div></label>
        <input type="hidden" name="timezone" value={defaultTimezone} />
        <small>Timezone: {defaultTimezone}</small>
        {workspaceState.error && <p className="form-error" role="alert">{workspaceState.error}</p>}
        <button className="onboarding-primary" disabled={creating}>{creating ? "Creating workspace…" : "Create workspace"}</button>
      </form>
    </section>
  );
}
