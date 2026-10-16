import { describe, expect, it } from "vitest";
import {
  describeAspect, dueLabel, formatLength, fromDateInput, normalizeSpecs, parseLength, specChips, specMismatches, toDateInput,
} from "./project-brief";

describe("specs", () => {
  it("normalises unknown or malformed values to null", () => {
    expect(normalizeSpecs({ aspect_ratio: "21:9", platform: "Myspace", target_length_seconds: -3, resolution: "  ", notes: "Captions" }))
      .toEqual({ aspect_ratio: null, platform: null, target_length_seconds: null, resolution: null, notes: "Captions" });
    expect(normalizeSpecs(undefined).aspect_ratio).toBeNull();
  });

  it("reads as chips in a fixed order, skipping unset fields and notes", () => {
    const chips = specChips(normalizeSpecs({ platform: "Instagram", aspect_ratio: "9:16", target_length_seconds: 30, resolution: "1080x1920", notes: "x" }));
    expect(chips.map((chip) => chip.label)).toEqual(["9:16 vertical", "30s", "Instagram", "1080×1920"]);
    expect(specChips(normalizeSpecs({}))).toEqual([]);
  });
});

describe("lengths", () => {
  it("formats seconds as s, m:ss or h:mm:ss", () => {
    expect(formatLength(30)).toBe("30s");
    expect(formatLength(90)).toBe("1:30");
    expect(formatLength(3600)).toBe("1:00:00");
    expect(formatLength(29.6)).toBe("30s");
  });

  it("parses the ways people type a length", () => {
    expect(parseLength("30")).toBe(30);
    expect(parseLength("30s")).toBe(30);
    expect(parseLength("1:30")).toBe(90);
    expect(parseLength("1:00:00")).toBe(3600);
    expect(parseLength("1m 30s")).toBe(90);
    expect(parseLength("")).toBeNull();
    expect(parseLength("about a minute")).toBeNaN();
  });
});

describe("due dates", () => {
  it("round-trips a date input without slipping a day", () => {
    const iso = fromDateInput("2026-10-20");
    expect(iso).toBe("2026-10-20T12:00:00Z");
    expect(toDateInput(iso, "Europe/London")).toBe("2026-10-20");
    // Midday UTC is the same calendar day from UTC-11 to UTC+11.
    expect(toDateInput(iso, "America/Los_Angeles")).toBe("2026-10-20");
    expect(fromDateInput("")).toBeNull();
    expect(toDateInput(null)).toBe("");
  });

  it("says how far away or overdue a date is", () => {
    const now = new Date("2026-10-03T20:10:00Z");
    expect(dueLabel(null, now, "Europe/London")).toEqual({ text: "No due date", tone: "none" });
    expect(dueLabel("2026-10-01T12:00:00Z", now, "Europe/London")).toMatchObject({ tone: "overdue", text: expect.stringContaining("2 days overdue") });
    expect(dueLabel("2026-10-03T12:00:00Z", now, "Europe/London").text).toContain("today");
    expect(dueLabel("2026-10-06T12:00:00Z", now, "Europe/London")).toMatchObject({ tone: "soon", text: expect.stringContaining("in 3 days") });
    expect(dueLabel("2026-11-20T12:00:00Z", now, "Europe/London").tone).toBe("later");
  });
});

describe("spec mismatches", () => {
  const specs = normalizeSpecs({ aspect_ratio: "9:16", target_length_seconds: 30 });

  it("is quiet when the cut matches, within tolerance", () => {
    expect(specMismatches(specs, { width: 1080, height: 1920, durationMs: 30_400 })).toEqual([]);
  });

  it("flags a wrong aspect and a long cut", () => {
    const result = specMismatches(specs, { width: 1920, height: 1080, durationMs: 42_000 });
    expect(result.map((item) => item.key)).toEqual(["aspect_ratio", "target_length_seconds"]);
    expect(result[0].short).toBe("16:9, spec 9:16");
    expect(result[1].message).toBe("Brief asks for 30s; this cut runs 42s");
  });

  it("needs both specs and measurements", () => {
    expect(specMismatches(null, { width: 1, height: 1, durationMs: 1 })).toEqual([]);
    expect(specMismatches(specs, null)).toEqual([]);
    expect(specMismatches(normalizeSpecs({}), { width: 1920, height: 1080, durationMs: 99_000 })).toEqual([]);
  });

  it("names odd frame sizes by their reduced ratio", () => {
    expect(describeAspect(1920, 1080)).toBe("16:9");
    expect(describeAspect(1080, 1350)).toBe("4:5");
    expect(describeAspect(2560, 1080)).toBe("64:27");
  });
});
