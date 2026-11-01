import { describeErrorBody } from "./errors";
import type { Annotation, ReviewComment } from "./api";
import type { DecisionKind, ReviewDecision } from "./review-decisions";

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

/** `cut`: the review version a single-file link opens on (short links carry no `?cut=`). */
export type GuestSession = { token: string; projectId: string; guestSessionId: string; accessKey: string; name: string; cut?: string | null };
export type GuestMediaVersion = {
  id: string; title: string; version_number: number;
  /** Open notes the client can see on this cut; the approve dialog warns with it. */
  open_notes?: number;
  /** The newest client decision on exactly this cut, if any (`mine` when it was this guest's). */
  decision?: ReviewDecision | null;
  /** The review proxy's state: READY, PENDING, PROCESSING, RETRYING, FAILED… Absent on older backends. */
  preview_status?: string | null;
};
/** `can_read_*`: whether the link may list notes and drawings; absent on older APIs (treated as allowed). */
export type GuestViewer = {
  name: string; can_decide: boolean; can_comment: boolean; expires_at: string | null;
  can_read_comments?: boolean; can_read_annotations?: boolean; scoped_to_file?: boolean;
};

/** A 403 for a permission the link simply lacks: not worth an error banner. */
export const isMissingGuestPermission = (error: string) => /does not grant that permission/i.test(error);
export type GuestReview = {
  project: { id: string; name: string; description: string | null };
  viewer?: GuestViewer;
  media_versions: GuestMediaVersion[];
};
/** A short-lived signed source for the guest player (a `<video>` cannot send headers). */
export type GuestPlayback = {
  url: string; poster_url: string | null; mime_type: string | null; expires_at: string;
  duration_ms: number | null; width: number | null; height: number | null;
};

const STORAGE_PREFIX = "blazeflow_guest:";

/**
 * The access key is kept per invite token, so one person can hold sessions for several
 * projects at once without them overwriting each other.
 *
 * By default it goes to `localStorage` with an expiry, so a reviewer who closes the tab and
 * comes back to the link is still recognised (R12). On a shared or borrowed machine they can
 * untick "Remember me on this device": the key then lives in `sessionStorage` and dies with
 * the tab, because it is a bearer credential. "Not you?" clears both.
 */
export const REMEMBER_DAYS = 30;
type Stored = GuestSession & { expiresAt?: number };

function parse(raw: string | null, now: number): GuestSession | null {
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Stored;
  if (parsed.expiresAt && parsed.expiresAt <= now) return null;
  if (!parsed.accessKey || !parsed.projectId) return null;
  const { expiresAt: _expires, ...session } = parsed;
  void _expires;
  return session;
}

export function readGuestSession(token: string, now: number = Date.now()): GuestSession | null {
  const key = `${STORAGE_PREFIX}${token}`;
  try {
    const fromTab = parse(sessionStorage.getItem(key), now);
    if (fromTab) return fromTab;
  } catch { /* storage disabled */ }
  try {
    const remembered = parse(localStorage.getItem(key), now);
    if (!remembered) localStorage.removeItem(key);
    return remembered;
  } catch {
    // Private mode, disabled storage, or a corrupt entry: treat as not yet identified.
    return null;
  }
}

export function writeGuestSession(session: GuestSession, { remember = true, now = Date.now() }: { remember?: boolean; now?: number } = {}): void {
  const key = `${STORAGE_PREFIX}${session.token}`;
  try {
    if (remember) localStorage.setItem(key, JSON.stringify({ ...session, expiresAt: now + REMEMBER_DAYS * 86_400_000 }));
    else sessionStorage.setItem(key, JSON.stringify(session));
  } catch {
    /* The session still works for this page load; only surviving a reload is lost. */
  }
}

export function clearGuestSession(token: string): void {
  for (const store of [() => sessionStorage, () => localStorage]) {
    try { store().removeItem(`${STORAGE_PREFIX}${token}`); } catch { /* nothing to clear */ }
  }
}

/** Inline check before the exchange: the server checks too, this just says so sooner. */
export function guestEmailProblem(email: string): string | null {
  const value = email.trim();
  if (!value) return "Enter your email so the team knows who left each note.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return "Enter a full email address, like name@studio.com.";
  return null;
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
export async function exchangeGuestInvite(token: string, name: string, email: string): Promise<GuestResult<{ project_id: string; guest_session_id: string; access_key: string; media_version_id?: string | null }>> {
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

/** Where this cut plays from: a signed, time-limited URL for this guest and this cut only. */
export const getGuestPlayback = (projectId: string, versionId: string, key: string) =>
  guestRequest<GuestPlayback>(`/guest/reviews/${projectId}/media-versions/${versionId}/playback/`, key);

/**
 * Approve or Request changes on exactly this cut. A change request carries the message,
 * which the team receives as a client-visible note pinned to `start_time_ms`.
 */
export const createGuestDecision = (
  projectId: string, versionId: string, key: string,
  payload: { decision: DecisionKind; message?: string; start_time_ms?: number; confirm_override?: boolean },
) => guestRequest<ReviewDecision>(`/guest/reviews/${projectId}/media-versions/${versionId}/decision/`, key, jsonInit("POST", payload));
