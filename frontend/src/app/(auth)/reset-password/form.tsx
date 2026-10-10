"use client";

import Link from "next/link";
import { CircleCheck, Eye, EyeOff, LockKeyhole, TriangleAlert } from "lucide-react";
import { useState, type FormEvent } from "react";
import { confirmPasswordReset } from "@/lib/auth-client";

export function ResetPasswordForm({ token }: { token: string }) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("new_password"));
    if (password !== String(data.get("confirm_password"))) {
      setError("Both passwords must match.");
      return;
    }
    setBusy(true);
    setError("");
    const result = await confirmPasswordReset(token, password);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDone(true);
  }

  // A link pasted without its query string, or truncated by a mail client.
  if (!token) {
    return (
      <div className="auth-form">
        <div className="auth-status is-bad">
          <span><TriangleAlert size={24} /></span>
          <h2>This link is incomplete</h2>
          <p>It is missing its reset token. Open the link from your email again, or request a new one.</p>
        </div>
        <div className="auth-actions">
          <Link className="button primary" href="/forgot-password">Request a new link</Link>
          <Link className="button secondary" href="/sign-in">Back to sign in</Link>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="auth-form">
        <div className="auth-status is-good">
          <span><CircleCheck size={24} /></span>
          <h2>Password updated</h2>
          <p>Your new password is active. Sign in with it to continue.</p>
        </div>
        <div className="auth-actions">
          <Link className="button primary" href="/sign-in">Sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <header>
        <p className="eyebrow">Password reset</p>
        <h2>Choose a new password</h2>
        <p className="muted">This link can only be used once.</p>
      </header>

      <label>
        New password
        <div className="field">
          <LockKeyhole />
          <input
            name="new_password"
            type={show ? "text" : "password"}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            required
          />
          <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>
            {show ? <EyeOff /> : <Eye />}
          </button>
        </div>
      </label>

      <label>
        Confirm new password
        <div className="field">
          <LockKeyhole />
          <input
            name="confirm_password"
            type={show ? "text" : "password"}
            placeholder="Repeat it"
            autoComplete="new-password"
            required
          />
        </div>
      </label>

      {error && <p className="form-error" role="alert">{error}</p>}

      <button className="button primary submit" disabled={busy}>
        {busy ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}
