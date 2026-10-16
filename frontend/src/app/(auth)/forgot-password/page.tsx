"use client";

import Link from "next/link";
import { ChevronLeft, Mail, MailCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { requestPasswordReset } from "@/lib/auth-client";
import { FormAlert, SubmitButton, TextField } from "@/components/auth/text-field";
import { useCooldown } from "@/components/auth/use-cooldown";

export default function ForgotPassword() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [sentTo, setSentTo] = useState("");
  const cooldown = useCooldown(60);

  async function send(email: string) {
    setBusy(true);
    setError("");
    const result = await requestPasswordReset(email);
    setBusy(false);
    if (!result.ok) { setError(result.error); setFieldError(result.fieldErrors?.email ?? ""); return false; }
    cooldown.start();
    return true;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) { setFieldError(email ? "Enter a valid email address, like you@company.com." : "Enter your email address."); return; }
    setFieldError("");
    // The API answers 202 whether or not the account exists, so the page must not imply it does.
    if (await send(email)) setSentTo(email);
  }

  if (sentTo) {
    return (
      <div className="auth-form">
        <div className="auth-status is-good">
          <span><MailCheck size={24} aria-hidden /></span>
          <h2>Check your email</h2>
          <p>If an account exists for <b>{sentTo}</b>, a reset link is on its way. It expires in 30 minutes.</p>
        </div>
        <FormAlert>{error}</FormAlert>
        <div className="auth-actions">
          <button className="button secondary" type="button" disabled={cooldown.active || busy} onClick={() => send(sentTo)}>
            {busy ? "Sending…" : cooldown.active ? `Resend in ${cooldown.remaining}s` : "Resend link"}
          </button>
          <button className="button ghost" type="button" onClick={() => setSentTo("")}>Use a different address</button>
        </div>
        <Link className="auth-back" href="/sign-in"><ChevronLeft size={14} aria-hidden />Back to sign in</Link>
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={submit} noValidate aria-labelledby="forgot-title">
      <header>
        <p className="eyebrow">Password reset</p>
        <h2 id="forgot-title">Forgot your password?</h2>
        <p className="muted">Enter your email and we’ll send you a link to choose a new one.</p>
      </header>
      <TextField label="Email address" name="email" type="email" inputMode="email" placeholder="you@company.com"
        autoComplete="email" autoCapitalize="none" spellCheck={false} required autoFocus
        icon={<Mail aria-hidden />} error={fieldError} />
      <FormAlert>{error}</FormAlert>
      <SubmitButton busy={busy} busyLabel="Sending…">Send reset link</SubmitButton>
      <Link className="auth-back" href="/sign-in"><ChevronLeft size={14} aria-hidden />Back to sign in</Link>
    </form>
  );
}
