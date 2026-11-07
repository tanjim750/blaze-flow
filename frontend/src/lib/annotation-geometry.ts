/**
 * Geometry for review drawings, all in normalised 0–1 frame coordinates (what the API
 * stores). `aspect` is the frame's width / height: text and hit tolerances are sized
 * against the frame's height, so converting them to x needs it.
 */
import type { AnnotationElement } from "@/lib/api";

export type Pt = { x: number; y: number };
export type Box = { x: number; y: number; width: number; height: number };
export type Handle = "nw" | "ne" | "sw" | "se" | "start" | "end";
type El = Omit<AnnotationElement, "id"> & { id?: string };

/** Default text size as a fraction of the frame height. */
export const TEXT_SIZE = 0.045;
const MIN_TEXT = 0.02, MAX_TEXT = 0.2;
const MIN_SIDE = 0.01;
export const PALETTE = ["#ffcf5a", "#9b7bff", "#ff5d6c", "#3ddc97", "#4ea8ff", "#ffffff"] as const;

/** Clamped to the frame and rounded to 1/100000 — finer than any screen, and no float noise in the payload. */
const clamp01 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1e5) / 1e5;
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const pt = (v: unknown): Pt => { const o = (v ?? {}) as Record<string, unknown>; return { x: num(o.x), y: num(o.y) }; };

export const textSize = (el: El) => Math.min(MAX_TEXT, Math.max(MIN_TEXT, num(el.style.font_size, TEXT_SIZE)));
export const textOf = (el: El) => String(el.payload.text ?? "");

/** Bounding box of an element. Text is anchored at its baseline (x, y), as it always was. */
export function bounds(el: El, aspect = 16 / 9): Box {
  const g = el.geometry;
  switch (el.element_type) {
    case "RECTANGLE": case "ELLIPSE":
      return { x: num(g.x), y: num(g.y), width: num(g.width), height: num(g.height) };
    case "ARROW": {
      const a = pt(g.start), b = pt(g.end);
      return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
    }
    case "PATH": {
      const ps = ((g.points as unknown[]) ?? []).map(pt);
      if (!ps.length) return { x: 0, y: 0, width: 0, height: 0 };
      const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
      const x = Math.min(...xs), y = Math.min(...ys);
      return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
    }
    case "TEXT": {
      const fs = textSize(el);
      const width = Math.max(1, textOf(el).length) * fs * 0.56 / aspect;
      return { x: num(g.x), y: num(g.y) - fs * 0.82, width, height: fs * 1.04 };
    }
    default: {
      const r = 0.012;
      return { x: num(g.x) - r / aspect, y: num(g.y) - r, width: (2 * r) / aspect, height: 2 * r };
    }
  }
}

function distToSegment(p: Pt, a: Pt, b: Pt, aspect: number) {
  // Measure in a space where x and y have the same scale (height units).
  const px = p.x * aspect, ax = a.x * aspect, bx = b.x * aspect;
  const dx = bx - ax, dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), p.y - (a.y + t * dy));
}

/** Whether `p` lands on the element. `tol` is in frame-height units. */
export function hitTest(el: El, p: Pt, aspect = 16 / 9, tol = 0.015): boolean {
  const g = el.geometry;
  if (el.element_type === "ARROW") return distToSegment(p, pt(g.start), pt(g.end), aspect) <= tol;
  if (el.element_type === "PATH") {
    const ps = ((g.points as unknown[]) ?? []).map(pt);
    for (let i = 1; i < ps.length; i++) if (distToSegment(p, ps[i - 1], ps[i], aspect) <= tol) return true;
    return false;
  }
  if (el.element_type === "ELLIPSE") {
    const b = bounds(el, aspect);
    const rx = b.width / 2 + tol / aspect, ry = b.height / 2 + tol;
    if (rx <= 0 || ry <= 0) return false;
    const nx = (p.x - (b.x + b.width / 2)) / rx, ny = (p.y - (b.y + b.height / 2)) / ry;
    return nx * nx + ny * ny <= 1;
  }
  const b = bounds(el, aspect);
  const tx = tol / aspect;
  return p.x >= b.x - tx && p.x <= b.x + b.width + tx && p.y >= b.y - tol && p.y <= b.y + b.height + tol;
}

/** The topmost element under `p` (last drawn wins), or -1. */
export function hitIndex(els: El[], p: Pt, aspect = 16 / 9, tol = 0.015): number {
  for (let i = els.length - 1; i >= 0; i--) if (hitTest(els[i], p, aspect, tol)) return i;
  return -1;
}

/** Where each resize handle sits for an element. */
export function handles(el: El, aspect = 16 / 9): { handle: Handle; at: Pt }[] {
  if (el.element_type === "POINT") return [];
  if (el.element_type === "ARROW") return [{ handle: "start", at: pt(el.geometry.start) }, { handle: "end", at: pt(el.geometry.end) }];
  const b = bounds(el, aspect);
  return [
    { handle: "nw", at: { x: b.x, y: b.y } }, { handle: "ne", at: { x: b.x + b.width, y: b.y } },
    { handle: "sw", at: { x: b.x, y: b.y + b.height } }, { handle: "se", at: { x: b.x + b.width, y: b.y + b.height } },
  ];
}

