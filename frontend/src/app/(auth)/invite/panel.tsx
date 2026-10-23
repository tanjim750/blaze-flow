"use client";

import Link from "next/link";
import { CircleCheck, LoaderCircle, TriangleAlert, Users } from "lucide-react";
import { useState } from "react";
import { useAppRouter } from "@/lib/app-router";
import type { InvitePreview } from "@/lib/auth-client";
import { FormAlert } from "@/components/auth/text-field";
import { acceptInviteAction } from "./actions";

type Props = { token: string; invite: InvitePreview | null; userEmail: string | null; rateLimited?: boolean };

export function InvitePanel({ token, invite, userEmail, rateLimited = false }: Props) {
  const router = useAppRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const here = `/invite?token=${encodeURIComponent(token)}`;

  if (token && rateLimited) {
    return (
      <div className="auth-form">
        <div className="auth-status is-bad">
          <span><TriangleAlert size={24} aria-hidden /></span>
          <h2>Too many attempts</h2>
          <p>We couldn’t check this invitation just now. Wait a minute, then try again.</p>
        </div>
        <div className="auth-actions">
          <Link className="button primary" href={here}>Try again</Link>
        </div>
      </div>
    );
  }

  if (!token || !invite || invite.state !== "valid") {
    const accepted = invite?.state === "accepted";
    return (
      <div className="auth-form">
        <div className={`auth-status ${accepted ? "is-good" : "is-bad"}`}>
          <span>{accepted ? <CircleCheck size={24} aria-hidden /> : <TriangleAlert size={24} aria-hidden />}</span>
          <h2>{accepted ? "Invitation already accepted" : !token ? "This invite link is incomplete" : "This invitation isn’t available"}</h2>
          <p>{accepted
            ? "This invite has been used. Sign in to open the workspace."
            : "It may have expired or been revoked. Ask the person who invited you to send a new one."}</p>
        </div>
        <div className="auth-actions">
          <Link className="button primary" href={userEmail ? "/" : "/sign-in"}>{userEmail ? "Go to Blaze Flow" : "Sign in"}</Link>
        </div>
      </div>
    );
  }

  const mismatch = Boolean(userEmail && invite.email && userEmail.toLowerCase() !== invite.email.toLowerCase());

  async function accept() {
    setBusy(true);
    setError("");
    const result = await acceptInviteAction(token, invite!.kind);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setDone(true);
    router.refresh();
  }

  if (done) {
    return (
      <div className="auth-form">
        <div className="auth-status is-good">
          <span><CircleCheck size={24} aria-hidden /></span>
          <h2>You’re in</h2>
          <p>You joined <b>{invite.workspace_name}</b>.</p>
        </div>
        <div className="auth-actions"><Link className="button primary" href="/">Open {invite.workspace_name}</Link></div>
      </div>
    );
  }

  return (
    <div className="auth-form">
      <div className="auth-status">
        <span><Users size={24} aria-hidden /></span>
        <p className="eyebrow">{invite.kind === "workspace" ? "Workspace invitation" : "Client team invitation"}</p>
        <h2>Join {invite.workspace_name}</h2>
        <p>
          {invite.inviter_name ?? "Your team"} invited {invite.email ? <b>{invite.email}</b> : "you"}
          {invite.role_name ? <> as <b>{invite.role_name}</b></> : null}.
        </p>
      </div>

      {mismatch && (
        <FormAlert tone="info">
          You’re signed in as <b>{userEmail}</b>, but this invite is for <b>{invite.email}</b>. Sign out and use that address to accept.
        </FormAlert>
      )}
      <FormAlert>{error}</FormAlert>

      <div className="auth-actions">
        {userEmail ? (
          <button className="button primary" type="button" onClick={accept} disabled={busy || mismatch} aria-busy={busy || undefined}>
            {busy ? <><LoaderCircle size={16} className="auth-spin" aria-hidden /> Joining…</> : "Accept invitation"}
          </button>
        ) : (
          <>
            <Link className="button primary" href={`/sign-up?invite=${encodeURIComponent(token)}`}>Create account &amp; join</Link>
            <Link className="button secondary" href={`/sign-in?next=${encodeURIComponent(here)}${invite.email ? `&email=${encodeURIComponent(invite.email)}` : ""}`}>I already have an account</Link>
          </>
        )}
      </div>
      <p className="auth-hint auth-center">Invitation expires {new Date(invite.expires_at).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}.</p>
    </div>
  );
}
