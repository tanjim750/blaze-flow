import { describe, expect, it } from "vitest";
import { overrideWarning, type ReviewDecision } from "./review-decisions";

const decision = (kind: ReviewDecision["decision"]) => ({ id: "d1", media_version_id: "mv", version_number: 9, decision: kind, reviewer: { name: "Cleo", type: "guest" }, created_at: "2026-10-20T09:00:00Z" }) as unknown as ReviewDecision;

describe("overrideWarning", () => {
  it("is silent with no decision or the same decision", () => {
    expect(overrideWarning(null, "approved")).toBeNull();
    expect(overrideWarning(decision("approved"), "approved")).toBeNull();
  });
  it("names who decided what before a reversal", () => {
    const now = new Date("2026-10-21T09:00:00Z");
    expect(overrideWarning(decision("approved"), "changes_requested", now, "Europe/London")).toMatch(/^Cleo .*V9.*Requesting changes reopens it\.$/);
    expect(overrideWarning(decision("changes_requested"), "approved", now, "Europe/London")).toMatch(/Approving replaces that request\.$/);
  });
});
