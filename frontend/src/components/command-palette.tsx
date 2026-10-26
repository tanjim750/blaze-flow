"use client";

import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowRight, Clients, Clapperboard, Clock, CornerDownLeft, FileText, FolderOpen, Loader2, MessagesSquare,
  Plus, Search, SquareKanban, User, X,
} from "@/components/icons";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Workspace } from "@/lib/api";
import { useAppRouter } from "@/lib/app-router";
import { runHere } from "@/lib/do-param";
import { roleFor } from "@/lib/dashboard-role";
import {
  buildGroups, DEBOUNCE_MS, fetchQuickSearch, highlight, isPaletteShortcut, MIN_QUERY, OPEN_PALETTE_EVENT, pageRows,
  quickActions, readRecents, rememberRecent, type PaletteRow, type SearchGroup, type SearchGroupKey,
} from "@/lib/quick-search";
import "./command-palette.css";

const GROUP_ICON: Record<SearchGroupKey, ReactNode> = {
  recent: <Clock aria-hidden="true" />, actions: <Plus aria-hidden="true" />, pages: <ArrowRight aria-hidden="true" />,
  projects: <FolderOpen aria-hidden="true" />, clients: <Clients aria-hidden="true" />, cuts: <Clapperboard aria-hidden="true" />,
  files: <FileText aria-hidden="true" />, tasks: <SquareKanban aria-hidden="true" />, chat: <MessagesSquare aria-hidden="true" />,
  people: <User aria-hidden="true" />,
};

/** Opens the palette from anywhere (the rail button, the mobile top bar). */
export function openQuickSearch() { window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT)); }

/**
 * The app-wide ⌘K / Ctrl+K palette: recent items, quick actions and "go to" pages with no
 * query; grouped, permission-scoped matches from `/search/` once two characters are typed.
 * Results for the previous query stay on screen while the next one loads, and the list has
 * a fixed height, so typing never makes the dialog jump.
 */
