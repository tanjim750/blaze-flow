/**
 * AI Visual QA: types, browser-side API calls and the pure helpers the review panel uses.
 *
 * Browser-only (it reads the CSRF cookie), and free of any `lib/api` runtime import, which
 * pulls in `next/headers`.
 */

export type AiRegion = { x: number; y: number; width: number; height: number };
export type AiTrackPoint = AiRegion & { t: number };
export type AiReviewStatus = "QUEUED" | "PROCESSING" | "SUCCEEDED" | "PARTIAL" | "FAILED" | "CANCELLED";
export type AiFindingStatus = "PENDING" | "ACCEPTED" | "DISMISSED" | "NOT_AN_ERROR" | "COMMENT_CREATED";
export type AiCategory = "POSSIBLE_SPELLING_ERROR" | "OCR_UNCERTAIN";
export type AiBand = "high" | "medium" | "low";

export type AiReview = {
  id: string; media_version_id: string; status: AiReviewStatus; stage: string;
  progress: { kind?: "image" | "video"; frames_total?: number; frames_done?: number; lines?: number; duration_ms?: number };
  language: string; engine: string; engine_version: string;
  error_code: string; error_message: string;
  requested_by: { id: string; name: string } | null;
  summary: { total: number; by_category: Record<string, number>; by_band: Record<string, number>; by_status: Record<string, number> };
  usage: { duration_ms?: number };
  started_at: string | null; completed_at: string | null; created_at: string;
};

export type AiFinding = {
  id: string; category: AiCategory; band: AiBand; detected_text: string; suggested_text: string;
  edited_suggestion: string; context_text: string; explanation: string;
  ocr_confidence: number; decision_confidence: number; region: AiRegion | Record<string, never>;
  start_time_ms: number | null; end_time_ms: number | null; status: AiFindingStatus;
  /** Video: where the word sat in each sighting, in time order. */
  track?: AiTrackPoint[];
  comment_id: string | null; reviewed_at: string | null; created_at: string;
};

export type AiQaState = { supported: boolean; can_run: boolean; engine: string; max_video_seconds?: number; latest: AiReview | null };

export type AiTarget = { workspaceId: string; projectId: string; versionId: string };

const ACTIVE: AiReviewStatus[] = ["QUEUED", "PROCESSING"];
export const isActive = (review: AiReview | null) => Boolean(review && ACTIVE.includes(review.status));

function csrfToken(): string {
  return decodeURIComponent(document.cookie.split("; ").find((item) => item.startsWith("csrftoken="))?.slice(10) ?? "");
}

const base = ({ workspaceId, projectId, versionId }: AiTarget) =>
  `/api/workspaces/${workspaceId}/projects/${projectId}/media-versions/${versionId}`;

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string | null; detail: string };

async function call<T>(url: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  try {
    const unsafe = init.method && init.method !== "GET";
    const response = await fetch(url, {
      ...init, credentials: "include", cache: "no-store",
      headers: { ...(unsafe ? { "Content-Type": "application/json", "X-CSRFToken": csrfToken() } : {}), ...(init.headers ?? {}) },
    });
    const body = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, status: response.status, code: body?.code ?? null, detail: body?.detail ?? `Request failed (${response.status}).` };
    }
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, status: 0, code: null, detail: "Network error. Check your connection and try again." };
  }
}

export const aiQaApi = {
  state: (t: AiTarget) => call<AiQaState>(`${base(t)}/ai-reviews/`),
  start: (t: AiTarget, language: string) => call<AiReview>(`${base(t)}/ai-reviews/`, { method: "POST", body: JSON.stringify({ language }) }),
  review: (t: AiTarget, id: string) => call<AiReview>(`${base(t)}/ai-reviews/${id}/`),
  retry: (t: AiTarget, id: string) => call<AiReview>(`${base(t)}/ai-reviews/${id}/retry/`, { method: "POST", body: "{}" }),
  cancel: (t: AiTarget, id: string) => call<AiReview>(`${base(t)}/ai-reviews/${id}/cancel/`, { method: "POST", body: "{}" }),
  findings: (t: AiTarget, id: string) => call<AiFinding[]>(`${base(t)}/ai-reviews/${id}/findings/?limit=200`),
  decide: (t: AiTarget, id: string, body: { status?: AiFindingStatus; edited_suggestion?: string; add_to_glossary?: "project" | "workspace" }) =>
    call<AiFinding>(`${base(t)}/ai-findings/${id}/`, { method: "PATCH", body: JSON.stringify(body) }),
  comment: (t: AiTarget, id: string) =>
    call<{ finding: AiFinding; comment: { id: string } }>(`${base(t)}/ai-findings/${id}/comment/`, { method: "POST", body: JSON.stringify({ visibility: "team" }) }),
};

/** Poll quickly at first, then back off: 2 s for the first 30 s, 5 s after that. */
export function pollDelay(elapsedMs: number): number {
  return elapsedMs < 30_000 ? 2_000 : 5_000;
}

export type FindingFilter = "open" | "spelling" | "uncertain" | "commented" | "dismissed" | "all";

export const FILTERS: { id: FindingFilter; label: string }[] = [
  { id: "open", label: "To review" },
  { id: "spelling", label: "Spelling" },
  { id: "uncertain", label: "OCR unsure" },
  { id: "commented", label: "Commented" },
  { id: "dismissed", label: "Dismissed" },
  { id: "all", label: "All" },
];

const OPEN: AiFindingStatus[] = ["PENDING", "ACCEPTED"];
const CLOSED: AiFindingStatus[] = ["DISMISSED", "NOT_AN_ERROR"];
const BAND_ORDER: Record<AiBand, number> = { high: 0, medium: 1, low: 2 };

