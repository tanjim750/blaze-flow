import { describe, expect, it } from "vitest";
import { activityText, deliveryBadges, describeActivity, type ActivityEntry } from "./activity";

const request = (detail: ActivityEntry["detail"]): ActivityEntry => ({
  id: "a1", created_at: "2026-10-19T12:00:00Z", action: "approval_request.sent", category: "notifications",
  actor: { type: "system", id: null, name: "Blaze Flow", initials: "BF", avatar_url: null }, verb: "asked for approval",
  object: { type: "media_version", id: "m1", label: "Hero 30s", href: "/review?media=f1" },
  project: { id: "p1", name: "Spring Launch" }, before: null, after: null, team_only: true, summary: "", detail,
});

describe("approval request rows", () => {
  it("say who was asked about which cut", () => {
    expect(activityText(describeActivity(request({ recipient_name: "Cleo Client", version_number: 2 }))))
      .toBe("Approval request sent to Cleo Client for 'Hero 30s' V2");
  });

  it("show one status per channel, with queued channels as sending", () => {
    const badges = deliveryBadges(request({
      queued_channels: ["EMAIL", "WHATSAPP"],
      deliveries: [{ channel: "EMAIL", status: "SENT", attempts: 1, error: null, sent_at: null, delivered_at: null, read_at: null }],
    }));
    expect(badges.map((badge) => badge.label)).toEqual(["Email sent", "WhatsApp sending"]);
  });

  it("carry the failure reason for the tooltip", () => {
    const [badge] = deliveryBadges(request({
      queued_channels: ["WHATSAPP"],
      deliveries: [{ channel: "WHATSAPP", status: "FAILED", attempts: 2, error: "WhatsApp error 131026", sent_at: null, delivered_at: null, read_at: null }],
    }));
    expect(badge).toMatchObject({ label: "WhatsApp failed", error: "WhatsApp error 131026" });
    expect(deliveryBadges(request({ queued_channels: ["WHATSAPP"], deliveries: [{ channel: "WHATSAPP", status: "READ", attempts: 1, error: null, sent_at: null, delivered_at: null, read_at: null }] }))[0].label).toBe("WhatsApp read");
  });
});
