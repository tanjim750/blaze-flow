"use client";

import { useAppRouter } from "@/lib/app-router";
import Link from "next/link";
import { Mail, User, Users } from "@/components/icons";
import { useState, type FormEvent } from "react";
import { browserTimezone, safeNext, signIn, signUp, type InvitePreview } from "@/lib/auth-client";
import { GoogleSignIn } from "@/components/google-sign-in";
import { PasswordField } from "@/components/auth/password-field";
import { FormAlert, SubmitButton, TextField } from "@/components/auth/text-field";

type Props = { inviteToken?: string; invite?: InvitePreview | null; inviteOnly?: boolean; next?: string };

export function SignUpForm({ inviteToken, invite, inviteOnly = false, next }: Props) {
  const router = useAppRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [closed, setClosed] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [password, setPassword] = useState("");
  const [names, setNames] = useState({ first: "", last: "", email: invite?.email ?? "" });
  const destination = inviteToken ? `/invite?token=${encodeURIComponent(inviteToken)}` : safeNext(next, "/onboarding");

  function validate(data: { first_name: string; last_name: string; email: string; password: string }) {
    const errors: Record<string, string> = {};
    if (!data.first_name) errors.first_name = "Enter your first name.";
    if (!data.last_name) errors.last_name = "Enter your last name.";
    if (!data.email) errors.email = "Enter your email address.";
    else if (!/^\S+@\S+\.\S+$/.test(data.email)) errors.email = "Enter a valid email address, like you@company.com.";
    if (data.password.length < 8) errors.password = "Use at least 8 characters.";
    return errors;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      first_name: String(form.get("first_name") ?? "").trim(),
      last_name: String(form.get("last_name") ?? "").trim(),
      email: String(form.get("email") ?? "").trim(),
      password: String(form.get("password") ?? ""),
    };
    const errors = validate(payload);
    setFieldErrors(errors);
    setError("");
    setClosed(false);
    if (Object.keys(errors).length) return;
    setBusy(true);
    const created = await signUp({ ...payload, timezone: browserTimezone(), invite_token: inviteToken });
    if (!created.ok) {
      setFieldErrors(created.fieldErrors ?? {});
      setClosed(created.code === "signup_closed");
      setError(created.error);
      setBusy(false);
      return;
    }
    const session = await signIn(payload.email, payload.password);
    if (!session.ok) {
      setError(`Your account was created, but signing in failed: ${session.error} Try signing in.`);
      setBusy(false);
      return;
    }
    // Invited people go straight to accept; everyone else lands on "check your inbox".
    router.push(inviteToken || next ? destination : `/verify-email?sent=1&email=${encodeURIComponent(payload.email)}`);
    router.refresh();
  }

  return (
    <form className="auth-form" onSubmit={submit} noValidate aria-labelledby="sign-up-title">
      <header>
        <p className="eyebrow">{invite ? "You’re invited" : "Get started"}</p>
        <h2 id="sign-up-title">{invite ? `Join ${invite.workspace_name}` : "Create your account"}</h2>
        <p className="muted">
          {invite
            ? `${invite.inviter_name ?? "Your team"} invited you${invite.role_name ? ` as ${invite.role_name}` : ""}. Create an account to accept.`
            : "Free to start. We’ll send a link to verify your email."}
        </p>
      </header>

      {invite && (
        <div className="auth-invite-chip"><Users size={15} aria-hidden /><span>Invitation for <b>{invite.email ?? "you"}</b></span></div>
      )}
      {inviteOnly && !invite && (
        <FormAlert tone="info">Sign-up is invite-only. Use the email address your invitation was sent to.</FormAlert>
      )}

      <GoogleSignIn destination={destination} inviteToken={inviteToken} label="Sign up with Google" />
      <div className="auth-divider"><span>or sign up with email</span></div>

      <div className="auth-row">
        <TextField label="First name" name="first_name" placeholder="Ada" autoComplete="given-name" required
          icon={<User aria-hidden />} error={fieldErrors.first_name} value={names.first}
          onChange={(e) => setNames({ ...names, first: e.target.value })} />
        <TextField label="Last name" name="last_name" placeholder="Lovelace" autoComplete="family-name" required
          error={fieldErrors.last_name} value={names.last}
          onChange={(e) => setNames({ ...names, last: e.target.value })} />
      </div>

      <TextField label="Work email" name="email" type="email" inputMode="email" placeholder="you@company.com"
        autoComplete="email" autoCapitalize="none" spellCheck={false} required icon={<Mail aria-hidden />}
        error={fieldErrors.email} value={names.email} readOnly={Boolean(invite?.email)}
        hint={invite?.email ? "Your invite is tied to this address." : undefined}
        onChange={(e) => setNames({ ...names, email: e.target.value })} />

      <PasswordField name="password" label="Password" autoComplete="new-password" placeholder="At least 8 characters"
        meter value={password} onChange={setPassword} error={fieldErrors.password}
        context={[names.first, names.last, names.email.split("@")[0] ?? ""]} />

      {error && (
        <FormAlert>
          {error}
          {closed && <> <Link href="/sign-in">Sign in</Link> if you already have an account.</>}
        </FormAlert>
      )}

      <SubmitButton busy={busy} busyLabel="Creating your account…">{invite ? "Create account & join" : "Create account"}</SubmitButton>

      <p className="auth-legal">By creating an account you agree to use Krewsys responsibly with your team’s work.</p>
      <p className="form-foot">
        Already have an account? <Link href={inviteToken ? `/sign-in?next=${encodeURIComponent(destination)}` : "/sign-in"}>Sign in</Link>
      </p>
    </form>
  );
}
