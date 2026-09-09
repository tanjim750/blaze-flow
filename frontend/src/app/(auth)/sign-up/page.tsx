"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, LockKeyhole, Mail, User } from "lucide-react";
import { useState, type FormEvent } from "react";
import { browserTimezone, signIn, signUp } from "@/lib/auth-client";

export default function SignUp() {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /**
   * Registration and sign-in are two calls because Django's register endpoint creates the
   * account without opening a session. Signing straight in afterwards keeps it to one step
   * for the person filling in the form.
   */
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email"));
    const password = String(data.get("password"));

    const created = await signUp({
      email,
      password,
      first_name: String(data.get("first_name")).trim(),
      last_name: String(data.get("last_name")).trim(),
      timezone: browserTimezone(),
    });
    if (!created.ok) {
      setError(created.error);
      setBusy(false);
      return;
    }

    const session = await signIn(email, password);
    if (!session.ok) {
      // The account exists; only the follow-up sign-in failed, so send them to do it manually.
      setError(`Your account was created, but signing in failed: ${session.error} Try signing in.`);
      setBusy(false);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <header>
        <p className="eyebrow">Get started</p>
        <h2>Create your account</h2>
        <p className="muted">You will get a verification email once you sign up.</p>
      </header>

      <div className="auth-row">
        <label>
          First name
          <div className="field">
            <User />
            <input name="first_name" placeholder="Ada" autoComplete="given-name" required />
          </div>
        </label>
        <label>
          Last name
          <div className="field">
            <input name="last_name" placeholder="Lovelace" autoComplete="family-name" required />
          </div>
        </label>
      </div>

      <label>
        Work email
        <div className="field">
          <Mail />
          <input name="email" type="email" placeholder="you@company.com" autoComplete="email" required />
        </div>
      </label>

      <label>
        Password
        <div className="field">
          <LockKeyhole />
          <input
            name="password"
            type={show ? "text" : "password"}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            required
          />
          <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>
            {show ? <EyeOff /> : <Eye />}
          </button>
        </div>
        <p className="auth-hint">Django checks length, commonness, and similarity to your name.</p>
      </label>

      {error && <p className="form-error" role="alert">{error}</p>}

      <button className="button primary submit" disabled={busy}>
        {busy ? "Creating your account…" : "Create account"}
      </button>

      <p className="form-foot">
        Already have an account? <Link href="/sign-in">Sign in</Link>
      </p>
    </form>
  );
}
