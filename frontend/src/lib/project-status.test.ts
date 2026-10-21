import { describe, expect, it } from "vitest";
import { isProjectStatus, statusLabel } from "./project-status";

describe("project status", () => {
  it("labels statuses and only lets people pick the open ones", () => {
    expect(statusLabel("ON_HOLD")).toBe("On hold");
    expect(statusLabel(null)).toBe("Draft");
    expect(isProjectStatus("COMPLETED")).toBe(true);
    expect(isProjectStatus("ARCHIVED")).toBe(false);
    expect(isProjectStatus("PENDING_DELETION")).toBe(false);
  });
});
