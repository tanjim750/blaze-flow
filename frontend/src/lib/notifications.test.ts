import { describe, expect, it } from "vitest";
import {
  badgeCount, clip, dayLabel, describeNotification, groupByDay, initialsOf, markRead, notificationHref, sentence, timeLabel,
  type NotificationItem,
} from "./notifications";

const TZ = "Europe/London";
// Saturday 3 Oct 2026, 21:10 BST.
const NOW = new Date("2026-10-03T20:10:00Z");

function item(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: "n1", kind: "REVIEW_COMMENT_NEW", workspace_id: "w1",
    actor: { id: "u1", email: "maya@northlight.studio", name: "Maya Chen", initials: "MC", avatar_url: null, is_guest: false },
    entity_type: "review_comment", entity_id: "c1",
    payload: { media_title: "Spring Launch Hero", version_number: 2, excerpt: "Logo pops in early", project_id: "p1", media_version_id: "v2" },
    link: "/review?media=f2&comment=c1&t=12500", snippet: "Logo pops in early", poster_url: "/api/poster",
    unread: true, read_at: null, created_at: "2026-10-03T19:55:00Z",
    ...overrides,
  };
}

describe("describeNotification", () => {
  it("words each kind plainly with the cut and version", () => {
    const cases: [string, string][] = [
      ["REVIEW_COMMENT_NEW", "Maya Chen commented on Spring Launch Hero · V2"],
      ["REVIEW_COMMENT_REPLY", "Maya Chen replied to your note on Spring Launch Hero · V2"],
      ["REVIEW_COMMENT_MENTION", "Maya Chen mentioned you on Spring Launch Hero · V2"],
      ["MEDIA_VERSION_NEW", "Maya Chen uploaded a new version: Spring Launch Hero · V2"],
      ["MEDIA_APPROVED", "Maya Chen approved Spring Launch Hero · V2"],
      ["MEDIA_CHANGES_REQUESTED", "Maya Chen requested changes on Spring Launch Hero · V2"],
    ];
    for (const [kind, expected] of cases) expect(sentence(describeNotification(item({ kind })))).toBe(expected);
  });

  it("words a client drop as one row with the count, project and route", () => {
    const many = describeNotification(item({
      kind: "CLIENT_UPLOAD_RECEIVED", actor: null, entity_type: "client_upload_batch", snippet: null, link: "/files?folder=f1",
      payload: { actor_name: "Rachel Kim", file_count: 3, file_names: ["a.mov", "b.pdf", "c.png"], project_name: "Spring Launch", upload_link_label: "Send us your footage" },
    }));
    expect(sentence(many)).toBe("Rachel Kim sent 3 files to Spring Launch");
    expect(many.tone).toBe("upload");
    expect(many.snippet).toBe("a.mov, b.pdf, c.png");
    expect(many.href).toBe("/files?folder=f1");
    const one = describeNotification(item({
      kind: "CLIENT_UPLOAD_RECEIVED", snippet: null, payload: { file_count: 1, file_names: ["brand-guide.pdf"], project_name: "Spring Launch" },
    }));
    expect(sentence(one)).toBe("Maya Chen sent “brand-guide.pdf” to Spring Launch");
    expect(one.snippet).toBeNull();
  });

  it("names tasks in quotes and links to them", () => {
    const row = describeNotification(item({ kind: "TASK_ASSIGNED", entity_type: "task_assignee", payload: { title: "Cut the 15s version", task_id: "t9" }, link: null }));
    expect(sentence(row)).toBe("Maya Chen assigned you “Cut the 15s version”");
    expect(row.href).toBe("/tasks?task=t9");
    expect(row.tone).toBe("task");
  });

  it("marks team-only notes in the wording", () => {
    const row = describeNotification(item({ payload: { media_title: "Hero", team_only: true } }));
    expect(row.verb).toBe("left a team-only note on");
  });

  it("uses a guest's name and initials when there is no user", () => {
    const row = describeNotification(item({ actor: { id: null, email: null, name: "Dana Guest", is_guest: true } }));
    expect(row.actor).toBe("Dana Guest");
    expect(row.initials).toBe("DG");
  });

  it("falls back to 'Someone' and never borrows another kind's sentence", () => {
    const row = describeNotification(item({ kind: "SOMETHING_NEW", actor: null, payload: {} }));
    expect(row.actor).toBe("Someone");
    expect(row.verb).toBe("sent a notification (something new)");
  });

  it("carries the snippet, poster and unread state through", () => {
    const row = describeNotification(item());
    expect(row.snippet).toBe("Logo pops in early");
    expect(row.posterUrl).toBe("/api/poster");
    expect(row.unread).toBe(true);
  });
});

describe("notificationHref", () => {
  it("prefers the API's deep link", () => {
    expect(notificationHref(item())).toBe("/review?media=f2&comment=c1&t=12500");
  });
  it("rebuilds a review link for rows written before links existed", () => {
    expect(notificationHref(item({ link: null, payload: { project_id: "p1", media_version_id: "v2", review_comment_id: "c1" } })))
      .toBe("/review?project=p1&version=v2&comment=c1");
  });
  it("ignores links that are not app paths", () => {
    expect(notificationHref(item({ link: "https://evil.example/", payload: {} }))).toBeNull();
  });
});

