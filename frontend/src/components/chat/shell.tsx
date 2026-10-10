"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, ChevronDown, ChevronRight, Hash, Lock, MessagesSquare, Search, Users, X,
} from "lucide-react";
import { ProjectThread } from "@/components/messages/thread";
import {
  fetchChatList, searchChat, unreadLabel,
  type Channel, type ChatChannelRow, type ChatList, type ChatSearchResult,
} from "@/lib/messages";
import "@/components/portal/portal.css";
import "@/components/messages/messages.css";
import "./chat.css";

type View = "all" | "unreads" | "mentions";

/**
 * Slack-style chat: a client-grouped channel list on the left, the conversation on the right.
 * On phones the list and the conversation are separate screens.
 */
export function ChatShell({ workspaceId, initialChannelId = null, initialSide = "client", variant = "studio" }: {
  workspaceId: string; initialChannelId?: string | null; initialSide?: Channel; variant?: "studio" | "portal";
}) {
  const router = useRouter();
  const [list, setList] = useState<ChatList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("all");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [pastOpen, setPastOpen] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<string | null>(initialChannelId);
  const [side, setSide] = useState<Channel>(initialSide);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<ChatSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [mobileShowThread, setMobileShowThread] = useState(Boolean(initialChannelId));
  const [quote, setQuote] = useState("");
  const base = variant === "portal" ? "/portal/chat" : "/chat";

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.location.hash.match(/^#quote=(.*)$/);
    if (!raw) return;
    try {
      const value = decodeURIComponent(raw[1]).slice(0, 280);
      history.replaceState(null, "", window.location.pathname + window.location.search);
      queueMicrotask(() => setQuote(value));
    } catch { /* ignore bad hash */ }
  }, []);

  const refresh = useCallback(() => {
    void fetchChatList(workspaceId).then((result) => {
      if (!result.ok) { setError(result.error); return; }
      setList(result.data);
      setError(null);
      if (!selected) {
        const first = result.data.sections.flatMap((section) => section.channels).find((row) => row.total_unread || row.total_mentions)
          ?? result.data.sections[0]?.channels[0]
          ?? result.data.studio[0];
        if (first) setSelected(first.id);
      }
    });
  }, [workspaceId, selected]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  // ⌘K / Ctrl+K focuses the search box.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.getElementById("chat-search")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (query.trim().length < 2) { setSearch(null); setSearching(false); return; }
      setSearching(true);
      void searchChat(workspaceId, query.trim()).then((result) => {
        setSearching(false);
        if (result.ok) setSearch(result.data);
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, workspaceId]);

  const selectedRow = useMemo(() => {
    if (!list || !selected) return null;
    for (const section of list.sections) {
      for (const row of [...section.channels, ...section.past]) if (row.id === selected) return row;
    }
    return list.studio.find((row) => row.id === selected) ?? null;
  }, [list, selected]);

  function openChannel(row: ChatChannelRow, nextSide?: Channel) {
    const chosen = nextSide && row.sides.includes(nextSide)
      ? nextSide
      : (row.mentions.team || row.team_unread) && row.sides.includes("team") && !(row.unread.client)
        ? "team"
        : "client";
    setSelected(row.id);
    setSide(chosen);
    setMobileShowThread(true);
    setQuery("");
    setSearch(null);
    router.replace(`${base}/${row.id}?side=${chosen}`, { scroll: false });
  }

  function filterRows(rows: ChatChannelRow[]): ChatChannelRow[] {
    if (view === "unreads") return rows.filter((row) => row.total_unread > 0);
    if (view === "mentions") return rows.filter((row) => row.total_mentions > 0);
    return rows;
  }

  const jumpMatches = useMemo(() => {
    if (!list || query.trim().length < 1 || query.trim().length >= 2 && search) return [];
    const needle = query.toLowerCase();
    const rows = [
      ...list.sections.flatMap((section) => section.channels.map((row) => ({ ...row, section: section.name }))),
      ...list.studio.map((row) => ({ ...row, section: "Studio" })),
    ];
    return rows.filter((row) => row.name.toLowerCase().includes(needle) || row.section.toLowerCase().includes(needle)).slice(0, 8);
  }, [list, query, search]);

  if (error) return <div className="ch-shell"><p className="mt-alert" role="alert">{error}</p></div>;
  if (!list) return <div className="ch-shell"><p className="mt-loading">Loading chat…</p></div>;

  const listPane = <aside className={`ch-sidebar${mobileShowThread ? " is-hidden-mobile" : ""}`} aria-label="Channels">
    <header className="ch-side-head">
      <h1><MessagesSquare aria-hidden="true" />Chat</h1>
      {(list.total_unread > 0 || list.total_mentions > 0) && (
        <span className="ch-side-count">{list.total_mentions ? `${list.total_mentions} mention${list.total_mentions === 1 ? "" : "s"}` : `${list.total_unread} unread`}</span>
      )}
    </header>
    <label className="ch-search">
      <Search aria-hidden="true" />
      <input id="chat-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search or jump (⌘K)" aria-label="Search messages or jump to a channel" />
      {query && <button type="button" onClick={() => { setQuery(""); setSearch(null); }} aria-label="Clear search"><X /></button>}
    </label>
    {!query && <div className="ch-views" role="tablist" aria-label="Views">
      {(["all", "unreads", "mentions"] as View[]).map((value) => <button
        key={value} type="button" role="tab" aria-selected={view === value} className={view === value ? "is-on" : ""}
        onClick={() => setView(value)}
      >{value === "all" ? "All" : value === "unreads" ? `Unreads${list.total_unread ? ` ${list.total_unread}` : ""}` : `Mentions${list.total_mentions ? ` ${list.total_mentions}` : ""}`}</button>)}
    </div>}

    {query.trim().length >= 2 && <div className="ch-search-results" aria-live="polite">
      {jumpMatches.length > 0 && <p className="ch-search-label">Jump to</p>}
      {jumpMatches.map((row) => <button key={`jump-${row.id}`} type="button" className="ch-search-hit" onClick={() => openChannel(row)}>
        <Hash aria-hidden="true" /><span><strong>{row.name}</strong><small>{row.section}</small></span>
      </button>)}
      <p className="ch-search-label">{searching ? "Searching…" : search ? `Messages · ${search.results.length}` : "Type two characters to search messages"}</p>
      {search?.results.map((hit) => <button key={hit.message_id} type="button" className="ch-search-hit" onClick={() => {
        const row = [...list.sections.flatMap((s) => [...s.channels, ...s.past]), ...list.studio].find((c) => c.id === hit.chat_channel_id);
        if (row) openChannel(row, hit.channel);
      }}>
        {hit.team_only ? <Lock aria-hidden="true" /> : <Hash aria-hidden="true" />}
        <span>
          <strong>{hit.author_name}</strong>
          <small>{[hit.client_team_name, hit.project_name || hit.channel_name].filter(Boolean).join(" · ")}{hit.team_only ? " · Team only" : ""}</small>
          <em>{hit.snippet}</em>
        </span>
      </button>)}
      {search && search.results.length === 0 && !searching && <p className="ch-empty">No messages match “{search.query}”.</p>}
    </div>}

    {!query && <nav className="ch-nav">
      {list.sections.map((section) => {
        const channels = filterRows(section.channels);
        const past = filterRows(section.past);
        const hot = section.channels.concat(section.past).filter((row) => row.total_unread || row.total_mentions);
        const wantsCollapse = Boolean(collapsed[section.id]) && view === "all";
        if (view !== "all" && channels.length === 0 && past.length === 0) return null;
        return <div className="ch-section" key={section.id}>
          <button type="button" className="ch-section-head" onClick={() => setCollapsed((current) => ({ ...current, [section.id]: !current[section.id] }))} aria-expanded={!wantsCollapse}>
            {wantsCollapse ? <ChevronRight aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
            <span>{section.name}</span>
            {section.total_mentions > 0 && <b className="ch-badge is-mention">{unreadLabel(section.total_mentions)}</b>}
            {section.total_unread > 0 && !section.total_mentions && <b className="ch-badge">{unreadLabel(section.total_unread)}</b>}
          </button>
          {!wantsCollapse && <>
            {channels.map((row) => <ChannelButton key={row.id} row={row} active={selected === row.id} onOpen={() => openChannel(row)} />)}
            {past.length > 0 && <>
              <button type="button" className="ch-past-toggle" onClick={() => setPastOpen((current) => ({ ...current, [section.id]: !current[section.id] }))}>
                {pastOpen[section.id] ? "Hide" : "Past"} projects ({past.length})
              </button>
              {pastOpen[section.id] && past.map((row) => <ChannelButton key={row.id} row={row} active={selected === row.id} onOpen={() => openChannel(row)} />)}
            </>}
            {channels.length === 0 && past.length === 0 && view === "all" && <p className="ch-empty">No channels yet.</p>}
          </>}
          {/* Collapsed sections still surface channels with unread or mentions. */}
          {wantsCollapse && hot.map((row) => (
            <ChannelButton key={row.id} row={row} active={selected === row.id} onOpen={() => openChannel(row)} />
          ))}
        </div>;
      })}
      {variant === "studio" && filterRows(list.studio).length > 0 && <div className="ch-section">
        <p className="ch-section-head is-static"><Lock aria-hidden="true" /><span>Studio</span><small>Team only</small></p>
        {filterRows(list.studio).map((row) => <ChannelButton key={row.id} row={row} active={selected === row.id} onOpen={() => openChannel(row)} />)}
      </div>}
      {view !== "all" && list.sections.every((section) => filterRows(section.channels).length + filterRows(section.past).length === 0) && filterRows(list.studio).length === 0 && (
        <p className="ch-empty">{view === "mentions" ? "No unread mentions." : "You're all caught up."}</p>
      )}
    </nav>}
  </aside>;

  const threadPane = <section className={`ch-main${mobileShowThread ? " is-open-mobile" : ""}`} aria-label="Conversation">
    {selectedRow ? <>
      <header className="ch-main-head">
        <button type="button" className="ch-back" onClick={() => setMobileShowThread(false)} aria-label="Back to channels"><ArrowLeft /></button>
        <div className="ch-main-title">
          <Hash aria-hidden="true" />
          <div>
            <strong>{selectedRow.name}</strong>
            <small>{selectedRow.client_team_name ? `${selectedRow.client_team_name}${selectedRow.kind === "general" ? "" : ""}` : "Studio"}{selectedRow.kind === "general" ? " · General" : ""}</small>
          </div>
        </div>
        {selectedRow.project_id && variant === "studio" && (
          <Link className="ch-open-project" href={`/projects?campaign=${selectedRow.project_id}`}>Open project</Link>
        )}
        {selectedRow.project_id && variant === "portal" && (
          <Link className="ch-open-project" href={`/portal/projects/${selectedRow.project_id}`}>Open project</Link>
        )}
      </header>
      <div className="ch-thread">
        <ProjectThread
          key={`${selectedRow.id}:${side}:${quote}`}
          workspaceId={workspaceId}
          chatChannelId={selectedRow.id}
          projectId={selectedRow.project_id ?? undefined}
          initialChannel={selectedRow.sides.includes(side) ? side : "client"}
          initialQuote={quote}
          variant={variant}
          onUnreadChange={() => refresh()}
        />
      </div>
    </> : <div className="ch-empty-main">
      <MessagesSquare aria-hidden="true" />
      <strong>Pick a conversation</strong>
      <p>Channels are grouped by client. Use Team only for anything internal.</p>
    </div>}
  </section>;

  return <div className={`ch-shell is-${variant}`}>{listPane}{threadPane}</div>;
}

function ChannelButton({ row, active, onOpen }: { row: ChatChannelRow; active: boolean; onOpen: () => void }) {
  const mentions = row.total_mentions;
  const unread = row.total_unread;
  const teamDot = row.team_unread > 0;
  const label = row.kind === "general" ? "General" : row.name;
  return <button
    type="button"
    className={`ch-channel${active ? " is-active" : ""}${unread || mentions ? " is-unread" : ""}`}
    onClick={onOpen}
    aria-current={active ? "page" : undefined}
  >
    {row.kind === "general" ? <Users aria-hidden="true" /> : <Hash aria-hidden="true" />}
    <span className="ch-channel-name">{label}</span>
    {teamDot && <i className="ch-team-dot" title="Unread team-only" aria-label="Unread team-only" />}
    {mentions > 0 && <b className="ch-badge is-mention" aria-label={`${mentions} mentions`}>{unreadLabel(mentions)}</b>}
    {mentions === 0 && unread > 0 && <b className="ch-badge" aria-label={`${unread} unread`}>{unreadLabel(unread)}</b>}
  </button>;
}
