/**
 * The review player's media logic, kept free of React and the DOM so it can be tested.
 *
 * Everything here answers a question the `<video>` element raises: where a click on the
 * scrubber lands, whether a time can actually be jumped to, what has been buffered, and
 * what to tell someone when playback fails.
 */

/** Seconds the element may land away from a requested time before the jump counts as failed. */
export const SEEK_TOLERANCE_SECONDS = 0.5;

/** Delay before the buffering spinner appears, so a quick seek never flashes it. */
export const BUFFERING_DELAY_MS = 150;

/** The subset of `TimeRanges` the helpers read; a real `TimeRanges` satisfies it. */
export type RangeList = { length: number; start: (index: number) => number; end: (index: number) => number };

/** Clamps a requested position into the cut. With no known duration only the floor applies. */
export function clampSeekMs(ms: number, durationMs: number): number {
  if (!Number.isFinite(ms)) return 0;
  const floor = Math.max(0, ms);
  return durationMs > 0 ? Math.min(floor, durationMs) : floor;
}

/** Where a pointer at `clientX` sits along a track, as a position in the cut. */
export function positionFromPointer(clientX: number, left: number, width: number, durationMs: number): number {
  if (!(width > 0) || !(durationMs > 0)) return 0;
  const ratio = Math.max(0, Math.min(1, (clientX - left) / width));
  return ratio * durationMs;
}

/**
 * Whether the element can jump to `seconds` right now.
 *
 * Without HTTP range support the browser only reports what it has already downloaded as
 * seekable, so a jump past that silently snaps back. Checking first lets the player say so.
 */
export function canSeekTo(seekable: RangeList | null | undefined, seconds: number): boolean {
  if (!seekable || seekable.length === 0) return false;
  for (let index = 0; index < seekable.length; index += 1) {
    if (seconds >= seekable.start(index) - 0.001 && seconds <= seekable.end(index) + 0.001) return true;
  }
  return false;
}

/** True when the element landed close enough to where it was sent. */
export function seekLanded(targetMs: number, actualSeconds: number): boolean {
  return Math.abs(actualSeconds - targetMs / 1000) <= SEEK_TOLERANCE_SECONDS;
}

export type BufferedSpan = { start: number; end: number };

/** Buffered ranges as percentages of the track, merged and clamped for drawing. */
export function bufferedSpans(buffered: RangeList | null | undefined, durationMs: number): BufferedSpan[] {
  if (!buffered || !(durationMs > 0)) return [];
  const total = durationMs / 1000;
  const spans: BufferedSpan[] = [];
  for (let index = 0; index < buffered.length; index += 1) {
    const start = Math.max(0, Math.min(100, (buffered.start(index) / total) * 100));
    const end = Math.max(0, Math.min(100, (buffered.end(index) / total) * 100));
    if (end <= start) continue;
    const last = spans[spans.length - 1];
    if (last && start <= last.end + 0.1) last.end = Math.max(last.end, end);
    else spans.push({ start, end });
  }
  return spans;
}

/** Equality for span lists, so `progress` events that change nothing don't re-render. */
export function sameSpans(a: BufferedSpan[], b: BufferedSpan[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((span, index) => Math.abs(span.start - b[index].start) < 0.05 && Math.abs(span.end - b[index].end) < 0.05);
}

export type PlaybackError = { title: string; detail: string; retryable: boolean };

/**
 * Copy for a `MediaError`.
 *
 * Each code means something different to the person reviewing: a dropped connection is
 * worth retrying, a file the browser cannot decode is not, and a source that fails to load
 * at all is, in this app, nearly always a proxy that has not been generated yet.
 */
export function describePlaybackError(code: number | null | undefined): PlaybackError {
  switch (code) {
    case 1: // MEDIA_ERR_ABORTED
      return { title: "Playback stopped", detail: "Loading the cut was interrupted before it finished.", retryable: true };
    case 2: // MEDIA_ERR_NETWORK
      return { title: "Connection lost", detail: "The cut stopped loading because of a network problem. Check your connection and try again.", retryable: true };
    case 3: // MEDIA_ERR_DECODE
      return { title: "This cut can't be played", detail: "The browser couldn't decode the review proxy. Re-rendering the proxy usually fixes this.", retryable: true };
    case 4: // MEDIA_ERR_SRC_NOT_SUPPORTED
      return { title: "Preview not available", detail: "The review proxy for this cut couldn't be loaded. It may still be generating — try again in a moment.", retryable: true };
    default:
      return { title: "Playback failed", detail: "Something went wrong while loading this cut.", retryable: true };
  }
}
