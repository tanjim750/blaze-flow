"use client";

import Link from "next/link";
import { CircleCheck, LoaderCircle, Mail, MailCheck, ShieldCheck, TriangleAlert } from "lucide-react";
import { useState, type FormEvent } from "react";
import { confirmEmailVerification, requestEmailVerification } from "@/lib/auth-client";

type Stage = "ready" | "working" | "done" | "failed";

export function VerifyEmailPanel({ token }: { token: string }) {
  const [stage, setStage] = useState<Stage>("ready");
  const [error, setError] = useState("");
  const [resentTo, setResentTo] = useState("");

  /**
   * Verification is a deliberate click rather than an effect that fires on load. The token
   * is single-use, and mail clients and link scanners routinely prefetch URLs — an
   * automatic confirm would let a prefetch consume the token before the recipient ever
   * opened the page.
   */
  async function verify() {
    setStage("working");
    setError("");
    const result = await confirmEmailVerification(token);
    if (!result.ok) {
      setError(result.error);
      setStage("failed");
      return;
    }
    setStage("done");
  }

  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const email = String(new FormData(event.currentTarget).get("email")).trim();
    const result = await requestEmailVerification(email);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setResentTo(email);
  }

  if (resentTo) {
    return (
      <div className="auth-form">
        <div className="auth-status is-good">
          <span><MailCheck size={24} /></span>
          <h2>Verification sent</h2>
          <p>
            If an unverified active account exists for {resentTo}, a new verification link is on
            its way. Any earlier link is now inactive.
          </p>
        </div>
        <div className="auth-actions">
          <Link className="button secondary" href="/sign-in">Back to sign in</Link>
        </div>
      </div>
    );
  }

  if (stage === "done") {
    return (
      <div className="auth-form">
        <div className="auth-status is-good">
          <span><CircleCheck size={24} /></span>
          <h2>Email verified</h2>
          <p>Your address is confirmed. You can create a workspace and start inviting people.</p>
        </div>
        <div className="auth-actions">
          <Link className="button primary" href="/">Go to your workspace</Link>
        </div>
      </div>
    );
  }

  // No token, or a token the API rejected as invalid, expired, or already used.
  if (!token || stage === "failed") {
    return (
      <form className="auth-form" onSubmit={resend}>
        <div className="auth-status is-bad">
          <span><TriangleAlert size={24} /></span>
          <h2>{token ? "That link did not work" : "This link is incomplete"}</h2>
          <p>
            {token
              ? "Verification links expire, can only be used once, and are replaced whenever a new one is sent."
              : "It is missing its verification token. Open the link from your email again."}
          </p>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <label>
          Send a new link to
          <div className="field">
            <Mail />
            <input name="email" type="email" placeholder="you@company.com" autoComplete="email" required />
          </div>
        </label>
        <button className="button primary submit" type="submit">Resend verification</button>
        <Link className="auth-back" href="/sign-in">Back to sign in</Link>
      </form>
    );
  }

  return (
    <div className="auth-form">
      <div className="auth-status">
        <span>{stage === "working" ? <LoaderCircle size={24} className="auth-spin" /> : <ShieldCheck size={24} />}</span>
        <h2>Verify your email</h2>
        <p>Confirm this address to finish setting up your Blaze Flow account.</p>
      </div>
      <div className="auth-actions">
        <button className="button primary" type="button" onClick={verify} disabled={stage === "working"}>
          {stage === "working" ? "Verifying…" : "Verify my email"}
        </button>
      </div>
      <Link className="auth-back" href="/sign-in">Back to sign in</Link>
    </div>
  );
}
