import { describe, expect, it } from "vitest";
import { isOverdue, toDateTimeLocal } from "./task-dates";

describe("toDateTimeLocal", () => {
  it("round-trips through the datetime-local parser without shifting", () => {
    const due = "2026-09-30T16:00:00Z";
    expect(new Date(toDateTimeLocal(due)).toISOString()).toBe("2026-09-30T16:00:00.000Z");
  });

  it("is empty for a missing or invalid date", () => {
    expect(toDateTimeLocal(null)).toBe("");
    expect(toDateTimeLocal("not a date")).toBe("");
  });
});

describe("isOverdue", () => {
  const now = Date.parse("2026-09-26T12:00:00Z");
  it("flags a past due date on open work", () => {
    expect(isOverdue("2026-09-20T12:00:00Z", false, now)).toBe(true);
  });
  it("never flags work in a done stage", () => {
    expect(isOverdue("2026-09-20T12:00:00Z", true, now)).toBe(false);
  });
  it("ignores future and missing dates", () => {
    expect(isOverdue("2026-10-01T12:00:00Z", false, now)).toBe(false);
    expect(isOverdue(null, false, now)).toBe(false);
  });
});
