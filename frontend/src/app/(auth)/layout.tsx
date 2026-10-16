import Link from "next/link";
import { CheckCircle2, Flame, MessageSquareText, ShieldCheck } from "lucide-react";
import "./auth.css";

/**
 * Split-screen shell for every pre-session page: sign in, sign up, password reset, email
 * verification and invitations. `(auth)` is a route group, so the URLs stay `/sign-in` etc.
 * The brand panel shows from 1024px; below that a compact brand bar sits above the form.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-page">
      <section className="auth-story" aria-label="About Blaze Flow">
        <Link className="auth-brand" href="/">
          <span><Flame aria-hidden /></span>Blaze Flow
        </Link>
        <div className="auth-story-copy">
          <p className="eyebrow">Creative work, in one place</p>
          <h1>From first cut to final approval — without losing the thread.</h1>
          <ul className="auth-points">
            <li><MessageSquareText aria-hidden /><span><b>Frame-accurate feedback</b> clients actually leave.</span></li>
            <li><CheckCircle2 aria-hidden /><span><b>Tasks, files and approvals</b> tied to every version.</span></li>
            <li><ShieldCheck aria-hidden /><span><b>Private by default</b> with roles and client portals.</span></li>
          </ul>
        </div>
        <div className="auth-story-card" aria-hidden>
          <div className="asc-head"><i /><b>Spring campaign · v3</b><em>In review</em></div>
          <div className="asc-frame"><span className="asc-pin" style={{ left: "62%", top: "38%" }}>2</span><span className="asc-pin" style={{ left: "28%", top: "64%" }}>1</span></div>
          <div className="asc-comment"><i>MR</i><p><b>Maya</b> Love the pacing — can we hold the logo 12 frames longer?</p></div>
        </div>
        <small>Built for creative teams and the clients they work with.</small>
      </section>
      <section className="auth-form-wrap">
        <Link className="auth-brand auth-brand-compact" href="/"><span><Flame aria-hidden /></span>Blaze Flow</Link>
        {children}
      </section>
    </main>
  );
}
