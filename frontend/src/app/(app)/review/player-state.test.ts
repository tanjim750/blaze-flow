import { describe, expect, it } from "vitest";
import {
  bufferedSpans, canSeekTo, clampSeekMs, describePlaybackError, positionFromPointer,
  sameSpans, seekLanded, type RangeList,
} from "./player-state";

const ranges = (...pairs: [number, number][]): RangeList => ({
  length: pairs.length,
  start: (index) => pairs[index][0],
  end: (index) => pairs[index][1],
});

describe("clampSeekMs", () => {
  it("keeps 0 as a real position rather than treating it as missing", () => {
    expect(clampSeekMs(0, 10_000)).toBe(0);
  });
  it("clamps into the cut", () => {
    expect(clampSeekMs(-50, 10_000)).toBe(0);
    expect(clampSeekMs(12_000, 10_000)).toBe(10_000);
    expect(clampSeekMs(5_000, 10_000)).toBe(5_000);
  });
  it("only applies the floor while the duration is unknown", () => {
    expect(clampSeekMs(90_000, 0)).toBe(90_000);
    expect(clampSeekMs(Number.NaN, 0)).toBe(0);
  });
});

describe("positionFromPointer", () => {
  it("maps the pointer to a time along the track", () => {
    expect(positionFromPointer(150, 100, 200, 60_000)).toBe(15_000);
    expect(positionFromPointer(200, 100, 200, 60_000)).toBe(30_000);
  });
  it("clamps outside the track and guards a zero width or duration", () => {
    expect(positionFromPointer(50, 100, 200, 60_000)).toBe(0);
    expect(positionFromPointer(999, 100, 200, 60_000)).toBe(60_000);
    expect(positionFromPointer(150, 100, 0, 60_000)).toBe(0);
    expect(positionFromPointer(150, 100, 200, 0)).toBe(0);
  });
});

describe("canSeekTo", () => {
  it("accepts a time inside any seekable range", () => {
    expect(canSeekTo(ranges([0, 30]), 15)).toBe(true);
    expect(canSeekTo(ranges([0, 5], [10, 20]), 12)).toBe(true);
    expect(canSeekTo(ranges([0, 30]), 30)).toBe(true);
  });
  it("rejects a time past what a non-ranged server let the browser fetch", () => {
    expect(canSeekTo(ranges([0, 4]), 15)).toBe(false);
    expect(canSeekTo(ranges(), 0)).toBe(false);
    expect(canSeekTo(null, 1)).toBe(false);
  });
});

describe("seekLanded", () => {
  it("allows for keyframe rounding but catches a snap back", () => {
    expect(seekLanded(15_000, 15.04)).toBe(true);
    expect(seekLanded(15_000, 14.6)).toBe(true);
    expect(seekLanded(15_000, 0)).toBe(false);
  });
});

describe("bufferedSpans", () => {
  it("converts seconds to track percentages", () => {
    expect(bufferedSpans(ranges([0, 5], [10, 20]), 20_000)).toEqual([{ start: 0, end: 25 }, { start: 50, end: 100 }]);
  });
  it("merges touching ranges and drops empty ones", () => {
    expect(bufferedSpans(ranges([0, 5], [5, 10], [12, 12]), 20_000)).toEqual([{ start: 0, end: 50 }]);
  });
  it("returns nothing without a duration", () => {
    expect(bufferedSpans(ranges([0, 5]), 0)).toEqual([]);
  });
  it("compares lists tolerantly", () => {
    expect(sameSpans([{ start: 0, end: 50 }], [{ start: 0, end: 50.01 }])).toBe(true);
    expect(sameSpans([{ start: 0, end: 50 }], [{ start: 0, end: 60 }])).toBe(false);
    expect(sameSpans([], [{ start: 0, end: 1 }])).toBe(false);
  });
});

describe("describePlaybackError", () => {
  it("gives each media error its own copy", () => {
    const titles = [1, 2, 3, 4].map((code) => describePlaybackError(code).title);
    expect(new Set(titles).size).toBe(4);
    expect(describePlaybackError(2).detail).toMatch(/network/i);
    expect(describePlaybackError(4).detail).toMatch(/generating/i);
  });
  it("falls back for an unknown code", () => {
    expect(describePlaybackError(null).title).toBe("Playback failed");
  });
});
