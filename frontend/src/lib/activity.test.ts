import { describe, expect, it } from "vitest";
import {
  activityText, dayLabel, describeActivity, groupByDay, guestLinkStatus, mergePages, timeAgo, toDashboardRow,
  type ActivityEntry,
} from "./activity";

const NOW = new Date(2026, 9, 3, 15, 0); // Sat, Oct 3 2026, 15:00 local
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString();

const entry = (action: string, extra: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id: `${action}-${Math.random()}`, created_at: at(3, 12), action, category: "tasks",
  actor: { type: "user", id: "u1", name: "Maya", initials: "M", avatar_url: null },
  verb: "", object: { type: "task", id: "t1", label: "Hero 30s", href: "/tasks?task=t1" },
  project: { id: "p1", name: "Spring Launch" }, before: null, after: null, detail: {}, team_only: false, summary: "",
  ...extra,
});
const text = (item: ActivityEntry) => activityText(describeActivity(item, NOW));

describe("wording", () => {
  it("says a task stage move with from → to", () => {
    expect(text(entry("task.stage.moved", { before: "Review", after: "Client Review", detail: { to_kind: "client_review" } })))
      .toBe("Maya moved 'Hero 30s' from Review → Client Review");
  });

  it("splits the sentence so the UI can set the stages apart", () => {
    const line = describeActivity(entry("task.stage.moved", { before: "Review", after: "Client Review" }), NOW);
    expect(line).toMatchObject({ actor: "Maya", verb: "moved", subject: "Hero 30s", change: { from: "Review", to: "Client Review" } });
  });

  it("notes a move caused by deleting a stage", () => {
    expect(text(entry("task.stage.moved", { before: "Revisions", after: "In Progress", detail: { reason: "stage_deleted" } })))
      .toBe("Maya moved 'Hero 30s' from Revisions → In Progress · stage was deleted");
  });

  it("words the other task events", () => {
    expect(text(entry("task.created", { after: "To Do" }))).toBe("Maya created 'Hero 30s' in To Do");
    expect(text(entry("task.assigned", { after: "Sam", detail: { assignee: "Sam" } }))).toBe("Maya assigned 'Hero 30s' to Sam");
    expect(text(entry("task.unassigned", { before: "Sam", detail: { assignee: "Sam" } }))).toBe("Maya unassigned Sam from 'Hero 30s'");
  });

  it("words due date changes, including set and cleared", () => {
    expect(text(entry("task.due_date.changed", { before: "2026-10-10T17:00:00Z", after: "2026-10-14T17:00:00Z" })))
      .toBe("Maya changed the due date of 'Hero 30s' from Oct 10 → Oct 14");
    expect(text(entry("task.due_date.changed", { before: null, after: "2026-10-14T17:00:00Z" }))).toBe("Maya set the due date of 'Hero 30s' to Oct 14");
    expect(text(entry("task.due_date.changed", { before: "2026-10-14T17:00:00Z", after: null }))).toBe("Maya cleared the due date of 'Hero 30s'");
    expect(text(entry("task.due_date.changed", { before: "2026-10-10T17:00:00Z", after: "2027-01-04T17:00:00Z" })))
      .toBe("Maya changed the due date of 'Hero 30s' from Oct 10 → Jan 4, 2027");
  });

  it("words the client opening a review link with the cut and its decision", () => {
    const guest = { type: "guest" as const, id: null, name: "Client", initials: "C", avatar_url: null };
    expect(text(entry("guest.media.viewed", { category: "guests", actor: guest, detail: { version_number: 2, decision: null } })))
      .toBe("Client opened review link · V2 · no decision yet");
    expect(text(entry("guest.media.viewed", { category: "guests", actor: guest, detail: { version_number: 3, decision: "approved" } })))
      .toBe("Client opened review link · V3 · approved");
    expect(text(entry("guest.link.opened", { category: "guests", actor: guest, object: { type: "guest_invite", id: "i", label: "Spring review", href: null } })))
      .toBe("Client opened review link 'Spring review'");
  });

  it("words media and review events with the version", () => {
    const cut = { type: "media_version", id: "m", label: "Hero 30s", href: "/review?project=p1&version=m" };
    expect(text(entry("media.uploaded", { category: "media", object: cut, detail: { version_number: 2 } }))).toBe("Maya uploaded 'Hero 30s' V2");
    expect(text(entry("media.workflow.transitioned", { category: "media", object: cut, before: "In Review", after: "Approved", detail: { version_number: 2, decision: "approved" } })))
      .toBe("Maya approved 'Hero 30s' V2");
    expect(text(entry("media.workflow.transitioned", { category: "media", object: cut, before: "Queued", after: "In Review", detail: { version_number: 2 } })))
      .toBe("Maya moved 'Hero 30s' V2 from Queued → In Review");
    expect(text(entry("media.revision.requested", { category: "media", object: cut, detail: { version_number: 2 } }))).toBe("Maya requested changes on 'Hero 30s' V2");
    expect(text(entry("review.comment.created", { category: "comments", object: cut, detail: { version_number: 2 } }))).toBe("Maya commented on 'Hero 30s' V2");
    expect(text(entry("review.comment.created", { category: "comments", object: cut, detail: { version_number: 2, reply: true } }))).toBe("Maya replied on 'Hero 30s' V2");
    expect(text(entry("review.comment.resolved", { category: "comments", object: cut, detail: { version_number: 2 } }))).toBe("Maya resolved a note on 'Hero 30s' V2");
  });

  it("words guest link management", () => {
    const link = { type: "guest_invite", id: "i", label: "Spring review", href: null };
    expect(text(entry("guest.invite.created", { object: link }))).toBe("Maya created review link 'Spring review'");
    expect(text(entry("guest.invite.revoked", { object: link }))).toBe("Maya revoked review link 'Spring review'");
    expect(text(entry("guest.access.revoked", { object: link, detail: { guest_name: "Dana" } }))).toBe("Maya revoked Dana’s access to 'Spring review'");
  });

  it("falls back to the server's sentence for an action it does not know", () => {
    expect(text(entry("something.new", { summary: "Maya did a new thing" }))).toBe("Maya did a new thing");
  });
});

