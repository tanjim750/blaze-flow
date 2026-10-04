/**
 * Client decisions on one exact cut — the wording and the rules the review pages share.
 *
 * Pure functions over what the API returns, so the guest page, the signed-in review page
 * and the share panel all say the same thing ("You approved V2 on 3 Oct", "Approved by
 * client · Rachel Kim · V2 · 3 Oct") and are tested once.
 */

export type DecisionKind = "approved" | "changes_requested";

/** One `ReviewDecision` as the API returns it. Email and link label are team-only. */
export type ReviewDecision = {
  id: string;
  media_version_id: string;
  version_number: number;
  decision: DecisionKind;
  reviewer: { name: string; type: "guest" | "client_member"; email?: string };
  open_notes_count: number;
  message: string | null;
  review_comment_id: string | null;
  workflow_transitioned: boolean;
  created_at: string;
  /** Guest routes only: whether this guest made it. */
  mine?: boolean;
  guest_invite_id?: string | null;
  link_label?: string | null;
};

/** What the signed-in review bar may offer, from `GET …/decisions/`. */
export type DecisionViewer = {
  kind: "team" | "client";
  can_transition: boolean;
  can_request_changes: boolean;
  can_decide: boolean;
};

/** No buttons until the API says otherwise: a missing answer never offers a dead end. */
export const NO_DECISIONS: DecisionViewer = { kind: "team", can_transition: false, can_request_changes: false, can_decide: false };

export const MESSAGE_MAX_LENGTH = 2000;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "3 Oct" (or "3 Oct 2025" outside the current year), in the given time zone.
 *
 * The zone is explicit so the server render and the browser agree; the review pages pass
 * the viewer's own zone once they are in the browser.
 */
export function decisionDay(iso: string, now: Date = new Date(), timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "numeric", year: "numeric" }).formatToParts(date);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const base = `${pick("day")} ${MONTHS[pick("month") - 1]}`;
  return pick("year") === now.getFullYear() ? base : `${base} ${pick("year")}`;
}

const verbOf = (kind: DecisionKind) => (kind === "approved" ? "approved" : "requested changes on");

/** The guest's own state line: "You approved V2 on 3 Oct" or "Rachel Kim approved V2 on 3 Oct". */
export function decisionLine(decision: ReviewDecision, now: Date = new Date(), timeZone?: string): string {
  const who = decision.mine ? "You" : decision.reviewer.name || "A reviewer";
  return `${who} ${verbOf(decision.decision)} V${decision.version_number} on ${decisionDay(decision.created_at, now, timeZone)}`;
}

/** The team's proof-of-delivery record: "Approved by client · Rachel Kim · V2 · 3 Oct". */
export function proofLine(decision: ReviewDecision, now: Date = new Date(), timeZone?: string): string {
  const head = decision.decision === "approved" ? "Approved by client" : "Changes requested by client";
  return [head, decision.reviewer.name || "Client", `V${decision.version_number}`, decisionDay(decision.created_at, now, timeZone)].join(" · ");
}

/** The detail under the proof line: how it was made and what was still open. */
export function proofDetail(decision: ReviewDecision): string {
  const parts: string[] = [];
  if (decision.reviewer.type === "guest") parts.push(decision.link_label ? `via review link “${decision.link_label}”` : "via a review link");
  else parts.push("signed in as a client-team member");
  if (decision.reviewer.email) parts.push(decision.reviewer.email);
  if (decision.decision === "approved") {
    parts.push(decision.open_notes_count === 0 ? "no open notes" : `${decision.open_notes_count} open ${decision.open_notes_count === 1 ? "note" : "notes"} at sign-off`);
  }
  return parts.join(" · ");
}

/** The newest decision on one cut. A decision on another version never counts. */
export function latestFor(decisions: ReviewDecision[], mediaVersionId: string | null | undefined): ReviewDecision | null {
  if (!mediaVersionId) return null;
  return decisions
    .filter((item) => item.media_version_id === mediaVersionId)
    .reduce<ReviewDecision | null>((latest, item) => (!latest || item.created_at > latest.created_at ? item : latest), null);
}

/** The approve dialog's warning about notes the client can see that are still open. */
export function openNotesWarning(count: number, versionLabel: string): string | null {
  if (count <= 0) return null;
  return `${count === 1 ? "1 note is" : `${count} notes are`} still open on ${versionLabel}. Approving won’t resolve ${count === 1 ? "it" : "them"}.`;
}

/** A change request must say what to change. Returns the problem, or null when it is fine. */
export function changeMessageProblem(text: string): string | null {
  const body = text.trim();
  if (!body) return "Tell the team what to change.";
  if (body.length > MESSAGE_MAX_LENGTH) return `Keep it under ${MESSAGE_MAX_LENGTH} characters.`;
  return null;
}

export type ReviewBarActions = {
  /** Who the Approve button acts as, or null to hide it. */
  approve: "team" | "client" | null;
  requestChanges: "team" | "client" | null;
};

/**
 * Which decision buttons the signed-in review bar shows.
 *
 * Team members approve through the workflow (and need `media.transition`); client-team
 * members decide as the client (and need a role that allows decisions). A cut with no
 * project record has nothing to decide on, and Approve hides once the cut is approved —
 * Request changes stays, because it reopens.
 */
export function reviewBarActions(viewer: DecisionViewer, state: { hasTarget: boolean; approved: boolean; hasApprovalStage: boolean }): ReviewBarActions {
  if (!state.hasTarget) return { approve: null, requestChanges: null };
  if (viewer.kind === "client") {
    const role = viewer.can_decide ? "client" : null;
    return { approve: state.approved ? null : role, requestChanges: role };
  }
  return {
    approve: viewer.can_transition && state.hasApprovalStage && !state.approved ? "team" : null,
    requestChanges: viewer.can_request_changes ? "team" : null,
  };
}

/** Guest-side: which buttons the decision bar shows for the cut on screen. */
export function guestBarActions(canDecide: boolean, latest: ReviewDecision | null): { approve: boolean; requestChanges: boolean } {
  if (!canDecide) return { approve: false, requestChanges: false };
  return { approve: latest?.decision !== "approved", requestChanges: true };
}
