import { describeErrorBody } from "./errors";
import type { Annotation, ReviewComment } from "./api";

/**
 * Browser-side client for the public guest-review endpoints.
 *
 * Guests have no Django session. Every call authenticates with the opaque access key
 * returned once by `guest-access/exchange/`, sent as `X-Guest-Access-Key`. That is why
 * this client runs in the browser rather than through `lib/api`: a server component has
 * no way to hold a key that never becomes a cookie.
 *
 * Requests use relative `/api/*` paths so the Next rewrite reaches Django same-origin.
 * Every endpoint here is `@authentication_classes([])` on the Django side, so none needs
 * a CSRF token.
 */
export type GuestResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type GuestSession = { token: string; projectId: string; guestSessionId: string; accessKey: string; name: string };
export type GuestMediaVersion = { id: string; title: string; version_number: number };
export type GuestReview = {
  project: { id: string; name: string; description: string | null };
  media_versions: GuestMediaVersion[];
};

const STORAGE_PREFIX = "blazeflow_guest:";

/**
 * The access key lives in `sessionStorage`, keyed by the invite token.
 *
 * `sessionStorage` rather than `localStorage` because a review link is frequently opened
 * on a shared or borrowed machine, and the key is a bearer credential — it should not
 * outlive the tab. Keying by token means one person can hold sessions for several
 * projects at once without them overwriting each other.
 */
export function readGuestSession(token: string): GuestSession | null {
  try {
    const raw = sessionStorage.getItem(`${STORAGE_PREFIX}${token}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GuestSession;
    return parsed.accessKey && parsed.projectId ? parsed : null;
  } catch {
    // Private mode, disabled storage, or a corrupt entry: treat as not yet identified.
    return null;
  }
}

export function writeGuestSession(session: GuestSession): void {
  try {
    sessionStorage.setItem(`${STORAGE_PREFIX}${session.token}`, JSON.stringify(session));
  } catch {
    /* The session still works for this page load; only the refresh survival is lost. */
  }
}

export function clearGuestSession(token: string): void {
  try {
    sessionStorage.removeItem(`${STORAGE_PREFIX}${token}`);
  } catch {
    /* Nothing to clear if storage is unavailable. */
  }
}

async function guestRequest<T>(path: string, accessKey: string, init?: RequestInit): Promise<GuestResult<T>> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: { Accept: "application/json", "X-Guest-Access-Key": accessKey, ...(init?.headers ?? {}) },
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "Cannot reach the review server. Check your connection and try again." };
  }
  if (!response.ok) {
    return { ok: false, error: describeErrorBody(response.status, await response.text(), response.statusText) };
  }
  if (response.status === 204) return { ok: true, data: undefined as T };
  return { ok: true, data: (await response.json()) as T };
}

const jsonInit = (method: string, payload: unknown): RequestInit => ({
  method,
  body: JSON.stringify(payload),
  headers: { "Content-Type": "application/json" },
});

/**
 * Redeems an invite token for an access key.
 *
 * The token is single-purpose but not single-use — several reviewers can redeem the same
 * link, and each gets a distinct guest session. The key is returned exactly once, so the
 * caller must persist it before navigating.
 */
export async function exchangeGuestInvite(token: string, name: string, email: string): Promise<GuestResult<{ project_id: string; guest_session_id: string; access_key: string }>> {
  let response: Response;
  try {
    response = await fetch("/api/guest-access/exchange/", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ token, name, email }),
    });
  } catch {
    return { ok: false, error: "Cannot reach the review server. Check your connection and try again." };
  }
  if (!response.ok) {
    return { ok: false, error: describeErrorBody(response.status, await response.text(), response.statusText) };
  }
  return { ok: true, data: await response.json() };
}

export const loadGuestReview = (projectId: string, key: string) =>
  guestRequest<GuestReview>(`/guest/reviews/${projectId}/`, key);

export const listGuestComments = (projectId: string, versionId: string, key: string) =>
  guestRequest<ReviewComment[]>(`/guest/reviews/${projectId}/media-versions/${versionId}/comments/?limit=200`, key);

/** The backend rejects timing on a reply, so a reply never sends `start_time_ms`. */
export const createGuestComment = (
  projectId: string, versionId: string, key: string,
  payload: { text: string; parent_comment_id?: string; start_time_ms?: number },
) => guestRequest<ReviewComment>(`/guest/reviews/${projectId}/media-versions/${versionId}/comments/`, key, jsonInit("POST", payload));

export const editGuestComment = (projectId: string, versionId: string, key: string, commentId: string, text: string) =>
  guestRequest<ReviewComment>(`/guest/reviews/${projectId}/media-versions/${versionId}/comments/${commentId}/`, key, jsonInit("PATCH", { text }));

export const deleteGuestComment = (projectId: string, versionId: string, key: string, commentId: string) =>
  guestRequest<void>(`/guest/reviews/${projectId}/media-versions/${versionId}/comments/${commentId}/`, key, { method: "DELETE" });

export const setGuestReaction = (projectId: string, versionId: string, key: string, commentId: string, emoji: string, remove = false) =>
  guestRequest<ReviewComment | void>(
    `/guest/reviews/${projectId}/media-versions/${versionId}/comments/${commentId}/reactions/`,
    key,
    jsonInit(remove ? "DELETE" : "POST", { emoji }),
  );

export const listGuestAnnotations = (projectId: string, versionId: string, key: string) =>
  guestRequest<Annotation[]>(`/guest/reviews/${projectId}/media-versions/${versionId}/annotations/?limit=200`, key);

/**
 * Attaches a file to one of the guest's own comments.
 *
 * Sent as multipart with no `Content-Type` header, so the browser supplies the boundary.
 */
export function uploadGuestAttachment(projectId: string, versionId: string, key: string, commentId: string, file: File) {
  const body = new FormData();
  body.append("file", file);
  return guestRequest<{ id: string }>(
    `/guest/reviews/${projectId}/media-versions/${versionId}/comments/${commentId}/attachments/`,
    key,
    { method: "POST", body },
  );
}

/**
 * Attachment downloads are permission-checked by header, which a plain `<a href>` cannot
 * send, so the caller fetches the bytes and hands the browser an object URL instead.
 */
export async function downloadGuestAttachment(projectId: string, contentId: string, key: string, filename: string): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch(`/api/guest/reviews/${projectId}/attachments/${contentId}/`, {
      headers: { "X-Guest-Access-Key": key },
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  return url;
}
