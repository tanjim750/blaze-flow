"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { useState, type FormEvent } from "react";
import { signIn } from "@/lib/auth-client";
import { GoogleSignIn } from "@/components/google-sign-in";

export default function SignIn() {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const result = await signIn(String(data.get("email")), String(data.get("password")));
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    // refresh() so the server components re-render with the session that was just opened.
    router.push("/");
    router.refresh();
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <header>
        <p className="eyebrow">Welcome back</p>
        <h2>Sign in to your workspace</h2>
        <p className="muted">Use your work email to continue.</p>
      </header>

      <GoogleSignIn />
      <div className="auth-divider"><span>or use email</span></div>

      <label>
        Email address
        <div className="field">
          <Mail />
          <input name="email" type="email" placeholder="you@company.com" autoComplete="email" required />
        </div>
      </label>

      <label>
        Password <Link href="/forgot-password">Forgot password?</Link>
        <div className="field">
          <LockKeyhole />
          <input
            name="password"
            type={show ? "text" : "password"}
            placeholder="Enter your password"
            autoComplete="current-password"
            required
          />
          <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>
            {show ? <EyeOff /> : <Eye />}
          </button>
        </div>
      </label>

      {error && <p className="form-error" role="alert">{error}</p>}

      <button className="button primary submit" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>

      <p className="form-foot">
        New to Blaze Flow? <Link href="/sign-up">Create an account</Link>
      </p>
    </form>
  );
}
