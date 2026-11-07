"use client";

import Link from "next/link";
import { CircleCheck, TriangleAlert } from "@/components/icons";
import { useState, type FormEvent } from "react";
import { confirmPasswordReset } from "@/lib/auth-client";
import { PasswordField } from "@/components/auth/password-field";
import { FormAlert, SubmitButton } from "@/components/auth/text-field";

export function ResetPasswordForm({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const confirm = String(new FormData(event.currentTarget).get("confirm_password") ?? "");
    const errors: Record<string, string> = {};
    if (password.length < 8) errors.new_password = "Use at least 8 characters.";
    if (!confirm) errors.confirm_password = "Repeat your new password.";
    else if (confirm !== password) errors.confirm_password = "Passwords don’t match.";
    setFieldErrors(errors);
    setError("");
    if (Object.keys(errors).length) return;
    setBusy(true);
    const result = await confirmPasswordReset(token, password);
    setBusy(false);
    if (!result.ok) {
      setExpired(/invalid or expired/i.test(result.error));
      setFieldErrors(result.fieldErrors ?? {});
      setError(result.error);
      return;
    }
    setDone(true);
  }

  if (!token || expired) {
    return (
      <div className="auth-form">
        <div className="auth-status is-bad">
          <span><TriangleAlert size={24} aria-hidden /></span>
          <h2>{token ? "This link has expired" : "This link is incomplete"}</h2>
          <p>{token ? "Reset links work once and expire after 30 minutes. Request a fresh one." : "It is missing its reset token. Open the link from your email again, or request a new one."}</p>
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
          <span><CircleCheck size={24} aria-hidden /></span>
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
    <form className="auth-form" onSubmit={submit} noValidate aria-labelledby="reset-title">
      <header>
        <p className="eyebrow">Password reset</p>
        <h2 id="reset-title">Choose a new password</h2>
        <p className="muted">Make it something you don’t use anywhere else.</p>
      </header>
      {/* Hidden username helps password managers save the new password against the right account. */}
      <input type="text" name="username" autoComplete="username" hidden readOnly />
      <PasswordField name="new_password" label="New password" autoComplete="new-password" placeholder="At least 8 characters"
        meter value={password} onChange={setPassword} error={fieldErrors.new_password} autoFocus />
      <PasswordField name="confirm_password" label="Confirm new password" autoComplete="new-password" placeholder="Repeat it"
        error={fieldErrors.confirm_password} />
      <FormAlert>{error}</FormAlert>
      <SubmitButton busy={busy} busyLabel="Updating…">Update password</SubmitButton>
      <Link className="auth-back" href="/sign-in">Back to sign in</Link>
    </form>
  );
}
