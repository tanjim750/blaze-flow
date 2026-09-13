import { VerifyEmailPanel } from "./panel";

/**
 * Target of the link in a verification email, built by Django as
 * `EMAIL_VERIFICATION_URL?token=…` (`app/services/email_verification.py`).
 */
export default async function VerifyEmail({ searchParams }: PageProps<"/verify-email">) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  return <VerifyEmailPanel token={token} />;
}
