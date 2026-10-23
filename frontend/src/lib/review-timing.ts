/**
 * The `start_time_ms` field for a review note or annotation, or nothing when it has none.
 *
 * `0` is a real timecode — the first frame — so only `null`/`undefined` (and nonsense
 * values) mean "not pinned". The older `ms > 0` guards silently dropped pins at 0:00, so a
 * note left on the opening frame came back with no timecode and its drawing showed on
 * every frame.
 */
export function startTimeField(ms: number | null | undefined): { start_time_ms?: number } {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return {};
  return { start_time_ms: Math.round(ms) };
}

/**
 * `end_time_ms` to send alongside a start: only when there is a start to measure from and the
 * end does not run backwards (the API refuses both).
 */
export function endTimeField(startMs: number | null | undefined, endMs: number | null | undefined): { end_time_ms?: number } {
  if (!("start_time_ms" in startTimeField(startMs))) return {};
  if (endMs === null || endMs === undefined || !Number.isFinite(endMs) || endMs < (startMs as number)) return {};
  return { end_time_ms: Math.round(endMs) };
}
