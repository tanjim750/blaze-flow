import { describe, expect, it } from "vitest";
import { formatQueueTime } from "./queue-time";

describe("formatQueueTime", () => {
  it("formats in the workspace zone with en-GB 24h text", () => {
    expect(formatQueueTime("2026-10-19T23:46:53Z", "Europe/London")).toBe("Tue 20 Oct, 00:46");
  });
  it("does not depend on the environment's zone", () => {
    expect(formatQueueTime("2026-10-19T23:46:53Z", "America/New_York")).toBe("Mon 19 Oct, 19:46");
  });
});
