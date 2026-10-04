import { describe, expect, it } from "vitest";
import {
  bodyParts, dayLabel, filterPeople, groupByDay, insertMention, mentionQuery, mentionedIds, mergeMessages, newestAt,
  threadHref, unreadLabel, type Message,
} from "./messages";
import { describeNotification } from "./notifications";

const msg = (id: string, created_at: string, extra: Partial<Message> = {}): Message => ({
  id, channel: "client", author: { id: "u1", name: "Alex Morgan", is_client: false }, body: id, mentions: [], reply_to: null,
  attachments: [], mine: false, can_edit: false, edited_at: null, deleted: false, created_at, ...extra,
});
const people = [
  { id: "a", name: "Alex Morgan", is_client: false },
  { id: "m", name: "Maya Chen", is_client: false },
  { id: "s", name: "Sam Lee", is_client: true },
];

describe("messages rules", () => {
  it("merges polled pages: appends new, replaces changed, keeps time order", () => {
    const current = [msg("1", "2026-10-04T10:00:00Z"), msg("2", "2026-10-04T10:01:00Z")];
    const merged = mergeMessages(current, [msg("3", "2026-10-04T10:02:00Z")], [msg("1", "2026-10-04T10:00:00Z", { body: "edited" })]);
    expect(merged.map((row) => row.id)).toEqual(["1", "2", "3"]);
    expect(merged[0].body).toBe("edited");
    expect(newestAt(merged)).toBe("2026-10-04T10:02:00Z");
    expect(newestAt([], "fallback")).toBe("fallback");
  });

  it("groups by London day and marks quick follow-ups from one author as continued", () => {
    const now = new Date("2026-10-04T12:00:00Z");
    const groups = groupByDay([
      msg("1", "2026-10-03T09:00:00Z"),
      msg("2", "2026-10-04T09:00:00Z"),
      msg("3", "2026-10-04T09:02:00Z"),
      msg("4", "2026-10-04T09:03:00Z", { author: { id: "u2", name: "Sam", is_client: true } }),
      msg("5", "2026-10-04T09:30:00Z", { author: { id: "u2", name: "Sam", is_client: true } }),
    ], now);
    expect(groups.map((group) => group.day)).toEqual(["Yesterday", "Today"]);
    expect(groups[1].items.map((item) => item.continued)).toEqual([false, true, false, false]);
    // 23:30 UTC on 4 Oct is 00:30 on 5 Oct in London.
    expect(dayLabel("2026-10-04T23:30:00Z", new Date("2026-10-05T08:00:00Z"))).toBe("Today");
  });

  it("finds, filters and inserts @mentions", () => {
    expect(mentionQuery("hi @ma", 6)).toEqual({ start: 3, query: "ma" });
    expect(mentionQuery("email@host", 10)).toBeNull();
    expect(filterPeople(people, "ch").map((person) => person.id)).toEqual(["m"]);
    const at = mentionQuery("ping @sa please", 8)!;
    const next = insertMention("ping @sa please", at, people[2]);
    expect(next.text).toBe("ping @Sam Lee  please");
    expect(mentionedIds(next.text, [people[2], people[1]])).toEqual(["s"]);
  });

  it("highlights only real mentions", () => {
    expect(bodyParts("@Maya Chen and @Nobody", ["m"], people)).toEqual([{ text: "@Maya Chen", mention: true }, { text: " and @Nobody" }]);
    expect(bodyParts("plain", [], people)).toEqual([{ text: "plain" }]);
  });

  it("links each viewer to their own copy of the thread", () => {
    expect(threadHref("p1", "client")).toBe("/portal/projects/p1#messages");
    expect(threadHref("p1", "team", "team")).toBe("/projects?campaign=p1&tab=messages&channel=team");
    expect(unreadLabel(140)).toBe("99+");
  });

  it("describes batched and mention notifications", () => {
    const base = { id: "n", workspace_id: "w", actor: { id: "u", email: "s@x", name: "Sam Lee" }, entity_type: "project_thread", entity_id: "p:client", unread: true, read_at: null, created_at: "2026-10-04T10:00:00Z" };
    const burst = describeNotification({ ...base, kind: "PROJECT_MESSAGE_NEW", payload: { project_name: "Spring Launch", channel: "client", message_count: 3, excerpt: "Hi" }, link: "/portal/projects/p#messages" });
    expect(burst.verb).toBe("sent 3 new messages in");
    expect(burst.subject).toBe("Spring Launch");
    expect(burst.tone).toBe("message");
    expect(burst.href).toBe("/portal/projects/p#messages");
    const team = describeNotification({ ...base, kind: "PROJECT_MESSAGE_MENTION", payload: { project_name: "Spring Launch", channel: "team" } });
    expect(team.verb).toBe("mentioned you in");
    expect(team.subject).toBe("Spring Launch (team only)");
  });
});
