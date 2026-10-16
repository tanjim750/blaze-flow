/**
 * The activity feed's wording, day grouping and the guest-link status line.
 *
 * Pure functions over what `GET …/activity/` returns, so the project timeline, the
 * dashboard's Recent Activity and the share panel all say the same thing the same way.
 * The API already decides who may see a row; nothing here filters for permissions.
 */

export type ActivityCategory = "tasks" | "comments" | "media" | "guests" | "uploads";
/** `client` is someone who sent files through a public upload link (no account). */
export type ActivityActor = { type: "user" | "guest" | "client" | "system"; id: string | null; name: string; initials: string; avatar_url: string | null };
export type ActivityObject = { type: string; id: string | null; label: string; href: string | null };
export type Decision = "approved" | "changes_requested" | null;

export type ActivityEntry = {
  id: string;
  created_at: string;
  action: string;
  category: ActivityCategory | null;
  actor: ActivityActor;
  verb: string;
  object: ActivityObject | null;
  project: { id: string; name: string } | null;
  before: string | null;
  after: string | null;
  detail: {
    version_number?: number | null; excerpt?: string | null; reply?: boolean; decision?: Decision;
    stage_kind?: string | null; from_kind?: string | null; to_kind?: string | null; reason?: string | null;
    assignee?: string; guest_name?: string | null; media_title?: string;
    client_decision?: boolean; open_notes_count?: number | null; allow_decisions?: boolean;
    via?: "link" | "portal" | null; link_label?: string | null;
  };
  team_only: boolean;
  /** The server's own one-line wording (what the CSV export uses). */
  summary: string;
};

export type ActivityPage = {
  results: ActivityEntry[]; count: number; page: number; page_size: number; has_next: boolean; can_export: boolean;
};

/** The type filter chips, in display order. `null` is "everything". */
export const ACTIVITY_FILTERS: { value: ActivityCategory | null; label: string }[] = [
  { value: null, label: "All" },
  { value: "tasks", label: "Tasks" },
  { value: "comments", label: "Comments" },
  { value: "media", label: "Uploads & approvals" },
  { value: "guests", label: "Client links" },
  { value: "uploads", label: "Client files" },
];

export const DECISION_LABELS: Record<"approved" | "changes_requested" | "none", string> = {
  approved: "approved",
  changes_requested: "changes requested",
  none: "no decision yet",
};
const decisionLabel = (decision: Decision | undefined) => DECISION_LABELS[decision ?? "none"];

