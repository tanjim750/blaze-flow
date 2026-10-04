/**
 * Client portal v2: studio branding, the client's project page and project requests.
 * Types, the pure rules the screens share, and the browser-side calls (through `call`,
 * which carries the CSRF token). The server-side fetchers live in `lib/api.ts`.
 */
import type { CSSProperties } from "react";
import { call } from "./client-uploads";

// ------------------------------------------------------------------- branding

export type Branding = {
  studio_name: string; brand_color: string | null; logo_url: string | null; portal_welcome: string | null;
  /** Only on GET /branding/: whether the viewer may change it. */
  can_edit?: boolean;
};

const HEX = /^#[0-9a-f]{6}$/i;
export const isHexColor = (value: string) => HEX.test(value.trim());

/** Swatches offered next to the colour picker. Our own picks, all readable on the dark UI. */
export const BRAND_SWATCHES = ["#8B6CFF", "#3DB8FF", "#2FCB9A", "#FFB547", "#FF6B8B", "#E8E4DA"];

function channels(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16) / 255) as [number, number, number];
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Text that stays readable on a fill of this colour. */
export const readableOn = (hex: string) => (luminance(hex) > 0.45 ? "#111015" : "#ffffff");

/**
 * CSS variables a portal surface reads: `--portal-accent` (the studio's colour, or our
 * violet), `--portal-accent-ink` (text on it) and a soft tint for backgrounds. A colour
 * too dark to see on the dark UI is lifted to a tint so the accent never disappears.
 */
export function accentStyle(color: string | null | undefined): CSSProperties {
  if (!color || !isHexColor(color)) return {};
  const [r, g, b] = channels(color).map((c) => Math.round(c * 255));
  const tooDark = luminance(color) < 0.04;
  const line = tooDark ? `rgb(${Math.round(r + (255 - r) * 0.45)} ${Math.round(g + (255 - g) * 0.45)} ${Math.round(b + (255 - b) * 0.45)})` : color;
  return {
    "--portal-accent": color, "--portal-accent-line": line, "--portal-accent-ink": readableOn(color),
    "--portal-accent-soft": `rgb(${r} ${g} ${b} / 14%)`,
  } as CSSProperties;
}

/** Up to two letters for the logo tile when there is no logo. */
export function studioMonogram(name: string): string {
  const words = name.replace(/\b(ltd|limited|llc|inc|gmbh|studio|studios)\b\.?/gi, "").trim().split(/\s+/).filter(Boolean);
  const source = words.length ? words : name.trim().split(/\s+/);
  return (source.length > 1 ? source[0][0] + source[1][0] : (source[0] ?? "?").slice(0, 2)).toUpperCase();
}

export const saveBranding = (workspaceId: string, changes: { brand_color?: string | null; portal_welcome?: string | null }) =>
  call<Branding>(`/workspaces/${workspaceId}/branding/`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) });
export function uploadLogo(workspaceId: string, file: File) {
  const body = new FormData();
  body.append("file", file);
  return call<Branding>(`/workspaces/${workspaceId}/branding/logo/`, { method: "POST", body });
}
export const removeLogo = (workspaceId: string) => call<Branding>(`/workspaces/${workspaceId}/branding/logo/`, { method: "DELETE" });

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_ACCEPT = "image/png,image/jpeg,image/webp";

/** Checks a picked logo before it is sent (the server checks the bytes again). */
export function logoProblem(file: Pick<File, "type" | "size">): string | null {
  if (!LOGO_ACCEPT.split(",").includes(file.type)) return "Use a PNG, JPG or WebP logo.";
  if (file.size > LOGO_MAX_BYTES) return "Keep the logo under 2 MB.";
  return null;
}

// ----------------------------------------------------------- project overview

