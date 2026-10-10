import { describe, expect, it } from "vitest";
import { dragRange, leavesLoop, loopSeek, markIn, markOut, moveHandle } from "./review-range";

describe("review ranges", () => {
  it("I then O marks a span", () => {
    expect(markOut(markIn(null, 1000), 4000)).toEqual({ inMs: 1000, outMs: 4000 });
  });
  it("O alone backs off the default range", () => {
    expect(markOut(null, 8000)).toEqual({ inMs: 3000, outMs: 8000 });
  });
  it("a tiny drag is a click", () => {
    expect(dragRange(1000, 1100)).toBeNull();
    expect(dragRange(5000, 2000, 4000)).toEqual({ inMs: 2000, outMs: 4000 });
  });
  it("handles never cross", () => {
    expect(moveHandle({ inMs: 1000, outMs: 2000 }, "in", 5000).inMs).toBe(1800);
  });
  it("loops at the out point and ends on seeks outside", () => {
    const loop = { startMs: 1000, endMs: 3000 };
    expect(loopSeek(2990, loop)).toBe(1000);
    expect(loopSeek(2000, loop)).toBeNull();
    expect(leavesLoop(9000, loop)).toBe(true);
    expect(leavesLoop(1500, loop)).toBe(false);
  });
});
