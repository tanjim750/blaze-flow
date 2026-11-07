import { describe, expect, it } from "vitest";
import { onlinePaymentNote, requirementLabel, STRIPE_STATUS } from "./stripe-connect";

describe("stripe-connect helpers", () => {
  it("explains a missing Pay now to managers but stays quiet for clients", () => {
    expect(onlinePaymentNote({ provider: "stripe", available: true, reason: null })).toBeNull();
    expect(onlinePaymentNote({ provider: "stripe", available: false, reason: "not_connected" })).toBeNull();
    expect(onlinePaymentNote({ provider: "stripe", available: false, reason: "not_connected" }, { manager: true })).toMatch(/Connect Stripe/);
    expect(onlinePaymentNote({ provider: "stripe", available: false, reason: "not_configured" }, { manager: true })).toBe("Stripe not configured on this server.");
  });
  it("always shows the unsupported-currency message", () => {
    expect(onlinePaymentNote({ provider: "stripe", available: false, reason: "currency_unsupported", message: "Stripe can’t take payments in KWD." })).toMatch(/KWD/);
  });
  it("labels every status and requirement", () => {
    expect(STRIPE_STATUS.active.tone).toBe("success");
    expect(STRIPE_STATUS.onboarding.label).toBe("Onboarding pending");
    expect(requirementLabel("individual.verification.document")).toBe("verification document");
    expect(requirementLabel("external_account")).toBe("external account");
  });
});
