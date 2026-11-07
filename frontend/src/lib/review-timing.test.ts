import { describe, expect, it } from "vitest";
import { startTimeField } from "./review-timing";

describe("startTimeField", () => {
  it("keeps a pin on the very first frame", () => {
    expect(startTimeField(0)).toEqual({ start_time_ms: 0 });
  });

  it("rounds a positive timecode", () => {
    expect(startTimeField(5300.6)).toEqual({ start_time_ms: 5301 });
  });

  it("sends nothing for an unpinned note", () => {
    expect(startTimeField(null)).toEqual({});
    expect(startTimeField(undefined)).toEqual({});
  });

  it("ignores values the API would reject", () => {
    expect(startTimeField(-1)).toEqual({});
    expect(startTimeField(Number.NaN)).toEqual({});
  });
});