describe("day grouping", () => {
  const rows = [
    { id: "a", createdAt: "2026-10-03T19:55:00Z" }, // today, 20:55 BST
    { id: "b", createdAt: "2026-10-02T23:30:00Z" }, // 00:30 BST on the 3rd: still today in London
    { id: "c", createdAt: "2026-10-02T08:00:00Z" }, // yesterday
    { id: "d", createdAt: "2026-09-29T10:00:00Z" }, // Tuesday this week
    { id: "e", createdAt: "2026-09-20T10:00:00Z" }, // older
    { id: "f", createdAt: "2025-12-24T10:00:00Z" }, // last year
  ];

  it("labels Today, Yesterday, weekdays, then dates (with the year when it differs)", () => {
    const groups = groupByDay(rows, NOW, TZ);
    expect(groups.map((group) => group.label)).toEqual(["Today", "Yesterday", "Tuesday", "20 Sept", "24 Dec 2025"]);
    expect(groups[0].items.map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("groups by the viewer's calendar day, not UTC's", () => {
    expect(groupByDay(rows.slice(0, 2), NOW, "UTC").map((group) => group.label)).toEqual(["Today", "Yesterday"]);
  });

  it("sorts newest first even when rows arrive out of order", () => {
    const groups = groupByDay([...rows].reverse(), NOW, TZ);
    expect(groups[0].items[0].id).toBe("a");
    expect(groups.at(-1)?.label).toBe("24 Dec 2025");
  });

  it("returns no groups for no rows", () => {
    expect(groupByDay([], NOW, TZ)).toEqual([]);
  });

  it("dayLabel treats a future timestamp (clock skew) as today", () => {
    expect(dayLabel("2026-10-03T20:20:00Z", NOW, TZ)).toBe("Today");
  });
});

describe("formatting", () => {
  it("shows relative time today and a clock time before", () => {
    expect(timeLabel("2026-10-03T20:09:40Z", NOW, TZ)).toBe("now");
    expect(timeLabel("2026-10-03T19:55:00Z", NOW, TZ)).toBe("15m");
    expect(timeLabel("2026-10-03T17:10:00Z", NOW, TZ)).toBe("3h");
    expect(timeLabel("2026-10-02T08:00:00Z", NOW, TZ)).toBe("09:00");
  });

  it("caps the badge and hides it at zero", () => {
    expect(badgeCount(0)).toBeNull();
    expect(badgeCount(7)).toBe("7");
    expect(badgeCount(140)).toBe("99+");
  });

  it("clips long text on a word-ish boundary with an ellipsis", () => {
    expect(clip("a".repeat(10), 5)).toBe("aaaa…");
    expect(clip("  spaced   out  ", 50)).toBe("spaced out");
  });

  it("makes initials from one or many names", () => {
    expect(initialsOf("Maya Chen")).toBe("MC");
    expect(initialsOf("Priya")).toBe("P");
    expect(initialsOf("  ")).toBe("?");
    expect(initialsOf("Mary Ann Lee")).toBe("ML");
  });

  it("marks one or all rows read without touching read ones", () => {
    const items = [item({ id: "x" }), item({ id: "y" }), item({ id: "z", unread: false, read_at: "2026-10-01T00:00:00Z" })];
    const one = markRead(items, new Set(["x"]), "2026-10-03T20:00:00Z");
    expect(one.map((row) => row.unread)).toEqual([false, true, false]);
    const all = markRead(items, "all", "2026-10-03T20:00:00Z");
    expect(all.every((row) => !row.unread)).toBe(true);
    expect(all[2].read_at).toBe("2026-10-01T00:00:00Z");
  });
});

describe("client decisions", () => {
  it("say it was the client's sign-off, naming the guest", () => {
    const guest = item({
      kind: "MEDIA_APPROVED", actor: null, entity_type: "review_decision",
      payload: { media_title: "Spring Launch Hero", version_number: 3, client_decision: true, actor_name: "Rachel Kim" },
    });
    expect(sentence(describeNotification(guest))).toBe("Rachel Kim approved as the client: Spring Launch Hero · V3");
    const changes = item({ kind: "MEDIA_CHANGES_REQUESTED", payload: { media_title: "Spring Launch Hero", version_number: 2, client_decision: true } });
    expect(sentence(describeNotification(changes))).toBe("Maya Chen requested changes as the client on Spring Launch Hero · V2");
  });
});

describe("project request notifications", () => {
  const base = (extra: Partial<NotificationItem>): NotificationItem => ({
    id: "n", kind: "PROJECT_REQUEST_NEW", workspace_id: "w", actor: { id: "u", email: "sam@client.example", name: "Sam Lee" },
    entity_type: "project_request", entity_id: "r1", payload: {}, link: "/clients/requests", snippet: null,
    unread: true, read_at: null, created_at: "2026-10-04T10:00:00Z", ...extra,
  });

  it("words a new request for the studio", () => {
    const row = describeNotification(base({ payload: { title: "Summer menu launch", client_team_name: "Northlight Coffee" } }));
    expect(sentence(row)).toBe("Sam Lee asked for a new project: “Summer menu launch” (Northlight Coffee)");
    expect(row.tone).toBe("request");
    expect(row.href).toBe("/clients/requests");
  });

  it("words the answer for the client, quoting a decline note", () => {
    const accepted = describeNotification(base({ kind: "PROJECT_REQUEST_DECIDED", actor: { id: "a", email: "alex@x", name: "Alex" }, payload: { title: "Summer", status: "accepted" }, link: "/portal/projects/p1" }));
    expect(sentence(accepted)).toBe("Alex accepted your project request “Summer”");
    const declined = describeNotification(base({ kind: "PROJECT_REQUEST_DECIDED", actor: { id: "a", email: "alex@x", name: "Alex" }, payload: { title: "Summer", status: "declined", decision_note: "Booked in July" } }));
    expect(sentence(declined)).toBe("Alex declined your project request “Summer”");
    expect(declined.snippet).toBe("Booked in July");
  });
});
