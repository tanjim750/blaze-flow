/**
 * Value for a `datetime-local` input, in the viewer's local time.
 *
 * `toISOString()` is UTC, so filling the field from it showed a 17:00 BST due time as
 * 16:00 — and saving the form unchanged then moved the task an hour earlier. The field is
 * parsed back as local time (`new Date("YYYY-MM-DDTHH:mm")`), so it has to be filled that way.
 */
export function toDateTimeLocal(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A due date in the past, unless the work is already in a done stage. */
export function isOverdue(dueAt: string | null, done = false, now: number = Date.now()): boolean {
  return Boolean(!done && dueAt && new Date(dueAt).getTime() < now);
}
