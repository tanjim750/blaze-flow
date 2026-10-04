import { describe, expect, it } from "vitest";
import { allowsDecisions, DECISION_PERMISSION, GUEST_PRESETS, invitePermissions } from "./guest-presets";

describe("guest link decisions", () => {
  it("adds the decision permission only when the box is ticked", () => {
    expect(invitePermissions("comment", true)).toContain(DECISION_PERMISSION);
    expect(invitePermissions("comment", false)).not.toContain(DECISION_PERMISSION);
    expect(invitePermissions("comment", false)).toEqual(GUEST_PRESETS.comment.permissions);
  });

  it("never edits the preset itself", () => {
    invitePermissions("comment", true);
    expect(GUEST_PRESETS.comment.permissions).not.toContain(DECISION_PERMISSION);
  });

  it("reads the API flag, falling back to the permission list", () => {
    expect(allowsDecisions({ allow_decisions: false, permissions: [DECISION_PERMISSION] })).toBe(false);
    expect(allowsDecisions({ allow_decisions: true, permissions: [] })).toBe(true);
    expect(allowsDecisions({ permissions: ["media.read", DECISION_PERMISSION] })).toBe(true);
    expect(allowsDecisions({ permissions: ["media.read"] })).toBe(false);
  });
});
