import { describe, expect, it } from "vitest";
import { expiryLabel, inviteFieldErrors, inviteLink } from "./invites";

describe("invites", () => {
  it("validates inline instead of relying on the browser tooltip", () => {
    expect(inviteFieldErrors("", "r")).toEqual({ email: "Enter the person's email address." });
    expect(inviteFieldErrors("not-an-email", "")).toEqual({ email: "That doesn't look like an email address.", role_id: "Choose a role." });
    expect(inviteFieldErrors("qa-invite+1@blazeflow.test", "r")).toBeNull();
  });
  it("builds the link the email carries", () => {
    expect(inviteLink("a b", "https://app.example.com/")).toBe("https://app.example.com/invite?token=a%20b");
  });
  it("labels expiry", () => {
    const now = new Date("2026-10-20T12:00:00Z");
    expect(expiryLabel("2026-10-27T12:00:00Z", now)).toBe("Expires in 7 days");
    expect(expiryLabel("2026-10-21T06:00:00Z", now)).toBe("Expires tomorrow");
    expect(expiryLabel("2026-10-19T12:00:00Z", now)).toBe("Expired");
  });
});
