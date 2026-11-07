import { describe, expect, it } from "vitest";
import { bounds, handleAt, hitIndex, hitTest, resize, shapeFrom, simplify, translate, textSize, TEXT_SIZE } from "./annotation-geometry";
import type { AnnotationElement } from "./api";

const el = (element_type: AnnotationElement["element_type"], geometry: Record<string, unknown>, extra: Partial<AnnotationElement> = {}): AnnotationElement =>
  ({ element_type, geometry, style: { color: "#ffcf5a" }, payload: {}, ...extra });
const rect = el("RECTANGLE", { x: 0.2, y: 0.2, width: 0.2, height: 0.1 });
const ellipse = el("ELLIPSE", { x: 0.5, y: 0.5, width: 0.2, height: 0.2 });
const arrow = el("ARROW", { start: { x: 0.1, y: 0.1 }, end: { x: 0.5, y: 0.5 } });
const path = el("PATH", { points: [{ x: 0.1, y: 0.8 }, { x: 0.2, y: 0.9 }, { x: 0.3, y: 0.8 }] });
const text = el("TEXT", { x: 0.6, y: 0.2 }, { payload: { text: "Fix logo" } });

describe("bounds", () => {
  it("covers each kind", () => {
    expect(bounds(rect)).toEqual({ x: 0.2, y: 0.2, width: 0.2, height: 0.1 });
    expect(bounds(arrow)).toEqual({ x: 0.1, y: 0.1, width: 0.4, height: 0.4 });
    const p = bounds(path);
    expect(p.x).toBeCloseTo(0.1); expect(p.width).toBeCloseTo(0.2); expect(p.height).toBeCloseTo(0.1);
    const t = bounds(text);
    expect(t.y).toBeLessThan(0.2); expect(t.y + t.height).toBeGreaterThan(0.2); expect(t.width).toBeGreaterThan(0);
  });
  it("text grows with its size and its length", () => {
    const big = { ...text, style: { font_size: TEXT_SIZE * 2 } };
    expect(bounds(big).width).toBeCloseTo(bounds(text).width * 2);
    expect(textSize({ ...text, style: { font_size: 9 } })).toBeLessThanOrEqual(0.2);
  });
});

describe("hitTest", () => {
  it("hits inside a rectangle with tolerance and misses outside", () => {
    expect(hitTest(rect, { x: 0.3, y: 0.25 })).toBe(true);
    expect(hitTest(rect, { x: 0.405, y: 0.25 })).toBe(true);
    expect(hitTest(rect, { x: 0.6, y: 0.6 })).toBe(false);
  });
  it("uses the ellipse's curve, not its box corners", () => {
    expect(hitTest(ellipse, { x: 0.6, y: 0.6 })).toBe(true);
    expect(hitTest(ellipse, { x: 0.505, y: 0.505 }, 16 / 9, 0.001)).toBe(false);
  });
  it("hits near an arrow's line or a stroke, not far from it", () => {
    expect(hitTest(arrow, { x: 0.3, y: 0.305 })).toBe(true);
    expect(hitTest(arrow, { x: 0.3, y: 0.45 })).toBe(false);
    expect(hitTest(path, { x: 0.15, y: 0.85 })).toBe(true);
    expect(hitTest(path, { x: 0.2, y: 0.8 })).toBe(false);
  });
  it("picks the topmost of overlapping shapes", () => {
    const over = el("RECTANGLE", { x: 0.25, y: 0.22, width: 0.1, height: 0.05 });
    expect(hitIndex([rect, over], { x: 0.3, y: 0.24 })).toBe(1);
    expect(hitIndex([rect, over], { x: 0.9, y: 0.9 })).toBe(-1);
  });
});

describe("translate", () => {
  it("moves every kind", () => {
    expect(translate(rect, 0.1, 0.1).geometry).toMatchObject({ x: 0.3 });
    const a = translate(arrow, 0.1, 0).geometry as { start: { x: number }; end: { x: number } };
    expect(a.start.x).toBeCloseTo(0.2); expect(a.end.x).toBeCloseTo(0.6);
    expect(translate(text, -0.1, 0).geometry.x).toBeCloseTo(0.5);
  });
  it("stops at the frame edge and keeps the shape whole", () => {
    const moved = translate(rect, 5, 5);
    expect(moved.geometry.x as number + (moved.geometry.width as number)).toBeLessThanOrEqual(1);
    expect(moved.geometry.y as number + (moved.geometry.height as number)).toBeLessThanOrEqual(1);
    expect(moved.geometry.width).toBeCloseTo(0.2);
    const pts = (translate(path, -1, 0).geometry.points as { x: number }[]);
    expect(Math.min(...pts.map((q) => q.x))).toBeCloseTo(0);
  });
});

describe("resize", () => {
  it("drags a corner while the opposite corner stays put", () => {
    const r = resize(rect, "se", { x: 0.5, y: 0.5 }).geometry;
    expect(r).toEqual({ x: 0.2, y: 0.2, width: 0.3, height: 0.3 });
    const flipped = resize(rect, "se", { x: 0.1, y: 0.1 }).geometry;
    expect(flipped.x).toBeCloseTo(0.1); expect(flipped.width).toBeCloseTo(0.1);
  });
  it("moves an arrow's end", () => {
    expect(resize(arrow, "end", { x: 0.9, y: 0.2 }).geometry).toEqual({ start: { x: 0.1, y: 0.1 }, end: { x: 0.9, y: 0.2 } });
  });
  it("scales a freehand stroke into the new box", () => {
    const b = bounds(resize(path, "se", { x: 0.5, y: 1 }));
    expect(b.width).toBeCloseTo(0.4); expect(b.height).toBeCloseTo(0.2);
  });
  it("grows text's size", () => {
    const b = bounds(text);
    const big = resize(text, "se", { x: 0.9, y: b.y + b.height * 2 });
    expect(textSize(big)).toBeCloseTo(TEXT_SIZE * 2, 2);
  });
  it("finds the handle under the pointer", () => {
    expect(handleAt(rect, { x: 0.4, y: 0.3 })).toBe("se");
    expect(handleAt(rect, { x: 0.3, y: 0.25 })).toBeNull();
  });
});

describe("shapeFrom", () => {
  it("normalises a box drawn in any direction and ignores a stray click", () => {
    expect(shapeFrom("RECTANGLE", { x: 0.5, y: 0.5 }, { x: 0.3, y: 0.2 })).toEqual({ x: 0.3, y: 0.2, width: 0.2, height: 0.3 });
    expect(shapeFrom("ELLIPSE", { x: 0.5, y: 0.5 }, { x: 0.501, y: 0.5 })).toBeNull();
    expect(shapeFrom("RECTANGLE", { x: 0.5, y: 0.5 }, { x: 1.4, y: 1.2 })).toEqual({ x: 0.5, y: 0.5, width: 0.5, height: 0.5 });
  });
  it("keeps freehand under the API's 500-point cap", () => {
    const many = Array.from({ length: 2000 }, (_, i) => ({ x: i / 2000, y: 0.5 + Math.sin(i / 20) * 0.2 }));
    const g = shapeFrom("PATH", many[0], many[1999], many)!;
    expect((g.points as unknown[]).length).toBeLessThanOrEqual(500);
    expect(simplify([{ x: 0, y: 0 }, { x: 0.0001, y: 0 }, { x: 0.5, y: 0 }])).toHaveLength(2);
  });
});
