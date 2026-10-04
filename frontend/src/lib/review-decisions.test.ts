import { describe, expect, it } from "vitest";
import {
  changeMessageProblem, decisionDay, decisionLine, guestBarActions, latestFor, NO_DECISIONS,
  openNotesWarning, proofDetail, proofLine, reviewBarActions, type ReviewDecision,
} from "./review-decisions";

const TZ = "Europe/London";
const NOW = new Date("2026-10-03T20:00:00Z");

const decision = (overrides: Partial<ReviewDecision> = {}): ReviewDecision => ({
  id: "d1", media_version_id: "v2", version_number: 2, decision: "approved",
  reviewer: { name: "Rachel Kim", type: "guest" }, open_notes_count: 0, message: null,
  review_comment_id: null, workflow_transitioned: true, created_at: "2026-10-03T10:00:00Z",
  ...overrides,
});

describe("decision wording", () => {
  it("dates a decision in the given zone, adding the year only when it differs", () => {
    expect(decisionDay("2026-10-03T10:00:00Z", NOW, TZ)).toBe("3 Oct");
    // 23:30 UTC on the 2nd is already the 3rd in London (BST).
    expect(decisionDay("2026-10-02T23:30:00Z", NOW, TZ)).toBe("3 Oct");
    expect(decisionDay("2025-12-24T12:00:00Z", NOW, TZ)).toBe("24 Dec 2025");
    expect(decisionDay("not a date", NOW, TZ)).toBe("");
  });

  it("tells the guest what they decided, on which version", () => {
    expect(decisionLine(decision({ mine: true }), NOW, TZ)).toBe("You approved V2 on 3 Oct");
    expect(decisionLine(decision({ mine: false }), NOW, TZ)).toBe("Rachel Kim approved V2 on 3 Oct");
    expect(decisionLine(decision({ mine: true, decision: "changes_requested", version_number: 3 }), NOW, TZ))
      .toBe("You requested changes on V3 on 3 Oct");
  });

  it("gives the team a proof-of-delivery line", () => {
    expect(proofLine(decision(), NOW, TZ)).toBe("Approved by client · Rachel Kim · V2 · 3 Oct");
    expect(proofLine(decision({ decision: "changes_requested" }), NOW, TZ)).toBe("Changes requested by client · Rachel Kim · V2 · 3 Oct");
  });

  it("explains how the decision was made and what was still open", () => {
    expect(proofDetail(decision({ link_label: "Spring review", reviewer: { name: "Rachel Kim", type: "guest", email: "rachel@client.example" } })))
      .toBe("via review link “Spring review” · rachel@client.example · no open notes");
    expect(proofDetail(decision({ open_notes_count: 2 }))).toBe("via a review link · 2 open notes at sign-off");
    expect(proofDetail(decision({ open_notes_count: 1, reviewer: { name: "Sam", type: "client_member" } })))
      .toBe("signed in as a client-team member · 1 open note at sign-off");
    // Open-notes count only matters for a sign-off.
    expect(proofDetail(decision({ decision: "changes_requested", open_notes_count: 4 }))).toBe("via a review link");
  });
});

describe("latestFor", () => {
  it("only counts decisions on exactly that version", () => {
    const v2 = decision({ id: "a", media_version_id: "v2", created_at: "2026-10-03T10:00:00Z" });
    const v2later = decision({ id: "b", media_version_id: "v2", decision: "changes_requested", created_at: "2026-10-03T11:00:00Z" });
    const v3 = decision({ id: "c", media_version_id: "v3", created_at: "2026-10-03T12:00:00Z" });
    expect(latestFor([v2, v2later, v3], "v2")?.id).toBe("b");
    // A newer version does not inherit V2's approval.
    expect(latestFor([v2], "v3")).toBeNull();
    expect(latestFor([v2], null)).toBeNull();
  });
});

describe("approve and request-changes rules", () => {
  it("warns about open client-visible notes", () => {
    expect(openNotesWarning(0, "V2")).toBeNull();
    expect(openNotesWarning(1, "V2")).toBe("1 note is still open on V2. Approving won’t resolve it.");
    expect(openNotesWarning(3, "V3")).toBe("3 notes are still open on V3. Approving won’t resolve them.");
  });

  it("requires a short message for a change request", () => {
    expect(changeMessageProblem("   ")).toBe("Tell the team what to change.");
    expect(changeMessageProblem("x".repeat(2001))).toBe("Keep it under 2000 characters.");
    expect(changeMessageProblem("Trim the sting")).toBeNull();
  });
});

describe("reviewBarActions", () => {
  const state = { hasTarget: true, approved: false, hasApprovalStage: true };

  it("offers nothing until the API answers, and nothing on an unpublished cut", () => {
    expect(reviewBarActions(NO_DECISIONS, state)).toEqual({ approve: null, requestChanges: null });
    expect(reviewBarActions({ ...NO_DECISIONS, can_transition: true, can_request_changes: true }, { ...state, hasTarget: false }))
      .toEqual({ approve: null, requestChanges: null });
  });

  it("lets team members move the cut through the workflow", () => {
    const team = { kind: "team" as const, can_transition: true, can_request_changes: true, can_decide: false };
    expect(reviewBarActions(team, state)).toEqual({ approve: "team", requestChanges: "team" });
    expect(reviewBarActions(team, { ...state, approved: true })).toEqual({ approve: null, requestChanges: "team" });
    expect(reviewBarActions(team, { ...state, hasApprovalStage: false })).toEqual({ approve: null, requestChanges: "team" });
  });

  it("lets client members decide only when their role allows it", () => {
    const reader = { kind: "client" as const, can_transition: false, can_request_changes: false, can_decide: false };
    expect(reviewBarActions(reader, state)).toEqual({ approve: null, requestChanges: null });
    const decider = { ...reader, can_decide: true };
    expect(reviewBarActions(decider, state)).toEqual({ approve: "client", requestChanges: "client" });
    expect(reviewBarActions(decider, { ...state, approved: true })).toEqual({ approve: null, requestChanges: "client" });
  });
});

describe("guestBarActions", () => {
  it("hides both buttons when the link does not allow decisions", () => {
    expect(guestBarActions(false, null)).toEqual({ approve: false, requestChanges: false });
  });

  it("hides Approve once this version is approved, but keeps Request changes", () => {
    expect(guestBarActions(true, null)).toEqual({ approve: true, requestChanges: true });
    expect(guestBarActions(true, decision())).toEqual({ approve: false, requestChanges: true });
    expect(guestBarActions(true, decision({ decision: "changes_requested" }))).toEqual({ approve: true, requestChanges: true });
  });
});
