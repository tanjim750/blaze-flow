"use client";

import { useAppRouter } from "@/lib/app-router";
import Link from "next/link";
import { LogOut, Mail } from "lucide-react";
import { useState, type FormEvent } from "react";
import { safeNext, signIn } from "@/lib/auth-client";
import { GoogleSignIn } from "@/components/google-sign-in";
import { PasswordField } from "@/components/auth/password-field";
import { FormAlert, SubmitButton, TextField } from "@/components/auth/text-field";

export function SignInForm({ next, signedOut = false, email = "" }: { next?: string; signedOut?: boolean; email?: string }) {
  const router = useAppRouter();
  const destination = safeNext(next);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const address = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const errors: Record<string, string> = {};
    if (!address) errors.email = "Enter your email address.";
    else if (!/^\S+@\S+\.\S+$/.test(address)) errors.email = "Enter a valid email address, like you@company.com.";
    if (!password) errors.password = "Enter your password.";
    setFieldErrors(errors);
    setError("");
    if (Object.keys(errors).length) return;
    setBusy(true);
    const result = await signIn(address, password);
    if (!result.ok) {
      setFieldErrors(result.fieldErrors ?? {});
      setError(result.error);
      setBusy(false);
      return;
    }
    router.push(destination);
    router.refresh();
  }

  const signUpHref = next ? `/sign-up?next=${encodeURIComponent(destination)}` : "/sign-up";

  return (
    <form className="auth-form" onSubmit={submit} noValidate aria-labelledby="sign-in-title">
      <header>
        <p className="eyebrow">Welcome back</p>
        <h2 id="sign-in-title">Sign in to Blaze Flow</h2>
        <p className="muted">Pick up where your team left off.</p>
      </header>

      {signedOut && (
        <FormAlert tone="info"><LogOut size={15} aria-hidden /> You’ve been signed out. See you soon.</FormAlert>
      )}

      <GoogleSignIn destination={destination} />
      <div className="auth-divider"><span>or sign in with email</span></div>

      <TextField
        label="Email address" name="email" type="email" inputMode="email" defaultValue={email}
        placeholder="you@company.com" autoComplete="username" autoCapitalize="none" spellCheck={false}
        required icon={<Mail aria-hidden />} error={fieldErrors.email} autoFocus={!email}
      />

      <PasswordField
        name="password" label="Password" autoComplete="current-password" placeholder="Your password"
        error={fieldErrors.password} autoFocus={Boolean(email)}
        labelAside={<Link className="auth-inline-link" href="/forgot-password">Forgot password?</Link>}
      />

      <FormAlert>{error}</FormAlert>

      <SubmitButton busy={busy} busyLabel="Signing in…">Sign in</SubmitButton>

      <p className="form-foot">
        New to Blaze Flow? <Link href={signUpHref}>Create an account</Link>
      </p>
    </form>
  );
}
