import { describe, expect, it } from "vitest";
import {
  accentStyle, dayDate, deliverablesSummary, dueLabel, isHexColor, logoProblem, readableOn, requestProblems, splitTimeline,
  studioMonogram, type ProjectRequestInput, type TimelineEvent,
} from "./portal";

describe("branding helpers", () => {
  it("accepts only #RRGGBB", () => {
    expect(isHexColor("#7c5cff")).toBe(true);
    expect(isHexColor("7c5cff")).toBe(false);
    expect(isHexColor("#fff")).toBe(false);
    expect(isHexColor("red")).toBe(false);
  });

  it("picks readable ink for light and dark accents", () => {
    expect(readableOn("#FFFFFF")).toBe("#111015");
    expect(readableOn("#E8E4DA")).toBe("#111015");
    expect(readableOn("#5B3DF5")).toBe("#ffffff");
  });

  it("returns no variables without a valid colour, and lifts a near-black line", () => {
    expect(accentStyle(null)).toEqual({});
    expect(accentStyle("nope")).toEqual({});
    const style = accentStyle("#2FCB9A") as Record<string, string>;
    expect(style["--portal-accent"]).toBe("#2FCB9A");
    expect(style["--portal-accent-line"]).toBe("#2FCB9A");
    expect(style["--portal-accent-soft"]).toBe("rgb(47 203 154 / 14%)");
    const dark = accentStyle("#050505") as Record<string, string>;
    expect(dark["--portal-accent-line"]).not.toBe("#050505");
    expect(dark["--portal-accent-ink"]).toBe("#ffffff");
  });

  it("builds a monogram without company suffixes", () => {
    expect(studioMonogram("Blackfen Studio Ltd")).toBe("BL");
    expect(studioMonogram("Northlight Coffee")).toBe("NC");
    expect(studioMonogram("Ox")).toBe("OX");
  });

  it("checks a logo's type and size before sending", () => {
    expect(logoProblem({ type: "image/svg+xml", size: 10 })).toMatch(/PNG, JPG or WebP/);
    expect(logoProblem({ type: "image/png", size: 3 * 1024 * 1024 })).toMatch(/2 MB/);
    expect(logoProblem({ type: "image/webp", size: 5000 })).toBeNull();
  });
});

describe("project page helpers", () => {
  const now = new Date("2026-10-04T12:00:00");
  it("splits the timeline into newest-first past and upcoming", () => {
    const events: TimelineEvent[] = [
      { kind: "start", at: "2026-09-01T09:00:00", title: "Project opened", text: "" },
      { kind: "shared", at: "2026-09-20T09:00:00", title: "Hero · V1", text: "" },
      { kind: "due", at: "2026-10-20T17:00:00", title: "Due date", text: "" },
    ];
    const { past, ahead } = splitTimeline(events, now);
    expect(past.map((event) => event.kind)).toEqual(["shared", "start"]);
    expect(ahead.map((event) => event.kind)).toEqual(["due"]);
  });

  it("words due dates", () => {
    expect(dueLabel(null, now)).toBeNull();
    expect(dueLabel("2026-10-04T17:00:00", now)).toBe("due today");
    expect(dueLabel("2026-10-05T17:00:00", now)).toBe("due tomorrow");
    expect(dueLabel("2026-10-14T17:00:00", now)).toBe("due in 10 days");
    expect(dueLabel("2026-10-01T17:00:00", now)).toBe("3 days past due");
  });

  it("formats day dates, with the year only when it differs", () => {
    expect(dayDate("2026-10-14", now)).toBe("14 Oct");
    expect(dayDate("2027-01-02T10:00:00", now)).toBe("2 Jan 2027");
  });
});

describe("project requests", () => {
  it("summarises deliverables with plurals", () => {
    expect(deliverablesSummary([{ kind: "hero_film", quantity: 1 }, { kind: "social_cutdown", quantity: 4 }])).toBe("1 Hero film + 4 Social cut-downs");
    expect(deliverablesSummary([{ kind: "photo_set", quantity: 2 }])).toBe("2 Photo sets");
  });

  it("validates like the server", () => {
    const base: ProjectRequestInput = { title: "", deliverables: [], brief: "short" };
    expect(Object.keys(requestProblems(base, "2026-10-04")).sort()).toEqual(["brief", "deliverables", "title"]);
    const ok: ProjectRequestInput = {
      title: "Summer", deliverables: [{ kind: "ad_spot", quantity: 1 }], brief: "A proper brief with enough words.", wanted_by: "2026-10-03",
    };
    expect(requestProblems(ok, "2026-10-04")).toEqual({ wanted_by: "Pick a date from today on." });
    expect(requestProblems({ ...ok, wanted_by: "2026-10-04" }, "2026-10-04")).toEqual({});
  });
});
