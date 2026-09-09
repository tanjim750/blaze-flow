import Link from "next/link";
import { Flame } from "lucide-react";
import "./auth.css";

/**
 * Split-screen shell for every pre-session page: sign in, sign up, password reset, and
 * email verification.
 *
 * `(auth)` is a route group, so it adds no path segment — these pages stay at `/sign-in`,
 * `/sign-up`, and so on. The story panel is hidden below 850px in globals.css, leaving the
 * form full width on a phone.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-page">
      <section className="auth-story">
        <Link className="auth-brand" href="/">
          <span><Flame /></span>Blaze Flow
        </Link>
        <div>
          <p className="eyebrow">Creative work, in one place</p>
          <h1>Move from first draft to final approval with clarity.</h1>
          <p>Manage projects, feedback, files and delivery without losing the thread.</p>
        </div>
        <small>Built for creative teams and their clients.</small>
      </section>
      <section className="auth-form-wrap">{children}</section>
    </main>
  );
}
