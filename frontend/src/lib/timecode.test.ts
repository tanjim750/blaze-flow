import { describe, expect, it } from "vitest";
import { timecode } from "./timecode";
import { parseTime } from "./annotation-window";

describe("timecode", () => {
  it("formats minutes and seconds", () => {
    expect(timecode(0)).toBe("00:00");
    expect(timecode(284_900)).toBe("04:44");
    expect(timecode(726_000)).toBe("12:06");
  });
  it("adds hours from one hour instead of 60+ minutes", () => {
    expect(timecode(3_599_999)).toBe("59:59");
    expect(timecode(3_600_000)).toBe("1:00:00");
    expect(timecode(3_723_000)).toBe("1:02:03");
  });
  it("never renders NaN", () => {
    expect(timecode(Number.NaN)).toBe("00:00");
    expect(timecode(-5)).toBe("00:00");
  });
  it("round-trips through parseTime", () => {
    expect(parseTime(timecode(3_723_000))).toBe(3_723_000);
    expect(parseTime("1:05")).toBe(65_000);
  });
});
