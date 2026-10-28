"use client";

import Link from "next/link";
import { CircleCheck, LoaderCircle, Mail, MailCheck, ShieldCheck, TriangleAlert } from "@/components/icons";
import { useState, type FormEvent } from "react";
import { confirmEmailVerification, requestEmailVerification } from "@/lib/auth-client";
import { FormAlert, TextField } from "@/components/auth/text-field";
import { useCooldown } from "@/components/auth/use-cooldown";

type Stage = "ready" | "working" | "done" | "failed";

export function VerifyEmailPanel({ token, sent = false, email = "" }: { token: string; sent?: boolean; email?: string }) {
  const [stage, setStage] = useState<Stage>("ready");
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [resentTo, setResentTo] = useState(sent && email ? email : "");
  const [busy, setBusy] = useState(false);
  const cooldown = useCooldown(60);

  /**
   * Verification is a deliberate click rather than an effect that fires on load. The token
   * is single-use, and mail clients and link scanners routinely prefetch URLs — an
   * automatic confirm would let a prefetch consume the token before the recipient opens it.
   */
  async function verify() {
    setStage("working");
    setError("");
    const result = await confirmEmailVerification(token);
    if (!result.ok) { setError(result.error); setStage("failed"); return; }
    setStage("done");
  }

  async function send(address: string) {
    setBusy(true);
    setError("");
    const result = await requestEmailVerification(address);
    setBusy(false);
    if (!result.ok) { setError(result.error); return false; }
    cooldown.start();
    setResentTo(address);
    return true;
  }

  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    if (!/^\S+@\S+\.\S+$/.test(address)) { setFieldError(address ? "Enter a valid email address." : "Enter your email address."); return; }
    setFieldError("");
    await send(address);
  }

  if (resentTo) {
    return (
      <div className="auth-form">
        <div className="auth-status is-good">
          <span><MailCheck size={24} aria-hidden /></span>
          <h2>Check your inbox</h2>
          <p>We sent a verification link to <b>{resentTo}</b>. Open it on this device to finish. Any earlier link stops working.</p>
        </div>
        <FormAlert>{error}</FormAlert>
        <div className="auth-actions">
          <button className="button secondary" type="button" disabled={busy || cooldown.active} onClick={() => send(resentTo)}>
            {busy ? "Sending…" : cooldown.active ? `Resend in ${cooldown.remaining}s` : "Resend email"}
          </button>
          <Link className="button primary" href="/">Continue to Krewsys</Link>
        </div>
        <p className="auth-hint auth-center">Can’t find it? Check spam or promotions, or <button type="button" className="auth-link-button" onClick={() => setResentTo("")}>use a different address</button>.</p>
      </div>
    );
  }

  if (stage === "done") {
    return (
      <div className="auth-form">
        <div className="auth-status is-good">
          <span><CircleCheck size={24} aria-hidden /></span>
          <h2>Email verified</h2>
          <p>Your address is confirmed. You can create a workspace and start inviting people.</p>
        </div>
        <div className="auth-actions">
          <Link className="button primary" href="/">Go to your workspace</Link>
        </div>
      </div>
    );
  }

  if (!token || stage === "failed") {
    return (
      <form className="auth-form" onSubmit={resend} noValidate>
        <div className="auth-status is-bad">
          <span><TriangleAlert size={24} aria-hidden /></span>
          <h2>{token ? "That link didn’t work" : "This link is incomplete"}</h2>
          <p>
            {token
              ? "Verification links expire, work once, and are replaced whenever a new one is sent."
              : "It is missing its verification token. Open the link from your email again, or get a new one."}
          </p>
        </div>
        <TextField label="Send a new link to" name="email" type="email" inputMode="email" placeholder="you@company.com"
          autoComplete="email" autoCapitalize="none" spellCheck={false} required defaultValue={email}
          icon={<Mail aria-hidden />} error={fieldError} />
        <FormAlert>{error}</FormAlert>
        <button className="button primary submit" type="submit" disabled={busy || cooldown.active}>
          {busy ? "Sending…" : cooldown.active ? `Resend in ${cooldown.remaining}s` : "Send new link"}
        </button>
        <Link className="auth-back" href="/sign-in">Back to sign in</Link>
      </form>
    );
  }

  return (
    <div className="auth-form">
      <div className="auth-status">
        <span>{stage === "working" ? <LoaderCircle size={24} className="auth-spin" aria-hidden /> : <ShieldCheck size={24} aria-hidden />}</span>
        <h2>Verify your email</h2>
        <p>Confirm this address to finish setting up your Krewsys account.</p>
      </div>
      <div className="auth-actions">
        <button className="button primary" type="button" onClick={verify} disabled={stage === "working"} aria-busy={stage === "working" || undefined}>
          {stage === "working" ? "Verifying…" : "Verify my email"}
        </button>
      </div>
      <Link className="auth-back" href="/sign-in">Back to sign in</Link>
    </div>
  );
}
