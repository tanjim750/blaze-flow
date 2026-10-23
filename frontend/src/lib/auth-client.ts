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
export type AuthFailure = {
  ok: false;
  /** One readable sentence for the form-level alert. */
  error: string;
  /** Per-field messages from DRF validation, keyed by field name. */
  fieldErrors?: Record<string, string>;
  /** Machine code from the API, e.g. `signup_closed`. */
  code?: string;
  status?: number;
};
export type AuthResult<T> = { ok: true; data: T } | AuthFailure;

/** Splits a DRF error body into per-field messages; `detail`/`non_field_errors` stay form-level. */
export function parseFieldErrors(body: string): { fieldErrors: Record<string, string>; code?: string } {
  const fieldErrors: Record<string, string> = {};
  let code: string | undefined;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (key === "code" && typeof value === "string") { code = value; continue; }
        if (key === "detail" || key === "non_field_errors") continue;
        const text = Array.isArray(value) ? value.map(String).join(" ") : typeof value === "string" ? value : "";
        if (text) fieldErrors[key] = text;
      }
    }
  } catch { /* not JSON */ }
  return { fieldErrors, code };
}

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
    const text = await response.text();
    const { fieldErrors, code } = parseFieldErrors(text);
    const error = response.status === 429
      ? "Too many attempts. Please wait a few minutes and try again."
      : describeErrorBody(response.status, text, response.statusText);
    return { ok: false, error, fieldErrors, code, status: response.status };
  }
  if (response.status === 204) return { ok: true, data: undefined as T };
  return { ok: true, data: (await response.json()) as T };
}

/** A successful login also returns the CSRF token; the matching cookie is set by the same response. */
export type SignInResponse = CurrentUser & { csrf_token: string };

export const signIn = (email: string, password: string) =>
  post<SignInResponse>("login/", { email, password });

export const signInWithGoogle = (idToken: string, inviteToken?: string) =>
  post<SignInResponse>("google/", { id_token: idToken, ...(inviteToken ? { invite_token: inviteToken } : {}) });

/**
 * Registers an account. Django does **not** open a session here and it sends a
 * verification email, so the caller signs in separately with the same credentials.
 */
export const signUp = (payload: {
  email: string; password: string; first_name: string; last_name: string; timezone?: string; invite_token?: string;
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

export type SignupMode = "open" | "invite_only";

export type InvitePreview = {
  kind: "workspace" | "client_team";
  state: "valid" | "expired" | "accepted";
  workspace_name: string;
  role_name: string | null;
  email: string | null;
  inviter_name: string | null;
  expires_at: string;
};

/**
 * Only same-origin relative paths are honoured for `?next=`, so a crafted link cannot
 * bounce someone to another site after signing in.
 */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