/** One sentence in pieces, so the UI can bold the actor and set the stages apart. */
export type ActivityLine = {
  /** Bold lead: who did it. */
  actor: string;
  /** Plain text after the actor, e.g. "moved". */
  verb: string;
  /** The quoted object, e.g. "Hero 30s" (rendered in quotes). Null when the verb says it all. */
  subject: string | null;
  /** Trailing words between subject and stages (e.g. "V2", "to Sam"). */
  tail: string | null;
  /** `from → to`, when something changed state. */
  change: { from: string; to: string } | null;
  /** Dot-separated trailers: "V2", "no decision yet". */
  meta: string[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Oct 14" (with the year when it is not this year). Invalid → "?". */
export function shortDate(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "none";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "?";
  const base = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === now.getFullYear() ? base : `${base}, ${date.getFullYear()}`;
}

const version = (entry: ActivityEntry) => (entry.detail.version_number ? `V${entry.detail.version_number}` : null);
const openNotesMeta = (entry: ActivityEntry) => {
  const count = entry.detail.open_notes_count;
  return typeof count === "number" && count > 0 ? [`${count} open ${count === 1 ? "note" : "notes"}`] : [];
};

export function describeActivity(entry: ActivityEntry, now: Date = new Date()): ActivityLine {
  const actor = entry.actor.name || "Someone";
  const subject = entry.object?.label ?? null;
  const line = (verb: string, extra: Partial<ActivityLine> = {}): ActivityLine => ({
    actor, verb, subject, tail: null, change: null, meta: [], ...extra,
  });
  const change = entry.before || entry.after ? { from: entry.before ?? "?", to: entry.after ?? "?" } : null;
  switch (entry.action) {
    case "task.created":
      return line("created", { tail: entry.after ? `in ${entry.after}` : null });
    case "task.stage.moved":
      return line("moved", { change, meta: entry.detail.reason === "stage_deleted" ? ["stage was deleted"] : [] });
    case "task.assigned":
      return line("assigned", { tail: `to ${entry.detail.assignee ?? entry.after ?? "someone"}` });
    case "task.unassigned":
      return { actor, verb: `unassigned ${entry.detail.assignee ?? entry.before ?? "someone"} from`, subject, tail: null, change: null, meta: [] };
    case "task.due_date.changed":
      if (!entry.before) return line("set the due date of", { tail: `to ${shortDate(entry.after, now)}` });
      if (!entry.after) return line("cleared the due date of");
      return line("changed the due date of", { change: { from: shortDate(entry.before, now), to: shortDate(entry.after, now) } });
    case "media.uploaded":
      return line("uploaded", { tail: version(entry) });
    case "media.revision.requested":
      return line("requested changes on", { tail: version(entry) });
    case "media.workflow.transitioned":
      if (entry.detail.decision === "approved") return line("approved", { tail: version(entry) });
      return line("moved", { tail: version(entry), change });
    case "review.comment.created":
      return line(entry.detail.reply ? "replied on" : "commented on", { tail: version(entry) });
    case "review.comment.resolved":
      return line("resolved a note on", { tail: version(entry) });
    case "review.comment.reopened":
      return line("reopened a note on", { tail: version(entry) });
    case "guest.invite.created":
      return line("created review link");
    case "guest.link.opened":
      return line("opened review link");
    case "guest.media.viewed":
      // "Dana opened review link · V2 · no decision yet": the cut is the link target.
      return { actor, verb: "opened review link", subject: null, tail: null, change: null,
        meta: [version(entry) ?? "a cut", decisionLabel(entry.detail.decision)] };
    case "guest.invite.revoked":
      return line("revoked review link");
    case "guest.invite.updated":
      return line(entry.verb || "changed review link");
    case "review.decision.approved":
      return line("approved", { tail: [version(entry), "as the client"].filter(Boolean).join(" "), meta: openNotesMeta(entry) });
    case "review.decision.changes_requested":
      return line("requested changes on", { tail: [version(entry), "as the client"].filter(Boolean).join(" ") });
    case "client_upload.received":
      return line("sent", { tail: entry.detail.link_label ? `via ${entry.detail.link_label}` : entry.detail.via === "portal" ? "from the client portal" : null });
    case "upload_link.created":
      return line("created upload link");
    case "upload_link.revoked":
      return line("turned off upload link");
    case "guest.access.revoked":
      return { actor, verb: `revoked ${entry.detail.guest_name ?? entry.before ?? "a guest"}’s access to`, subject, tail: null, change: null, meta: [] };
    default:
      return { actor, verb: entry.summary.startsWith(actor) ? entry.summary.slice(actor.length).trim() : entry.summary, subject: null, tail: null, change: null, meta: [] };
  }
}

/** The line as one plain string (for titles, screen readers and tests). */
export function activityText(line: ActivityLine): string {
  let text = `${line.actor} ${line.verb}`;
  if (line.subject) text += ` '${line.subject}'`;
  if (line.tail) text += ` ${line.tail}`;
  if (line.change) text += ` from ${line.change.from} → ${line.change.to}`;
  for (const part of line.meta) text += ` · ${part}`;
  return text;
}

// ------------------------------------------------------------------------- grouping

const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** "Today", "Yesterday", "Mon, Sep 28" or "Mon, Sep 28, 2025", in the viewer's time zone. */
export function dayLabel(date: Date, now: Date = new Date()): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const that = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((today.getTime() - that.getTime()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  const base = `${DAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === now.getFullYear() ? base : `${base}, ${date.getFullYear()}`;
}

/** "15:42": the feed's per-row clock, 24-hour like the rest of the app. */
export function clockTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export type ActivityDay = { key: string; label: string; entries: ActivityEntry[] };

/**
 * Newest day first, rows newest first inside each day. Rows with the same id (a page
 * loaded twice because something new arrived in between) appear once.
 */
export function groupByDay(entries: ActivityEntry[], now: Date = new Date()): ActivityDay[] {
  const seen = new Set<string>();
  const sorted = entries
    .filter((entry) => (seen.has(entry.id) ? false : (seen.add(entry.id), true)))
    .filter((entry) => !Number.isNaN(new Date(entry.created_at).getTime()))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const days: ActivityDay[] = [];
  for (const entry of sorted) {
    const date = new Date(entry.created_at);
    const key = dayKey(date);
    const last = days[days.length - 1];
    if (last && last.key === key) last.entries.push(entry);
    else days.push({ key, label: dayLabel(date, now), entries: [entry] });
  }
  return days;
}

/** Merge a freshly loaded page into what is shown, dropping repeats. */
export function mergePages(current: ActivityEntry[], next: ActivityEntry[]): ActivityEntry[] {
  const ids = new Set(current.map((entry) => entry.id));
  return [...current, ...next.filter((entry) => !ids.has(entry.id))];
}

// ---------------------------------------------------------------- guest link status

/** "just now", "5 minutes ago", "3 hours ago", "yesterday", "2 days ago". */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.max(0, Math.floor((now.getTime() - then) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export type GuestLinkActivity = {
  visits: number; last_opened_at: string | null; last_version_number: number | null;
  last_media_version_id: string | null;
  /** The latest decision a reviewer made through this link (never the team's own approval). */
  decision: Decision;
  decision_version_number?: number | null; decided_by?: string | null; decided_at?: string | null;
};

/**
 * "Opened 2 days ago · V2 · no decision yet", "Opened 1 hour ago · V3 · approved V3 · Rachel Kim · Oct 3",
 * or "Not opened yet".
 */
export function guestLinkStatus(activity: GuestLinkActivity | null | undefined, now: Date = new Date()): string {
  if (!activity?.last_opened_at && !activity?.decision) return "Not opened yet";
  const parts = activity.last_opened_at ? [`Opened ${timeAgo(activity.last_opened_at, now)}`] : [];
  if (activity.last_version_number) parts.push(`V${activity.last_version_number}`);
  if (activity.decision) {
    const label = decisionLabel(activity.decision);
    parts.push(activity.decision_version_number ? `${label} V${activity.decision_version_number}` : label);
    if (activity.decided_by) parts.push(activity.decided_by);
    if (activity.decided_at) parts.push(shortDate(activity.decided_at, now));
  } else if (activity.last_version_number) {
    parts.push(decisionLabel(null));
  }
  return parts.join(" · ");
}

// ----------------------------------------------------------------- dashboard rows

export type DashboardActivityTone = "neutral" | "accent" | "success" | "warning" | "blue";

/** A row for the dashboard's Recent Activity panel: "<actor> <action>" and a detail line. */
export function toDashboardRow(entry: ActivityEntry, now: Date = new Date()) {
  const line = describeActivity(entry, now);
  const action = activityText(line).slice(line.actor.length + 1);
  // A client's decision reads as the decision (green / amber), even when a guest made it.
  const tone: DashboardActivityTone = entry.detail.client_decision ? (entry.detail.decision === "approved" ? "success" : "warning")
    : entry.actor.type === "guest" || entry.actor.type === "client" ? "blue"
    : entry.detail.decision === "approved" ? "success"
      : entry.action === "media.revision.requested" || entry.detail.decision === "changes_requested" ? "warning"
        : entry.category === "comments" ? "accent" : "neutral";
  const where = entry.project?.name;
  const age = timeAgo(entry.created_at, now);
  return {
    id: entry.id,
    initials: entry.actor.initials || "?",
    avatarUrl: entry.actor.avatar_url,
    tone,
    actor: line.actor,
    action,
    detail: where ? `${age} · ${where}` : age,
    href: entry.object?.href ?? null,
  };
}
