import { describe, expect, it } from "vitest";
import { upcomingDeadlines } from "./deadlines";

const now = new Date("2026-09-26T09:00:00Z");
const task = (id: string, due_at: string | null) => ({ id, due_at });

describe("upcomingDeadlines", () => {
  it("sorts soonest first and keeps only the next 7 days", () => {
    const rows = upcomingDeadlines([
      task("later", "2026-10-20T12:00:00Z"),
      task("friday", "2026-10-02T12:00:00Z"),
      task("undated", null),
      task("tomorrow", "2026-09-27T12:00:00Z"),
      task("past", "2026-09-25T12:00:00Z"),
      task("today", "2026-09-26T17:00:00Z"),
    ], now);
    expect(rows.map((row) => row.id)).toEqual(["today", "tomorrow", "friday"]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 8 }, (_, index) => task(String(index), `2026-09-2${7 + (index % 3)}T0${index}:00:00Z`));
    expect(upcomingDeadlines(many, now)).toHaveLength(5);
  });
});
