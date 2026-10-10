import { ResetPasswordForm } from "./form";

/**
 * Target of the link in a password-reset email. Django builds it as
 * `PASSWORD_RESET_URL?token=…` (`app/services/passwords.py`), so the token is read here on
 * the server and handed to the form rather than being pulled from the URL in the browser.
 */
export default async function ResetPassword({ searchParams }: PageProps<"/reset-password">) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  return <ResetPasswordForm token={token} />;
}