export function handleAt(el: El, p: Pt, aspect = 16 / 9, tol = 0.025): Handle | null {
  for (const h of handles(el, aspect)) if (Math.hypot((h.at.x - p.x) * aspect, h.at.y - p.y) <= tol) return h.handle;
  return null;
}

/** Moves an element by (dx, dy), stopping at the frame edge so it never leaves the picture. */
export function translate<T extends El>(el: T, dx: number, dy: number, aspect = 16 / 9): T {
  const b = bounds(el, aspect);
  const cdx = Math.min(1 - (b.x + b.width), Math.max(-b.x, dx));
  const cdy = Math.min(1 - (b.y + b.height), Math.max(-b.y, dy));
  const move = (q: Pt) => ({ x: clamp01(q.x + cdx), y: clamp01(q.y + cdy) });
  const g = el.geometry;
  let geometry: Record<string, unknown>;
  switch (el.element_type) {
    case "ARROW": geometry = { start: move(pt(g.start)), end: move(pt(g.end)) }; break;
    case "PATH": geometry = { points: ((g.points as unknown[]) ?? []).map((q) => move(pt(q))) }; break;
    default: geometry = { ...g, ...move(pt(g)) };
  }
  return { ...el, geometry: fit(el.element_type, geometry) };
}

/** Rectangles must fit inside the frame for the API; trims float drift. */
function fit(kind: El["element_type"], g: Record<string, unknown>): Record<string, unknown> {
  if (kind !== "RECTANGLE" && kind !== "ELLIPSE") return g;
  const x = clamp01(num(g.x)), y = clamp01(num(g.y));
  return { x, y, width: clamp01(Math.min(1 - x, Math.max(0, num(g.width)))), height: clamp01(Math.min(1 - y, Math.max(0, num(g.height)))) };
}

/** Drags one handle of `el` to `p`. `origin` is the element as it was when the drag began. */
export function resize<T extends El>(origin: T, handle: Handle, p: Pt, aspect = 16 / 9): T {
  const q = { x: clamp01(p.x), y: clamp01(p.y) };
  const g = origin.geometry;
  if (origin.element_type === "ARROW") {
    return { ...origin, geometry: { start: handle === "start" ? q : pt(g.start), end: handle === "end" ? q : pt(g.end) } };
  }
  const b = bounds(origin, aspect);
  // The corner opposite the dragged one stays put.
  const fx = handle === "nw" || handle === "sw" ? b.x + b.width : b.x;
  const fy = handle === "nw" || handle === "ne" ? b.y + b.height : b.y;
  if (origin.element_type === "TEXT") {
    const scale = Math.max(Math.abs(q.y - fy) / (b.height || 1e-6), 0.05);
    const size = Math.min(MAX_TEXT, Math.max(MIN_TEXT, textSize(origin) * scale));
    const resized = { ...origin, style: { ...origin.style, font_size: +size.toFixed(4) } };
    const nb = bounds(resized, aspect);
    const x = handle === "nw" || handle === "sw" ? fx - nb.width : fx;
    const top = handle === "nw" || handle === "ne" ? fy - nb.height : fy;
    return { ...resized, geometry: { x: clamp01(x), y: clamp01(top + size * 0.82) } };
  }
  const nb = { x: Math.min(fx, q.x), y: Math.min(fy, q.y), width: Math.max(MIN_SIDE, Math.abs(q.x - fx)), height: Math.max(MIN_SIDE, Math.abs(q.y - fy)) };
  if (origin.element_type === "PATH") {
    const sx = b.width ? nb.width / b.width : 1, sy = b.height ? nb.height / b.height : 1;
    const points = ((g.points as unknown[]) ?? []).map(pt).map((s) => ({ x: clamp01(nb.x + (s.x - b.x) * sx), y: clamp01(nb.y + (s.y - b.y) * sy) }));
    return { ...origin, geometry: { points } };
  }
  return { ...origin, geometry: fit(origin.element_type, nb) };
}

/** Builds the geometry for a shape drawn from `a` to `b` (or along `path`), or null if too small. */
export function shapeFrom(tool: El["element_type"], a: Pt, b: Pt, path: Pt[] = []): Record<string, unknown> | null {
  const s = { x: clamp01(a.x), y: clamp01(a.y) }, e = { x: clamp01(b.x), y: clamp01(b.y) };
  if (tool === "POINT" || tool === "TEXT") return e;
  if (tool === "ARROW") return Math.hypot(e.x - s.x, e.y - s.y) < 0.005 ? null : { start: s, end: e };
  if (tool === "PATH") {
    const points = simplify(path.map((q) => ({ x: clamp01(q.x), y: clamp01(q.y) })));
    return points.length > 1 ? { points: points.slice(0, 500) } : null;
  }
  const box = { x: Math.min(s.x, e.x), y: Math.min(s.y, e.y), width: Math.abs(e.x - s.x), height: Math.abs(e.y - s.y) };
  return box.width < 0.004 && box.height < 0.004 ? null : fit(tool, box);
}

/** Drops points closer than `min` to the last kept one, keeping long strokes under the 500-point cap. */
export function simplify(points: Pt[], min = 0.002): Pt[] {
  let step = min;
  let out = points;
  do {
    out = [];
    for (const p of points) { const last = out[out.length - 1]; if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= step) out.push(p); }
    const tail = points[points.length - 1];
    if (tail && out[out.length - 1] !== tail && points.length > 1) out.push(tail);
    step *= 1.6;
  } while (out.length > 500);
  return out;
}