export function matchesFilter(finding: AiFinding, filter: FindingFilter): boolean {
  switch (filter) {
    case "open": return OPEN.includes(finding.status);
    case "spelling": return finding.category === "POSSIBLE_SPELLING_ERROR" && !CLOSED.includes(finding.status);
    case "uncertain": return finding.category === "OCR_UNCERTAIN" && !CLOSED.includes(finding.status);
    case "commented": return finding.status === "COMMENT_CREATED";
    case "dismissed": return CLOSED.includes(finding.status);
    default: return true;
  }
}

/**
 * Video findings in the order they appear; poster findings highest confidence first, then
 * top-to-bottom, left-to-right as they sit on the poster.
 */
export function sortFindings(findings: AiFinding[]): AiFinding[] {
  return [...findings].sort((a, b) =>
    (a.start_time_ms !== null && b.start_time_ms !== null ? a.start_time_ms - b.start_time_ms : 0)
    || BAND_ORDER[a.band] - BAND_ORDER[b.band]
    || (("y" in a.region ? a.region.y : 0) - ("y" in b.region ? b.region.y : 0))
    || (("x" in a.region ? a.region.x : 0) - ("x" in b.region ? b.region.x : 0)));
}

export function filterCounts(findings: AiFinding[]): Record<FindingFilter, number> {
  const counts = { open: 0, spelling: 0, uncertain: 0, commented: 0, dismissed: 0, all: 0 } as Record<FindingFilter, number>;
  for (const finding of findings) for (const { id } of FILTERS) if (matchesFilter(finding, id)) counts[id] += 1;
  return counts;
}

export const BAND_LABEL: Record<AiBand, string> = { high: "High confidence", medium: "Medium", low: "Low" };
export const CATEGORY_LABEL: Record<AiCategory, string> = { POSSIBLE_SPELLING_ERROR: "Possible spelling", OCR_UNCERTAIN: "OCR unsure" };

/** Words, not a falsely precise percentage: OCR confidence is not a calibrated probability. */
export function readability(ocr: number): string {
  if (ocr >= 0.9) return "Text read clearly";
  if (ocr >= 0.75) return "Text mostly clear";
  return "Text hard to read";
}

export function stageLabel(review: AiReview): string {
  if (review.status === "QUEUED") return review.stage === "waiting_for_scan" ? "Waiting for the security scan" : review.stage === "retrying" ? "Retrying…" : "Queued";
  if (review.status === "PROCESSING") {
    switch (review.stage) {
      case "checking": return "Checking spelling";
      case "sampling": return "Sampling frames";
      case "refining": return "Looking closer where text changes";
      default: return "Reading text";
    }
  }
  if (review.status === "FAILED") return "Check failed";
  if (review.status === "PARTIAL") return "Partly checked";
  if (review.status === "CANCELLED") return "Cancelled";
  return "Checked";
}

/** The step index (0–3) for the Queued → Reading → Checking → Done stepper. */
export function stageStep(review: AiReview): number {
  if (review.status === "QUEUED") return 0;
  if (review.status === "PROCESSING") return review.stage === "checking" ? 2 : 1;
  return 3;
}

export function suggestion(finding: AiFinding): string {
  return finding.edited_suggestion || finding.suggested_text;
}

export function hasRegion(region: AiFinding["region"]): region is AiRegion {
  return typeof (region as AiRegion).x === "number" && typeof (region as AiRegion).width === "number";
}

export const batchable = (findings: AiFinding[]) =>
  findings.filter((finding) => finding.band === "high" && OPEN.includes(finding.status) && finding.category === "POSSIBLE_SPELLING_ERROR");

/** A brief sighting still gets a highlight you can see: held at least this long. */
export const MIN_HOLD_MS = 1500;

/** The window a finding's highlight is shown in, the same shape a drawing uses. */
export function findingWindow(finding: Pick<AiFinding, "start_time_ms" | "end_time_ms">): { startMs: number; endMs: number } | null {
  if (finding.start_time_ms === null) return null;
  const end = Math.max(finding.end_time_ms ?? finding.start_time_ms, finding.start_time_ms + MIN_HOLD_MS);
  return { startMs: finding.start_time_ms, endMs: end };
}

/** Where a moving word was nearest to `ms` (its last sighting at or before, else the first). */
export function regionAt(finding: Pick<AiFinding, "region" | "track">, ms: number): AiRegion | null {
  const track = finding.track ?? [];
  if (track.length === 0) return hasRegion(finding.region) ? finding.region : null;
  let point = track[0];
  for (const item of track) { if (item.t <= ms) point = item; else break; }
  return { x: point.x, y: point.y, width: point.width, height: point.height };
}

/** "0:12.4" style, with tenths, for the short spans a title is on screen. */
export function shortTime(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = (total % 60).toFixed(1).padStart(4, "0");
  return `${minutes}:${seconds}`;
}

export function timeRangeLabel(finding: Pick<AiFinding, "start_time_ms" | "end_time_ms">): string | null {
  if (finding.start_time_ms === null) return null;
  const end = finding.end_time_ms ?? finding.start_time_ms;
  return end - finding.start_time_ms < 100 ? shortTime(finding.start_time_ms) : `${shortTime(finding.start_time_ms)}–${shortTime(end)}`;
}

/** "frame 40 of 120" for video, "image 1 of 1" for posters; null before frames are known. */
export function progressLabel(review: AiReview): string | null {
  const { frames_total: total, frames_done: done = 0, kind } = review.progress;
  if (!total) return null;
  return `${kind === "video" ? "frame" : "image"} ${Math.min(done, total)} of ${total}`;
}
