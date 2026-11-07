"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Building2, MailCheck, RefreshCw } from "@/components/icons";
import { createWorkspaceAction, resendOnboardingVerificationAction, type OnboardingState } from "./actions";

const initial: OnboardingState = { error: null, message: null };
/** How long the soft navigation gets before a full page load takes over. */
export const HARD_NAVIGATION_FALLBACK_MS = 2500;

/**
 * Leaves onboarding once the workspace exists. A soft navigation plus refresh is tried first;
 * if the page is still on onboarding after a moment (the router reused a stale "/" entry, or
 * a guard bounced it back), a full page load fetches everything fresh from the server.
 */
export function useLeaveOnboarding(redirectTo: string | undefined) {
  const router = useRouter();
  useEffect(() => {
    if (!redirectTo) return;
    router.replace(redirectTo);
    router.refresh();
    const timer = window.setTimeout(() => {
      if (window.location.pathname.startsWith("/onboarding")) window.location.assign(redirectTo);
    }, HARD_NAVIGATION_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [redirectTo, router]);
}

export function OnboardingForm({ verified, email, defaultTimezone }: { verified: boolean; email: string; defaultTimezone: string }) {
  const [workspaceState, createAction, creating] = useActionState(createWorkspaceAction, initial);
  const [verifyState, resendAction, resending] = useActionState(resendOnboardingVerificationAction, initial);
  const done = Boolean(workspaceState.redirectTo);
  useLeaveOnboarding(workspaceState.redirectTo);

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
      <p className="eyebrow">Welcome to Krewsys</p>
      <h1>Create your workspace</h1>
      <p>This is the home for your clients, campaigns, reviews, and team.</p>
      <form action={createAction} className="onboarding-form" aria-busy={creating || done}>
        <label>Workspace name<input name="name" placeholder="Northstar Studio" required autoFocus /></label>
        <label>Workspace URL <div className="slug-field"><span>krewsys /</span><input name="slug" placeholder="northstar-studio" pattern="[a-z0-9-]+" /></div></label>
        <input type="hidden" name="timezone" value={defaultTimezone} />
        <small>Timezone: {defaultTimezone}</small>
        {workspaceState.error && <p className="form-error" role="alert">{workspaceState.error}</p>}
        {workspaceState.message && <p className="form-success" role="status">{workspaceState.message}</p>}
        {/* Locked while pending and after success, so a slow redirect can't invite a second submit. */}
        <button className="onboarding-primary" disabled={creating || done}>{creating ? "Creating workspace…" : done ? "Opening dashboard…" : "Create workspace"}</button>
      </form>
    </section>
  );
}
