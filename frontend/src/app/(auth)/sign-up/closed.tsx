import Link from "next/link";
import { LockKeyhole, Mail } from "@/components/icons";

export function SignupClosed() {
  return (
    <div className="auth-form">
      <div className="auth-status">
        <span><LockKeyhole size={24} aria-hidden /></span>
        <p className="eyebrow">Invite-only</p>
        <h2>Sign-up is by invitation</h2>
        <p>
          Krewsys is currently open to invited teams. If someone has invited you, open the link
          in your invitation email — it lets you create your account.
        </p>
      </div>
      <ul className="auth-steps">
        <li><Mail size={15} aria-hidden /> Look for an email from Krewsys with “invited you to”.</li>
        <li><LockKeyhole size={15} aria-hidden /> Use the same email address the invite was sent to.</li>
      </ul>
      <div className="auth-actions">
        <Link className="button primary" href="/sign-in">I already have an account</Link>
        <Link className="button secondary" href="/sign-up?invited=1">I was invited by email</Link>
      </div>
    </div>
  );
}
