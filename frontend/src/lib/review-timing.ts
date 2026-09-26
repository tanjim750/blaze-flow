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
