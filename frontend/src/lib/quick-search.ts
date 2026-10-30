import type { DashboardRole } from "./api";
import { navFor, type NavIcon } from "./role-nav";

/** One row in the ⌘K palette. `group` decides the heading and the icon. */
export type SearchItem = { id: string; title: string; subtitle: string; href: string; meta?: string };
export type SearchGroupKey = "recent" | "actions" | "pages" | "projects" | "clients" | "cuts" | "files" | "tasks" | "chat" | "people";
export type SearchGroup = { key: SearchGroupKey; label: string; items: SearchItem[] };
export type SearchResponse = { query: string; role: DashboardRole | null; groups: SearchGroup[] };
export type PaletteRow = SearchItem & { group: SearchGroupKey; icon?: NavIcon };

export const MIN_QUERY = 2;
export const DEBOUNCE_MS = 150;
const RECENT_LIMIT = 6;
const recentKey = (workspaceId: string) => `bf-quick-search-recent:${workspaceId}`;

type NavAccess = Parameters<typeof navFor>[0];

/** The quick actions a role may take. Each opens the page's own dialog through `?do=`. */
export function quickActions(role: DashboardRole): SearchItem[] {
  if (role === "client") {
    return [
      { id: "action:request", title: "New request", subtitle: "Ask the studio for something", href: "/portal/requests/new" },
      { id: "action:send", title: "Send files", subtitle: "Upload to the studio", href: "/#send-files" },
    ];
  }
  const actions: SearchItem[] = [
    { id: "action:upload", title: "Upload files", subtitle: "Add to the Files library", href: "/files?do=upload" },
    { id: "action:task", title: "New task", subtitle: "Add a task to the board", href: "/tasks?do=new-task" },
  ];
  if (role === "owner") actions.unshift({ id: "action:project", title: "New client or project", subtitle: "Open the client list with the form ready", href: "/projects?do=new" });
  return actions;
}

/** "Go to" rows: exactly the sidebar for this role (so no page a guard would bounce). */
export function pageRows(workspace: NavAccess): PaletteRow[] {
  const nav = navFor(workspace);
  return [...nav.primary, ...nav.secondary].map((link) => ({
    id: `page:${link.href}`, title: link.label, subtitle: "Go to page", href: link.href, group: "pages" as const, icon: link.icon,
  }));
}

/** Case-insensitive substring test on title and subtitle, used for the local groups. */
export function matches(item: SearchItem, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return item.title.toLowerCase().includes(q) || item.subtitle.toLowerCase().includes(q);
}

/** Splits `text` into plain and matching parts for highlighting (every occurrence). */
export function highlight(text: string, query: string): { text: string; hit: boolean }[] {
  const q = query.trim().toLowerCase();
  if (!q || !text) return [{ text, hit: false }];
  const parts: { text: string; hit: boolean }[] = [];
  const lower = text.toLowerCase();
  let from = 0;
  for (let at = lower.indexOf(q); at !== -1; at = lower.indexOf(q, from)) {
    if (at > from) parts.push({ text: text.slice(from, at), hit: false });
    parts.push({ text: text.slice(at, at + q.length), hit: true });
    from = at + q.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), hit: false });
  return parts;
}

/** Visible groups in order: with no query, recents + actions + pages; with one, server results first. */
export function buildGroups({ query, server, recents, actions, pages }: {
  query: string; server: SearchGroup[]; recents: PaletteRow[]; actions: SearchItem[]; pages: PaletteRow[];
}): { key: SearchGroupKey; label: string; rows: PaletteRow[] }[] {
  const q = query.trim();
  const out: { key: SearchGroupKey; label: string; rows: PaletteRow[] }[] = [];
  const push = (key: SearchGroupKey, label: string, rows: PaletteRow[]) => { if (rows.length) out.push({ key, label, rows }); };
  if (!q) {
    push("recent", "Recent", recents);
    push("actions", "Quick actions", actions.map((a) => ({ ...a, group: "actions" })));
    push("pages", "Go to", pages);
    return out;
  }
  for (const group of server) push(group.key, group.label, group.items.map((item) => ({ ...item, group: group.key })));
  push("actions", "Quick actions", actions.filter((a) => matches(a, q)).map((a) => ({ ...a, group: "actions" })));
  push("pages", "Go to", pages.filter((p) => matches(p, q)));
  return out;
}

export function readRecents(workspaceId: string): PaletteRow[] {
  try {
    const raw = window.localStorage.getItem(recentKey(workspaceId));
    const rows = raw ? (JSON.parse(raw) as PaletteRow[]) : [];
    return Array.isArray(rows) ? rows.filter((row) => row && typeof row.href === "string" && typeof row.title === "string").slice(0, RECENT_LIMIT) : [];
  } catch { return []; }
}

/** Remembers an opened result (not actions or pages), newest first, de-duplicated by href. */
export function rememberRecent(workspaceId: string, row: PaletteRow) {
  if (row.group === "actions" || row.group === "pages") return;
  try {
    const next = [{ ...row, group: "recent" as const, origin: row.group }, ...readRecents(workspaceId).filter((r) => r.href !== row.href)].slice(0, RECENT_LIMIT);
    window.localStorage.setItem(recentKey(workspaceId), JSON.stringify(next));
  } catch { /* storage full or blocked: recents are a nicety */ }
}

/** Past this the palette says search is unavailable instead of "Searching…" forever (B8). */
export const SEARCH_TIMEOUT_MS = 8_000;

export async function fetchQuickSearch(workspaceId: string, query: string, signal?: AbortSignal): Promise<SearchResponse> {
  const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(`/api/workspaces/${workspaceId}/search/?q=${encodeURIComponent(query)}`, { credentials: "include", signal: combined });
  } catch (error) {
    // A timeout surfaces as a normal failure; a caller's own abort stays an AbortError.
    if (signal?.aborted) throw error;
    throw new Error(timeout.aborted ? "Search timed out." : "Search is unavailable.");
  }
  if (!response.ok) throw new Error(`Search failed (${response.status}).`);
  return response.json() as Promise<SearchResponse>;
}

/** True for ⌘K on Mac and Ctrl+K elsewhere. */
export function isPaletteShortcut(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">) {
  return event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;
}

export const OPEN_PALETTE_EVENT = "bf:open-quick-search";
