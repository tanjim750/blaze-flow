/**
 * Project messages: types, the browser calls and the pure rules the thread uses
 * (merging polled pages, day groups, @mention parsing).
 *
 * Two channels per project. "client" is shared with the project's client; "team" never
 * leaves the studio: the API answers 404 to a client asking for it, so nothing here has to
 * hide it, only label it.
 */
import { call, type CallResult } from "./client-uploads";

export type Channel = "client" | "team";
export const CHANNEL_LABEL: Record<Channel, string> = { client: "With client", team: "Team only" };

export type MessageAttachment = {
  id: string; kind: "upload" | "file" | "cut"; name: string | null; mime_type: string | null;
  size_bytes: number | null; href: string | null; status: string | null; removed?: boolean;
};
export type Message = {
  id: string; channel: Channel;
  author: { id: string | null; name: string; is_client: boolean };
  body: string; mentions: string[];
  reply_to: { id: string; author_name: string; snippet: string; deleted: boolean } | null;
  attachments: MessageAttachment[];
  mine: boolean; can_edit: boolean; edited_at: string | null; deleted: boolean; created_at: string;
};
export type Person = { id: string; name: string; is_client: boolean };
export type Viewer = {
  kind: "team" | "client"; channels: Channel[]; can_post: boolean;
  can_link_files: boolean; can_link_cuts: boolean; has_client: boolean;
};
export type Thread = {
  project: { id: string; name: string }; channel: Channel; viewer: Viewer;
  messages: Message[]; changed: Message[]; has_more: boolean;
  unread: Partial<Record<Channel, number>>; mentionable: Person[]; server_time: string;
};
export type UnreadSummary = {
  total_unread: number;
  total_mentions?: number;
  projects: {
    project_id: string; project_name: string; client_name: string | null;
    unread: Partial<Record<Channel, number>>; total_unread: number; last_message_at: string | null;
    latest: { author_name: string; channel: Channel; snippet: string; created_at: string } | null;
    viewer_kind: "team" | "client"; chat_channel_id?: string;
    mentions?: Partial<Record<Channel, number>>;
  }[];
  sections?: ChatSection[];
  studio?: ChatChannelRow[];
};

export type ChatChannelRow = {
  id: string; kind: "general" | "project"; name: string;
  project_id: string | null; project_status: string | null;
  client_team_id: string | null; client_team_name: string | null;
  viewer_kind: "team" | "client"; sides: Channel[];
  unread: Partial<Record<Channel, number>>; mentions: Partial<Record<Channel, number>>;
  total_unread: number; total_mentions: number; team_unread: number;
  last_message_at: string | null;
  latest: { author_name: string; channel: Channel; snippet: string; created_at: string } | null;
  is_past: boolean;
};
export type ChatSection = {
  id: string; name: string; channels: ChatChannelRow[]; past: ChatChannelRow[];
  total_unread: number; total_mentions: number;
};
export type ChatList = {
  sections: ChatSection[]; studio: ChatChannelRow[]; total_unread: number; total_mentions: number;
};
export type ChatSearchResult = {
  query: string;
  results: {
    message_id: string; chat_channel_id: string; channel: Channel; channel_name: string;
    client_team_name: string | null; project_name: string | null;
    author_name: string; author_is_client: boolean; snippet: string; created_at: string; team_only: boolean;
  }[];
};
export type PostInput = {
  channel: Channel; body: string; reply_to_id?: string | null; mention_user_ids?: string[];
  attachment_ids?: string[]; project_file_ids?: string[]; media_version_ids?: string[];
};

export const BODY_MAX = 5000;
export const MAX_ATTACHMENTS = 10;

// ---------------------------------------------------------------- browser calls

/** Target either a Slack-style chat channel or the legacy project alias. */
export type ThreadTarget = { workspaceId: string; chatChannelId: string; projectId?: string } | { workspaceId: string; projectId: string; chatChannelId?: undefined };

const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const messagesPath = (target: ThreadTarget) => target.chatChannelId
  ? `/workspaces/${target.workspaceId}/chat/channels/${target.chatChannelId}/messages/`
  : `/workspaces/${target.workspaceId}/projects/${target.projectId}/messages/`;

export function fetchThread(target: ThreadTarget, channel: Channel, options: { after?: string; before?: string } = {}): Promise<CallResult<Thread>> {
  const query = new URLSearchParams({ channel });
  if (options.after) query.set("after", options.after);
  if (options.before) query.set("before", options.before);
  return call<Thread>(`${messagesPath(target)}?${query}`);
}
export const postMessage = (target: ThreadTarget, input: PostInput) => call<Message>(messagesPath(target), json(input));
export const editMessage = (target: ThreadTarget, id: string, body: string) =>
  call<Message>(`${messagesPath(target)}${id}/`, { ...json({ body }), method: "PATCH" });
