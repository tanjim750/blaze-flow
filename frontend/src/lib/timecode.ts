/**
 * Timecode formatting, kept free of any API import.
 *
 * The review player is a client component, so anything it imports is bundled for the
 * browser. `lib/api` reaches for `next/headers`, which cannot cross that boundary —
 * hence this small module rather than a helper living beside the data loader.
 */
const pad = (value: number) => String(value).padStart(2, "0");

/** Milliseconds → `mm:ss` (or `h:mm:ss` from one hour), the format the comment feed and the scrubber both use. */
export function timecode(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const hours = Math.floor(total / 3600);
  const clock = `${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
  return hours ? `${hours}:${clock}` : clock;
}
