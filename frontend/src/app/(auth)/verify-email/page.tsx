import { VerifyEmailPanel } from "./panel";

/**
 * Target of the link in a verification email, built by Django as
 * `EMAIL_VERIFICATION_URL?token=…` (`app/services/email_verification.py`). Without a token
 * and with `?sent=1&email=…` it is the "check your inbox" screen shown after sign-up.
 */
export default async function VerifyEmail({ searchParams }: PageProps<"/verify-email">) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  const email = typeof params.email === "string" ? params.email : "";
  return <VerifyEmailPanel token={token} sent={params.sent === "1"} email={email} />;
}