export type PhaseKey = "kickoff" | "production" | "review" | "signoff" | "delivered";
export type Phase = { key: PhaseKey; label: string; state: "done" | "current" | "upcoming" };
export type CutState = "waiting" | "changes" | "approved" | "working";
export type OverviewCut = {
  id: string; title: string; version_number: number; state: CutState; stage_name: string | null; stage_entered_at: string | null;
  downloadable: boolean; download_path: string | null; poster_path: string | null; review_path: string;
  file_name: string; mime_type: string; size_bytes: number; created_at: string;
  last_decision: { decision: "approved" | "changes_requested"; reviewer_name: string; created_at: string } | null;
  /** An older version of a cut that has a newer one; kept for the record only. */
  superseded: boolean;
};
export type OverviewDecision = {
  id: string; decision: "approved" | "changes_requested"; reviewer_name: string; message: string; open_notes_count: number;
  created_at: string; media_version_id: string; title: string; version_number: number;
};
export type TimelineEvent = { kind: "start" | "shared" | "approved" | "changes" | "due"; at: string; title: string; text: string };
export type ProjectOverview = {
  project: {
    id: string; name: string; status: string; description: string; start_at: string | null; due_at: string | null;
    created_at: string; client_team_name: string | null;
  };
  phases: Phase[]; current_phase: PhaseKey; cuts: OverviewCut[]; history: OverviewDecision[]; timeline: TimelineEvent[];
  counts: { cuts: number; waiting: number; approved: number; downloadable: number };
  request: { id: string; created_at: string; requester_name: string } | null;
  media_visible: boolean; branding: Branding;
};

/** One line under the project name: what the client should do or expect next. */
export const PHASE_HINT: Record<PhaseKey, string> = {
  kickoff: "The studio is planning this one. You will see cuts here as soon as they are shared.",
  production: "The studio is working on it. Nothing needs you right now.",
  review: "Something is ready for you. Have a look and approve it or ask for changes.",
  signoff: "You have signed off. The studio is preparing the final files.",
  delivered: "Finished files are ready below.",
};

export const CUT_STATE_LABEL: Record<CutState, string> = {
  waiting: "Ready for you", changes: "Being revised", approved: "Approved", working: "In progress",
};

/** Splits the timeline into what has happened and what is still ahead (the due date). */
export function splitTimeline(events: TimelineEvent[], now: Date): { past: TimelineEvent[]; ahead: TimelineEvent[] } {
  const past: TimelineEvent[] = [];
  const ahead: TimelineEvent[] = [];
  for (const event of events) (new Date(event.at) > now ? ahead : past).push(event);
  return { past: past.reverse(), ahead };
}

/** "in 3 days", "today", "2 days late" for a due date. */
export function dueLabel(iso: string | null, now: Date): string | null {
  if (!iso) return null;
  const day = (value: Date) => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  const days = Math.round((day(new Date(iso)) - day(now)) / 86_400_000);
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  if (days > 1) return `due in ${days} days`;
  return days === -1 ? "1 day past due" : `${-days} days past due`;
}

// ----------------------------------------------------------- project requests

export const DELIVERABLE_OPTIONS = [
  { kind: "hero_film", label: "Hero film", hint: "The main piece, 60–180s" },
  { kind: "social_cutdown", label: "Social cut-down", hint: "Short edits for feeds" },
  { kind: "product_video", label: "Product video", hint: "Show it in use" },
  { kind: "ad_spot", label: "Ad spot", hint: "15s or 30s paid media" },
  { kind: "event_recap", label: "Event recap", hint: "Highlights from the day" },
  { kind: "motion_graphics", label: "Motion graphics", hint: "Animated titles, explainers" },
  { kind: "photo_set", label: "Photo set", hint: "Stills from the shoot" },
  { kind: "other", label: "Something else", hint: "Tell us in the brief" },
] as const;
export type DeliverableKind = (typeof DELIVERABLE_OPTIONS)[number]["kind"];
export const PLATFORM_OPTIONS = ["YouTube", "Instagram", "TikTok", "TV", "Other"] as const;
export const ASPECT_OPTIONS = ["16:9", "9:16", "1:1", "4:5"] as const;
export const BUDGET_OPTIONS = [
  { value: "under_2k", label: "Under 2k" }, { value: "2k_5k", label: "2k–5k" }, { value: "5k_10k", label: "5k–10k" },
  { value: "10k_plus", label: "10k+" }, { value: "not_sure", label: "Not sure yet" },
] as const;
export const LENGTH_OPTIONS = [
  { value: 15, label: "15s" }, { value: 30, label: "30s" }, { value: 60, label: "60s" }, { value: 120, label: "2 min" }, { value: 300, label: "5 min+" },
];

