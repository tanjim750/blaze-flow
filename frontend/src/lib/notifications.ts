/**
 * Pure helpers for the notifications centre: what each notification says, where it goes,
 * and how a list of them is grouped by day. No React and no fetch, so the bell, the
 * /notifications page and the tests all read from the same rules.
 */

export type NotificationActor = {
  id: string | null; email: string | null; name: string;
  initials?: string; avatar_url?: string | null; is_guest?: boolean;
};

export type NotificationItem = {
  id: string; kind: string; workspace_id: string | null;
  actor: NotificationActor | null;
  entity_type: string | null; entity_id: string | null;
  payload: Record<string, unknown> | null;
  /** The page this opens. Built by the API; null only for a kind it cannot place. */
  link?: string | null;
  snippet?: string | null;
  /** Permission-checked poster route for the cut, once one exists. */
  poster_url?: string | null;
  unread: boolean; read_at: string | null; created_at: string;
};

export type NotificationPage = {
  results: NotificationItem[]; count: number; unread_count: number;
  page: number; page_size: number; has_next: boolean;
};

export type NotificationTone = "comment" | "reply" | "mention" | "version" | "approved" | "changes" | "task" | "upload" | "request" | "other";

/** One rendered row: "<actor> <verb> <subject>", plus the quoted snippet. */
export type DescribedNotification = {
  id: string;
  actor: string;
  initials: string;
  avatarUrl: string | null;
  verb: string;
  subject: string | null;
  snippet: string | null;
  href: string | null;
  posterUrl: string | null;
  tone: NotificationTone;
  unread: boolean;
  createdAt: string;
};

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

export function clip(value: string, max = 120): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return `${parts[0].charAt(0)}${parts.length > 1 ? parts[parts.length - 1].charAt(0) : ""}`.toUpperCase();
}

/** "Hero 30s · V2", or just the title when the version number is unknown. */
function cutLabel(payload: Record<string, unknown>): string | null {
  const title = text(payload.media_title);
  const version = num(payload.version_number);
  if (!title) return version ? `V${version}` : null;
  return version ? `${clip(title, 48)} · V${version}` : clip(title, 48);
}

/** Older rows have no `link`; rebuild the same address the API would. */
export function notificationHref(item: NotificationItem): string | null {
  if (item.link && item.link.startsWith("/")) return item.link;
  const payload = item.payload ?? {};
  const task = text(payload.task_id) ?? (item.entity_type === "task" ? item.entity_id : null);
  if (task) return `/tasks?task=${encodeURIComponent(task)}`;
  const project = text(payload.project_id);
  const version = text(payload.media_version_id);
  if (project) {
    const query = new URLSearchParams({ project });
    if (version) query.set("version", version);
    const comment = text(payload.review_comment_id);
    if (comment) query.set("comment", comment);
    return `/review?${query.toString()}`;
  }
  return null;
}

