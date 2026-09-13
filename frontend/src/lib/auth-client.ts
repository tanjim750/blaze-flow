import { describeErrorBody } from "./errors";
import type { CurrentUser } from "./api";

/**
 * Browser-side client for the public auth endpoints.
 *
 * These calls run in the browser rather than through a server action for two reasons:
 * login and Google sign-in must receive Django's `Set-Cookie` in a response the browser
 * itself handles, and the rest are pre-session forms where inline validation feedback
 * matters more than a server round trip.
 *
 * Requests use relative `/api/*` paths so the Next rewrite keeps them same-origin, which
 * is what lets the session cookie stick. Every endpoint here is declared
 * `@authentication_classes([])` on the Django side, so none of them needs a CSRF token —
 * unlike `logout` and `password/change`, which are session-authenticated and therefore run
 * server-side through `lib/api`.
 */
export type AuthResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function post<T>(path: string, payload: unknown): Promise<AuthResult<T>> {
  let response: Response;
  try {
    response = await fetch(`/api/auth/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, error: "Cannot reach the Blaze Flow API. Check that it is running." };
  }
  if (!response.ok) {
    return { ok: false, error: describeErrorBody(response.status, await response.text(), response.statusText) };
  }
  if (response.status === 204) return { ok: true, data: undefined as T };
  return { ok: true, data: (await response.json()) as T };
}

/** A successful login also returns the CSRF token; the matching cookie is set by the same response. */
export type SignInResponse = CurrentUser & { csrf_token: string };

export const signIn = (email: string, password: string) =>
  post<SignInResponse>("login/", { email, password });

export const signInWithGoogle = (idToken: string) =>
  post<SignInResponse>("google/", { id_token: idToken });

/**
 * Registers an account. Django does **not** open a session here and it sends a
 * verification email, so the caller signs in separately with the same credentials.
 */
export const signUp = (payload: {
  email: string; password: string; first_name: string; last_name: string; timezone?: string;
}) => post<CurrentUser>("register/", payload);

/** Enumeration-safe: 202 whether or not the address has an account. */
export const requestPasswordReset = (email: string) =>
  post<{ detail: string }>("password-reset/request/", { email });

export const confirmPasswordReset = (token: string, newPassword: string) =>
  post<void>("password-reset/confirm/", { token, new_password: newPassword });

/** Enumeration-safe, like the reset request. */
export const requestEmailVerification = (email: string) =>
  post<{ detail: string }>("email-verification/request/", { email });

export const confirmEmailVerification = (token: string) =>
  post<void>("email-verification/confirm/", { token });

/**
 * The browser's IANA zone, sent at registration so the account starts in the right one.
 * Falls back to undefined when the runtime cannot say, letting the API default apply.
 */
export function browserTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
