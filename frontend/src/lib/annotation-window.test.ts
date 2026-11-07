import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOLD_MS, displayWindow, drawingEndMs, holdLabel, noteEndMs, parseTime, rangeLabel, validChoice, windowOpacity,
} from "./annotation-window";

describe("displayWindow", () => {
  it("gives a drawing saved without an end the default hold", () => {
    expect(displayWindow(2000, null)).toEqual({ startMs: 2000, endMs: 2000 + DEFAULT_HOLD_MS, frameOnly: false });
  });
  it("treats end === start as just this frame, and has no window without a start", () => {
    expect(displayWindow(2000, 2000)?.frameOnly).toBe(true);
    expect(displayWindow(null, 5000)).toBeNull();
  });
  it("falls back to the default when the end runs backwards", () => {
    expect(displayWindow(4000, 1000)?.endMs).toBe(4000 + DEFAULT_HOLD_MS);
  });
});

describe("windowOpacity", () => {
  const held = displayWindow(2000, 7000)!;
  it("shows a held drawing through its window while playing, and hides it either side", () => {
    expect(windowOpacity(held, 1000, true)).toBe(0);
    expect(windowOpacity(held, 2000, true)).toBe(1);
    expect(windowOpacity(held, 4500, true)).toBe(1);
    expect(windowOpacity(held, 7200, true)).toBe(0);
  });
  it("fades over the last half second of playback, but stays solid when paused there", () => {
    expect(windowOpacity(held, 6750, true)).toBeCloseTo(0.5);
    expect(windowOpacity(held, 6750, false)).toBe(1);
  });
  it("counts a seek that lands a hair early as on the frame", () => {
    expect(windowOpacity(held, 1960, false)).toBe(1);
  });
  it("shows a single-frame drawing only while paused on it", () => {
    const frame = displayWindow(3000, 3000)!;
    expect(windowOpacity(frame, 3000, false)).toBe(1);
    expect(windowOpacity(frame, 3000, true)).toBe(0);
    expect(windowOpacity(frame, 3500, false)).toBe(0);
  });
  it("always shows an unpinned drawing", () => {
    expect(windowOpacity(null, 99_000, true)).toBe(1);
  });
});

describe("choices", () => {
  it("turns a choice into the drawing's end, kept inside the cut", () => {
    expect(drawingEndMs(2000, { kind: "frame" })).toBe(2000);
    expect(drawingEndMs(2000, { kind: "hold", ms: 5000 })).toBe(7000);
    expect(drawingEndMs(8000, { kind: "hold", ms: 5000 }, 10_000)).toBe(10_000);
    expect(drawingEndMs(2000, { kind: "range", endMs: 9000 }, 20_000)).toBe(9000);
  });
  it("only makes the note itself a range note for an in/out range", () => {
    expect(noteEndMs(2000, { kind: "hold", ms: 5000 })).toBeNull();
    expect(noteEndMs(2000, { kind: "range", endMs: 9000 })).toBe(9000);
    expect(noteEndMs(2000, { kind: "range", endMs: 1000 })).toBeNull();
    expect(validChoice(2000, { kind: "range", endMs: 1000 })).toBe(false);
  });
  it("labels spans and durations", () => {
    expect(rangeLabel(2000, 7000)).toBe("00:02–00:07");
    expect(rangeLabel(2000, null)).toBe("00:02");
    expect(holdLabel(displayWindow(2000, 4500)!)).toBe("2.5s");
    expect(holdLabel(displayWindow(2000, 2000)!)).toBe("1 frame");
  });
  it("parses typed out points", () => {
    expect(parseTime("7")).toBe(7000);
    expect(parseTime("7.5")).toBe(7500);
    expect(parseTime("1:05")).toBe(65_000);
    expect(parseTime("abc")).toBeNull();
    expect(parseTime("")).toBeNull();
  });
});