export function describeNotification(item: NotificationItem): DescribedNotification {
  const payload = item.payload ?? {};
  const actor = item.actor?.name?.trim() || item.actor?.email || text(payload.actor_name) || "Someone";
  const cut = cutLabel(payload);
  const title = text(payload.title);
  const stage = text(payload.stage_name);
  const teamOnly = payload.team_only === true;
  const base = {
    id: item.id,
    actor,
    initials: item.actor?.initials || initialsOf(actor),
    avatarUrl: item.actor?.avatar_url ?? null,
    snippet: text(item.snippet) ?? text(payload.excerpt),
    href: notificationHref(item),
    posterUrl: item.poster_url ?? null,
    unread: item.unread,
    createdAt: item.created_at,
  };
  switch (item.kind) {
    case "REVIEW_COMMENT_MENTION":
      return { ...base, tone: "mention", verb: "mentioned you on", subject: cut ?? "a review" };
    case "REVIEW_COMMENT_REPLY":
      return { ...base, tone: "reply", verb: teamOnly ? "replied to your note (team only) on" : "replied to your note on", subject: cut ?? "a review" };
    case "REVIEW_COMMENT_NEW":
      return { ...base, tone: "comment", verb: teamOnly ? "left a team-only note on" : "commented on", subject: cut ?? "your cut" };
    case "MEDIA_VERSION_NEW":
      return { ...base, tone: "version", verb: "uploaded a new version:", subject: cut ?? "a new cut" };
    // A client decision (from a review link or a client-team member) says so: it is the
    // client's sign-off on exactly that version, not a studio stage move.
    case "MEDIA_APPROVED":
      return { ...base, tone: "approved", verb: payload.client_decision === true ? "approved as the client:" : "approved", subject: cut ?? "your cut" };
    case "MEDIA_CHANGES_REQUESTED":
      return { ...base, tone: "changes", verb: payload.client_decision === true ? "requested changes as the client on" : "requested changes on", subject: cut ?? "your cut" };
    case "TASK_ASSIGNED":
      return { ...base, tone: "task", verb: "assigned you", subject: title ? `“${clip(title, 60)}”` : "a task" };
    case "CLIENT_UPLOAD_RECEIVED": {
      // One row per drop: "Rachel Kim sent 3 files to Spring Launch" (or the one file's name).
      const count = num(payload.file_count) ?? 1;
      const names = Array.isArray(payload.file_names) ? payload.file_names.filter((name): name is string => typeof name === "string") : [];
      const project = text(payload.project_name);
      const what = count === 1 && names[0] ? `“${clip(names[0], 48)}”` : `${count} files`;
      return {
        ...base, tone: "upload", verb: "sent", subject: project ? `${what} to ${project}` : what,
        // The row quotes the snippet, so it carries the file names (the newest five).
        snippet: count > 1 && names.length ? clip(names.join(", "), 120) : null,
      };
    }
    case "PROJECT_REQUEST_NEW": {
      // "Sam Lee asked for a new project: “Summer menu launch” (Northlight Coffee)".
      const team = text(payload.client_team_name);
      return { ...base, tone: "request", verb: "asked for a new project:", subject: `${title ? `“${clip(title, 60)}”` : "a new project"}${team ? ` (${team})` : ""}`, snippet: null };
    }
    case "PROJECT_REQUEST_DECIDED": {
      const accepted = payload.status === "accepted";
      return {
        ...base, tone: "request", verb: accepted ? "accepted your project request" : "declined your project request",
        subject: title ? `“${clip(title, 60)}”` : null, snippet: text(payload.decision_note),
      };
    }
    case "TASK_CLIENT_READY":
      return { ...base, tone: "task", verb: "marked ready for your review:", subject: title ? `“${clip(title, 60)}”` : "a task" };
    default: {
      const named = item.kind.toLowerCase().replaceAll(/[._]+/g, " ").trim();
      return { ...base, tone: "other", verb: `sent a notification (${named})`, subject: stage };
    }
  }
}

/** The plain sentence, for aria-labels and titles. */
export const sentence = (row: DescribedNotification) => [row.actor, row.verb, row.subject].filter(Boolean).join(" ");

/** Badge text: nothing at zero, "99+" past 99. */
export const badgeCount = (count: number) => (count <= 0 ? null : count > 99 ? "99+" : String(count));

function dayKey(date: Date, timeZone?: string): string {
  // en-CA formats as YYYY-MM-DD, which sorts and compares as a string.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function daysBetween(fromKey: string, toKey: string): number {
  const a = Date.UTC(+fromKey.slice(0, 4), +fromKey.slice(5, 7) - 1, +fromKey.slice(8, 10));
  const b = Date.UTC(+toKey.slice(0, 4), +toKey.slice(5, 7) - 1, +toKey.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** "Today", "Yesterday", a weekday within the week, else "28 Sep" (with the year if not this year). */
export function dayLabel(iso: string, now: Date, timeZone?: string): string {
  const date = new Date(iso);
  const key = dayKey(date, timeZone);
  const today = dayKey(now, timeZone);
  const ago = daysBetween(key, today);
  if (ago <= 0) return "Today";
  if (ago === 1) return "Yesterday";
  if (ago < 7) return new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long" }).format(date);
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) }).format(date);
}

/** "now", "5m", "3h" today; "14:32" for older rows, which sit under a day heading anyway. */
export function timeLabel(iso: string, now: Date, timeZone?: string): string {
  const date = new Date(iso);
  const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (dayKey(date, timeZone) === dayKey(now, timeZone)) {
    if (seconds < 60) return "now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h`;
  }
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(date);
}

export type NotificationGroup<T> = { key: string; label: string; items: T[] };

/**
 * Groups rows by calendar day in `timeZone` (the browser's when omitted), newest day
 * first, keeping the order rows arrive in within a day.
 */
export function groupByDay<T extends { createdAt: string }>(rows: T[], now: Date, timeZone?: string): NotificationGroup<T>[] {
  const groups = new Map<string, NotificationGroup<T>>();
  const sorted = [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const row of sorted) {
    const key = dayKey(new Date(row.createdAt), timeZone);
    const group = groups.get(key);
    if (group) group.items.push(row);
    else groups.set(key, { key, label: dayLabel(row.createdAt, now, timeZone), items: [row] });
  }
  return [...groups.values()];
}

/** Marks rows read locally after the API agreed, without refetching. */
export function markRead<T extends { id: string; unread: boolean; read_at: string | null }>(items: T[], ids: Set<string> | "all", at: string): T[] {
  return items.map((item) => (ids === "all" || ids.has(item.id)) && item.unread ? { ...item, unread: false, read_at: at } : item);
}
