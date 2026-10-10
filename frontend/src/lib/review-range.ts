/**
 * In/out points for range comments, and looping a range.
 *
 * The marked range belongs to the composer: I and O (or a shift-drag on the timeline, or the
 * handles once a range exists) set it, and the next note posted covers it, with `endMs` as
 * its `end_time_ms` — the same field drawing holds and range notes already use.
 */

export type MarkRange = { inMs: number; outMs: number | null };
export type LoopRange = { startMs: number; endMs: number };

/** Shorter than this is a click, not a range. */
export const MIN_RANGE_MS = 200;
/** O pressed with no in point: the range starts this far before it. */
export const DEFAULT_RANGE_MS = 5000;

const clamp = (ms: number, durationMs: number) => Math.max(0, durationMs > 0 ? Math.min(ms, durationMs) : ms);

/** I: the in point moves to the playhead; an out point still after it is kept. */
export function markIn(range: MarkRange | null, positionMs: number, durationMs = 0): MarkRange {
  const inMs = Math.round(clamp(positionMs, durationMs));
  const outMs = range?.outMs != null && range.outMs - inMs >= MIN_RANGE_MS ? range.outMs : null;
  return { inMs, outMs };
}

/**
 * O: the out point moves to the playhead. With no in point before it, the in point is put
 * `DEFAULT_RANGE_MS` earlier so a single key press still gives a usable range.
 */
export function markOut(range: MarkRange | null, positionMs: number, durationMs = 0): MarkRange {
  const outMs = Math.round(clamp(positionMs, durationMs));
  if (range && outMs - range.inMs >= MIN_RANGE_MS) return { inMs: range.inMs, outMs };
  const inMs = Math.max(0, outMs - DEFAULT_RANGE_MS);
  return outMs - inMs >= MIN_RANGE_MS ? { inMs, outMs } : { inMs, outMs: null };
}

/** A drag between two timeline positions, in either direction; null when it was a click. */
export function dragRange(fromMs: number, toMs: number, durationMs = 0): MarkRange | null {
  const a = clamp(Math.min(fromMs, toMs), durationMs);
  const b = clamp(Math.max(fromMs, toMs), durationMs);
  return b - a >= MIN_RANGE_MS ? { inMs: Math.round(a), outMs: Math.round(b) } : null;
}

/** Moves one handle of an existing range, never letting it cross the other one. */
export function moveHandle(range: MarkRange, handle: "in" | "out", toMs: number, durationMs = 0): MarkRange {
  const ms = Math.round(clamp(toMs, durationMs));
  if (handle === "in") {
    const limit = range.outMs !== null ? range.outMs - MIN_RANGE_MS : Infinity;
    return { ...range, inMs: Math.min(ms, limit) };
  }
  return { ...range, outMs: Math.max(ms, range.inMs + MIN_RANGE_MS) };
}

/** The out point when the range is a real span; null while only an in point is set. */
export function rangeOut(range: MarkRange | null): number | null {
  return range && range.outMs !== null && range.outMs - range.inMs >= MIN_RANGE_MS ? range.outMs : null;
}

/** Where a looping playhead should jump, or null to carry on: past the out point it wraps to the in point. */
export function loopSeek(positionMs: number, loop: LoopRange | null, toleranceMs = 40): number | null {
  if (!loop || loop.endMs - loop.startMs < MIN_RANGE_MS) return null;
  return positionMs >= loop.endMs - toleranceMs ? loop.startMs : null;
}

/** A manual seek outside the loop ends it: the viewer has gone somewhere else on purpose. */
export function leavesLoop(targetMs: number, loop: LoopRange | null): boolean {
  return Boolean(loop && (targetMs < loop.startMs - 50 || targetMs > loop.endMs + 50));
}
