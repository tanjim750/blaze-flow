"use client";

import Link from "next/link";
import { ChevronLeft, Mail, MailCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { requestPasswordReset } from "@/lib/auth-client";

export default function ForgotPassword() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const email = String(new FormData(event.currentTarget).get("email")).trim();
    const result = await requestPasswordReset(email);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // The API answers 202 whether or not the account exists, so the page must not imply
    // that it does. Showing the address back only confirms what was typed.
    setSentTo(email);
  }

  if (sentTo) {
    return (
      <div className="auth-form">
        <div className="auth-status is-good">
          <span><MailCheck size={24} /></span>
          <h2>Check your email</h2>
          <p>
            If an active account exists for {sentTo}, password-reset instructions are on their
            way. The link expires, so use it soon.
          </p>
        </div>
        <div className="auth-actions">
          <Link className="button secondary" href="/sign-in">Back to sign in</Link>
          <button className="button" type="button" onClick={() => setSentTo("")}>
            Use a different address
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <header>
        <p className="eyebrow">Password reset</p>
        <h2>Reset your password</h2>
        <p className="muted">We will email you a link to choose a new one.</p>
      </header>

      <label>
        Email address
        <div className="field">
          <Mail />
          <input name="email" type="email" placeholder="you@company.com" autoComplete="email" required />
        </div>
      </label>

      {error && <p className="form-error" role="alert">{error}</p>}

      <button className="button primary submit" disabled={busy}>
        {busy ? "Sending…" : "Send reset link"}
      </button>

      <Link className="auth-back" href="/sign-in"><ChevronLeft size={13} />Back to sign in</Link>
    </form>
  );
}