export function CommandPalette({ workspace }: { workspace: Workspace | null }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [server, setServer] = useState<{ query: string; groups: SearchGroup[] }>({ query: "", groups: [] });
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const [recents, setRecents] = useState<PaletteRow[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const router = useAppRouter();
  const workspaceId = workspace?.id ?? null;
  const role = workspace ? roleFor(workspace) : "editor";

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (isPaletteShortcut(event)) { event.preventDefault(); setOpen((value) => !value); } };
    const onOpen = () => setOpen(true);
    document.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => { document.removeEventListener("keydown", onKey); window.removeEventListener(OPEN_PALETTE_EVENT, onOpen); };
  }, []);

  // Fresh state on every open; recents are read then (another tab may have added some).
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) return;
    setQuery(""); setActive(0); setFailed(false);
  };
  useEffect(() => { if (open && workspaceId) queueMicrotask(() => setRecents(readRecents(workspaceId))); }, [open, workspaceId]);

  // Debounced search; an in-flight request is aborted when the query changes.
  const trimmed = query.trim();
  useEffect(() => {
    if (!open || !workspaceId || trimmed.length < MIN_QUERY) { queueMicrotask(() => setLoading(false)); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      fetchQuickSearch(workspaceId, trimmed, controller.signal)
        .then((data) => { setServer({ query: trimmed, groups: data.groups }); setFailed(false); })
        .catch((error: unknown) => { if ((error as Error).name !== "AbortError") setFailed(true); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, DEBOUNCE_MS);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, workspaceId, trimmed, attempt]);

  const actions = useMemo(() => quickActions(role), [role]);
  const pages = useMemo(() => pageRows(workspace), [workspace]);
  // Below the minimum, server groups are dropped; above it, the last answer stays until the next lands.
  const groups = useMemo(() => {
    const long = trimmed.length >= MIN_QUERY;
    // Any typed text hides Recent at once (M9: it used to flash back for 1-char queries).
    const built = buildGroups({ query: trimmed, server: long ? server.groups : [], recents, actions, pages });
    const starts = built.map((_, i) => built.slice(0, i).reduce((sum, group) => sum + group.rows.length, 0));
    return built.map((group, i) => ({ ...group, start: starts[i] }));
  }, [trimmed, server.groups, recents, actions, pages]);
  const rows = useMemo(() => groups.flatMap((group) => group.rows), [groups]);
  const highlightQuery = trimmed.length >= MIN_QUERY ? trimmed : "";
  const current = Math.min(active, Math.max(0, rows.length - 1));

  const choose = useCallback((row: PaletteRow | undefined) => {
    if (!row) return;
    if (workspaceId) rememberRecent(workspaceId, row);
    onOpenChange(false);
    if (!runHere(row.href)) router.push(row.href);
  }, [router, workspaceId]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [current]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((current + 1) % Math.max(1, rows.length)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((current - 1 + rows.length) % Math.max(1, rows.length)); }
    else if (event.key === "Home") { event.preventDefault(); setActive(0); }
    else if (event.key === "End") { event.preventDefault(); setActive(rows.length - 1); }
    else if (event.key === "Enter") { event.preventDefault(); choose(rows[current]); }
  };

  const searching = Boolean(workspaceId) && trimmed.length >= MIN_QUERY && (loading || server.query !== trimmed);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="qs-overlay" />
        <Dialog.Content className="qs-dialog" aria-describedby={undefined} onOpenAutoFocus={(event) => { event.preventDefault(); document.getElementById("qs-input")?.focus(); }}>
          <Dialog.Title className="sr-only">Quick search</Dialog.Title>
          <div className="qs-field">
            {searching ? <Loader2 className="qs-spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
            <input
              id="qs-input" value={query} autoComplete="off" spellCheck={false}
              onChange={(event) => { setQuery(event.target.value); setActive(0); }} onKeyDown={onKeyDown}
              placeholder={role === "client" ? "Search your projects, cuts and messages" : "Search projects, cuts, files, tasks, people…"}
              role="combobox" aria-expanded="true" aria-controls="qs-list" aria-autocomplete="list"
              aria-activedescendant={rows.length ? `qs-row-${current}` : undefined} aria-label="Quick search"
            />
            <kbd className="qs-esc">Esc</kbd>
            <Dialog.Close className="qs-close" aria-label="Close search"><X aria-hidden="true" /></Dialog.Close>
          </div>
          <div className="qs-list" id="qs-list" role="listbox" aria-label="Results" ref={listRef} aria-busy={searching}>
            {groups.map((group) => (
              <div className="qs-group" role="group" aria-labelledby={`qs-h-${group.key}`} key={group.key}>
                <p className="qs-heading" id={`qs-h-${group.key}`}>{group.label}</p>
                {group.rows.map((row, offset) => {
                  const at = group.start + offset;
                  const icon = row.group === "recent" ? GROUP_ICON[(row as PaletteRow & { origin?: SearchGroupKey }).origin ?? "recent"] : GROUP_ICON[row.group];
                  return (
                    <div
                      key={`${group.key}:${row.id}`} id={`qs-row-${at}`} data-index={at} role="option" aria-selected={at === current}
                      className="qs-row" onMouseMove={() => { if (at !== current) setActive(at); }} onClick={() => choose(row)}
                    >
                      <span className="qs-icon">{icon}</span>
                      <span className="qs-text">
                        <b>{highlight(row.title, highlightQuery).map((part, i) => part.hit ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>)}</b>
                        <small>{highlight(row.subtitle, highlightQuery).map((part, i) => part.hit ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>)}</small>
                      </span>
                      {row.meta ? <em className="qs-meta">{row.meta}</em> : null}
                      <CornerDownLeft className="qs-enter" aria-hidden="true" />
                    </div>
                  );
                })}
              </div>
            ))}
            {!rows.length && (
              <p className="qs-empty" role="status">
                {failed ? <>Search is unavailable right now. <button type="button" className="qs-retry" onClick={() => { setFailed(false); setAttempt((n) => n + 1); }}>Try again</button></> : searching ? "Searching…" : !workspaceId && trimmed.length >= MIN_QUERY ? "Search comes back once Blaze Flow reconnects." : trimmed.length >= MIN_QUERY ? `Nothing matches “${trimmed}”.` : "Type to search."}
              </p>
            )}
          </div>
          <footer className="qs-foot" aria-hidden="true">
            <span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>Esc</kbd> close</span>
            <span className="qs-foot-right"><kbd>⌘</kbd><kbd>K</kbd> anywhere</span>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
