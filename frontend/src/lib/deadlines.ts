const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The work due between now and `windowDays` from now, soonest first.
 *
 * The dashboard panel is titled "Next 7 Days", but it used to take the first five open
 * tasks in whatever order the API returned them — undated tasks and tasks due next month
 * included — so the list was neither upcoming nor in date order.
 */
export function upcomingDeadlines<T extends { due_at: string | null }>(items: T[], now: Date, windowDays = 7, limit = 5): T[] {
  const start = now.getTime();
  const end = start + windowDays * DAY_MS;
  return items
    .map((item) => ({ item, due: item.due_at ? new Date(item.due_at).getTime() : Number.NaN }))
    .filter(({ due }) => Number.isFinite(due) && due >= start && due <= end)
    .sort((a, b) => a.due - b.due)
    .slice(0, limit)
    .map(({ item }) => item);
}
