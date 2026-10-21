import { describe, expect, it } from "vitest";
import { planLabel, planLimitOf } from "./plan-limit";

describe("planLimitOf", () => {
  it("reads the plan and limit from the API refusal", () => {
    expect(planLimitOf("The workspace owner's FREE plan allows up to 3 project(s) per workspace. Upgrade to create another.")).toEqual({ plan: "FREE", limit: 3 });
    expect(planLimitOf("Enter a campaign name.")).toBeNull();
  });

  it("shows the plan in friendly case", () => {
    expect(planLabel("FREE")).toBe("Free");
    expect(planLabel("PRO_TEAM")).toBe("Pro team");
  });
});