export const deleteMessage = (target: ThreadTarget, id: string) => call<null>(`${messagesPath(target)}${id}/`, { method: "DELETE" });
export const markRead = (target: ThreadTarget, channel: Channel) => call<{ channel: Channel; last_read_at: string }>(`${messagesPath(target)}read/`, json({ channel }));
export const fetchUnread = (workspaceId: string) => call<UnreadSummary>(`/workspaces/${workspaceId}/messages/unread/`);
export const fetchChatList = (workspaceId: string) => call<ChatList>(`/workspaces/${workspaceId}/chat/channels/`);
export const searchChat = (workspaceId: string, query: string, extra: Record<string, string> = {}) => {
  const params = new URLSearchParams({ q: query, ...extra });
  return call<ChatSearchResult>(`/workspaces/${workspaceId}/chat/search/?${params}`);
};
export const uploadUrl = (target: ThreadTarget) => `/api${messagesPath(target)}uploads/`;

// ------------------------------------------------------------------ pure rules

/** Adds a polled page to what is on screen: new rows appended, changed rows replaced, order by time. */
export function mergeMessages(current: Message[], incoming: Message[], changed: Message[] = []): Message[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of [...incoming, ...changed]) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

/** The newest timestamp the client has seen, to poll from. */
export function newestAt(messages: Message[], fallback?: string): string | undefined {
  return messages.reduce<string | undefined>((latest, message) => (!latest || message.created_at > latest ? message.created_at : latest), fallback);
}

const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" });
const KEY = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/London" });
const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

export function dayLabel(iso: string, now = new Date()): string {
  const key = KEY.format(new Date(iso));
  if (key === KEY.format(now)) return "Today";
  if (key === KEY.format(new Date(now.getTime() - 86_400_000))) return "Yesterday";
  return DAY.format(new Date(iso));
}
export const clock = (iso: string) => TIME.format(new Date(iso));

/** Messages grouped by London day; consecutive messages by one author within 5 minutes are "continued". */
export function groupByDay(messages: Message[], now = new Date()): { day: string; items: { message: Message; continued: boolean }[] }[] {
  const groups: { day: string; key: string; items: { message: Message; continued: boolean }[] }[] = [];
  let previous: Message | null = null;
  for (const message of messages) {
    const key = KEY.format(new Date(message.created_at));
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = { day: dayLabel(message.created_at, now), key, items: [] };
      groups.push(group);
      previous = null;
    }
    const continued = Boolean(previous && previous.author.id === message.author.id && !previous.deleted && !message.reply_to
      && new Date(message.created_at).getTime() - new Date(previous.created_at).getTime() < 5 * 60_000);
    group.items.push({ message, continued });
    previous = message;
  }
  return groups.map(({ day, items }) => ({ day, items }));
}

/** The `@partial` being typed at the caret, or null. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([\p{L}\p{N}._-]{0,30})$/u.exec(before);
  if (!match) return null;
  return { start: caret - match[2].length - 1, query: match[2] };
}

export function filterPeople(people: Person[], query: string, limit = 6): Person[] {
  const needle = query.toLowerCase();
  return people.filter((person) => person.name.toLowerCase().split(/\s+/).some((part) => part.startsWith(needle)) || person.name.toLowerCase().startsWith(needle)).slice(0, limit);
}

/** Replaces the `@partial` with `@Full Name ` and returns the new text and caret. */
export function insertMention(text: string, at: { start: number; query: string }, person: Person): { text: string; caret: number } {
  const token = `@${person.name} `;
  const next = text.slice(0, at.start) + token + text.slice(at.start + 1 + at.query.length);
  return { text: next, caret: at.start + token.length };
}

/** Who is still mentioned in the final text (people whose @Name survived editing). */
export function mentionedIds(text: string, chosen: Person[]): string[] {
  return [...new Set(chosen.filter((person) => text.includes(`@${person.name}`)).map((person) => person.id))];
}

/** Splits a body into text and @mention parts for rendering (only names that were really mentioned). */
export function bodyParts(body: string, mentions: string[], people: Person[]): { text: string; mention?: boolean }[] {
  const names = people.filter((person) => mentions.includes(person.id)).map((person) => person.name).sort((a, b) => b.length - a.length);
  if (!names.length) return [{ text: body }];
  const pattern = new RegExp(`@(${names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  const parts: { text: string; mention?: boolean }[] = [];
  let last = 0;
  for (const match of body.matchAll(pattern)) {
    if (match.index > last) parts.push({ text: body.slice(last, match.index) });
    parts.push({ text: match[0], mention: true });
    last = match.index + match[0].length;
  }
  if (last < body.length) parts.push({ text: body.slice(last) });
  return parts;
}

export const unreadLabel = (count: number) => (count > 99 ? "99+" : String(count));

/** Where a project's thread lives for this viewer. */
export function threadHref(projectId: string, kind: "team" | "client", channel?: Channel, chatChannelId?: string): string {
  if (chatChannelId) {
    const side = channel ? `?side=${channel}` : "";
    return kind === "client" ? `/portal/chat/${chatChannelId}${side}` : `/chat/${chatChannelId}${side}`;
  }
  if (kind === "client") return `/portal/projects/${projectId}#messages`;
  return `/projects?campaign=${projectId}&tab=messages${channel ? `&channel=${channel}` : ""}`;
}

export function chatHref(channelId: string, kind: "team" | "client" = "team", side?: Channel): string {
  const query = side ? `?side=${side}` : "";
  return kind === "client" ? `/portal/chat/${channelId}${query}` : `/chat/${channelId}${query}`;
}
