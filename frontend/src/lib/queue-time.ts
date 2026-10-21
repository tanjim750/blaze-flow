/**
 * Deterministic "Tue 20 Oct, 00:46" in the workspace's time zone. Server and browser get the
 * same text (no locale/zone from the environment), so there is no hydration mismatch.
 */
export function formatQueueTime(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: timeZone || "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date) + " UTC";
  }
}

/** A job still Pending this long after upload has almost certainly stalled. */
export const STALLED_AFTER_MS = 10 * 60 * 1000;