describe("grouping by day", () => {
  it("labels today, yesterday and older days, newest first", () => {
    const days = groupByDay([
      entry("a", { id: "today-early", created_at: at(3, 8) }),
      entry("a", { id: "yesterday", created_at: at(2, 18) }),
      entry("a", { id: "today-late", created_at: at(3, 14, 30) }),
      entry("a", { id: "sep", created_at: new Date(2026, 8, 28, 10).toISOString() }),
    ], NOW);
    expect(days.map((day) => day.label)).toEqual(["Today", "Yesterday", "Mon, Sep 28"]);
    expect(days[0].entries.map((item) => item.id)).toEqual(["today-late", "today-early"]);
  });

  it("splits at local midnight, not UTC", () => {
    const days = groupByDay([
      entry("a", { id: "late", created_at: new Date(2026, 9, 2, 23, 59).toISOString() }),
      entry("a", { id: "early", created_at: new Date(2026, 9, 3, 0, 1).toISOString() }),
    ], NOW);
    expect(days.map((day) => [day.label, day.entries.map((item) => item.id)])).toEqual([["Today", ["early"]], ["Yesterday", ["late"]]]);
  });

  it("shows the year on a day from another year", () => {
    expect(dayLabel(new Date(2025, 11, 30), NOW)).toBe("Tue, Dec 30, 2025");
  });

  it("drops rows repeated across pages", () => {
    const first = [entry("a", { id: "1" }), entry("a", { id: "2" })];
    const merged = mergePages(first, [entry("a", { id: "2" }), entry("a", { id: "3" })]);
    expect(merged.map((item) => item.id)).toEqual(["1", "2", "3"]);
    expect(groupByDay([...first, ...first], NOW)[0].entries).toHaveLength(2);
  });
});

describe("guest link status", () => {
  const base = { visits: 3, last_media_version_id: "m", last_opened_at: new Date(NOW.getTime() - 2 * 86400000).toISOString() };
  it("reads like the share panel says it", () => {
    expect(guestLinkStatus({ ...base, last_version_number: 2, decision: null }, NOW)).toBe("Opened 2 days ago · V2 · no decision yet");
    expect(guestLinkStatus({ ...base, last_version_number: 2, decision: "changes_requested" }, NOW)).toBe("Opened 2 days ago · V2 · changes requested");
    expect(guestLinkStatus({ ...base, last_version_number: null, decision: null }, NOW)).toBe("Opened 2 days ago");
    expect(guestLinkStatus({ ...base, last_opened_at: null, last_version_number: null, decision: null }, NOW)).toBe("Not opened yet");
    expect(guestLinkStatus(null, NOW)).toBe("Not opened yet");
  });

  it("counts time ago in words", () => {
    expect(timeAgo(new Date(NOW.getTime() - 30000).toISOString(), NOW)).toBe("just now");
    expect(timeAgo(new Date(NOW.getTime() - 60000).toISOString(), NOW)).toBe("1 minute ago");
    expect(timeAgo(new Date(NOW.getTime() - 3 * 3600000).toISOString(), NOW)).toBe("3 hours ago");
    expect(timeAgo(new Date(NOW.getTime() - 30 * 3600000).toISOString(), NOW)).toBe("yesterday");
  });
});

describe("dashboard rows", () => {
  it("reuse the timeline's wording", () => {
    const row = toDashboardRow(entry("task.stage.moved", { before: "Review", after: "Client Review", created_at: new Date(NOW.getTime() - 3600000).toISOString() }), NOW);
    expect(row).toMatchObject({ actor: "Maya", action: "moved 'Hero 30s' from Review → Client Review", detail: "1 hour ago · Spring Launch", href: "/tasks?task=t1", tone: "neutral" });
  });
});