export type RequestStatus = "pending" | "accepted" | "declined" | "withdrawn";
export type ProjectRequest = {
  id: string; title: string; status: RequestStatus; client_team: { id: string; name: string }; requester_name: string;
  requester_email?: string; deliverables: { kind: DeliverableKind; quantity: number }[];
  platform: string | null; aspect_ratio: string | null; target_length_seconds: number | null; brief: string; references: string;
  wanted_by: string | null; budget_range: string | null; decision_note: string; decided_at: string | null;
  decided_by_name: string | null; project_id: string | null; created_at: string; updated_at: string;
};
export type ProjectRequestList = {
  viewer: "team" | "client"; can_request: boolean; client_teams: { id: string; name: string }[];
  pending_count: number | null; requests: ProjectRequest[];
};
export type ProjectRequestInput = {
  client_team_id?: string; title: string; deliverables: { kind: DeliverableKind; quantity: number }[];
  platform?: string | null; aspect_ratio?: string | null; target_length_seconds?: number | null; brief: string;
  references?: string; wanted_by?: string | null; budget_range?: string;
};

export const REQUEST_STATUS: Record<RequestStatus, { label: string; tone: "warning" | "success" | "danger" | "neutral" }> = {
  pending: { label: "With the studio", tone: "warning" },
  accepted: { label: "Accepted", tone: "success" },
  declined: { label: "Declined", tone: "danger" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
};

const deliverableLabel = (kind: string) => DELIVERABLE_OPTIONS.find((option) => option.kind === kind)?.label ?? kind;

/** "1 Hero film + 4 Social cut-downs". */
export function deliverablesSummary(items: { kind: string; quantity: number }[]): string {
  return items.map(({ kind, quantity }) => {
    const label = deliverableLabel(kind);
    return quantity > 1 ? `${quantity} ${label.endsWith("s") ? label : `${label}s`}` : `1 ${label}`;
  }).join(" + ");
}

export const budgetLabel = (value: string | null) => BUDGET_OPTIONS.find((option) => option.value === value)?.label ?? null;

/** Client-side checks that match the server's; returns field → message. */
export function requestProblems(input: ProjectRequestInput, today: string): Partial<Record<"title" | "deliverables" | "brief" | "wanted_by", string>> {
  const problems: Partial<Record<"title" | "deliverables" | "brief" | "wanted_by", string>> = {};
  if (!input.title.trim()) problems.title = "Give the project a working title.";
  if (!input.deliverables.length) problems.deliverables = "Pick at least one thing you would like made.";
  if (input.brief.trim().length < 20) problems.brief = "Tell the studio a little more (at least a sentence or two).";
  if (input.wanted_by && input.wanted_by < today) problems.wanted_by = "Pick a date from today on.";
  return problems;
}

export const submitProjectRequest = (workspaceId: string, input: ProjectRequestInput) =>
  call<ProjectRequest>(`/workspaces/${workspaceId}/project-requests/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
export const answerProjectRequest = (workspaceId: string, requestId: string, body: { action: "accept" | "decline" | "withdraw"; note?: string; name?: string }) =>
  call<ProjectRequest>(`/workspaces/${workspaceId}/project-requests/${requestId}/`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "14 Oct" (with the year when it is not this year). Dates without a time read as that day. */
export function dayDate(iso: string, now = new Date()): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : new Date(iso);
  if (Number.isNaN(date.getTime())) return "?";
  const base = `${date.getDate()} ${MONTH_NAMES[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear() ? base : `${base} ${date.getFullYear()}`;
}
