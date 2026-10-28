"use client";

import { ThemeSwitch } from "@/components/theme/theme-switch";
import Link from "next/link";
import { CommandPalette, openQuickSearch } from "@/components/command-palette";
import { LinkPending } from "@/components/nav-progress";
import { usePathname, useSearchParams } from "next/navigation";
import { PageTransition } from "@/components/page-transition";
import { BadgeCheck, Inbox, ReceiptText, CheckCircle2, Clients, ChevronLeft, CircleHelp, Flame, FolderOpen, House, LogOut, Mail, Menu, MessagesSquare, Search, Settings, SquareKanban, Users, Wallet, X } from "@/components/icons";
import { useEffect, useRef, useState } from "react";
import { signOutAction, switchWorkspaceAction } from "@/app/actions";
import type { ShellUser } from "@/lib/user";
import type { Workspace } from "@/lib/api";
import { navFor, type NavIcon } from "@/lib/role-nav";
import { UniversalReviewLayout } from "@/components/universal-review";
import { NotificationBell } from "@/components/notifications/bell";
import { LiveMoney } from "@/components/money/live-money";
import { fetchUnread, unreadLabel } from "@/lib/messages";
import "@/components/messages/messages.css";
import { mobileTitle } from "@/lib/mobile-title";
import { LifeBuoy, Plus, ShieldCheck, Upload } from "@/components/icons";
import { REPORT_EVENT, ReportProblemDialog } from "@/components/report-problem";
import { ShellReconnect } from "@/components/shell-reconnect";
import { Select } from "@/components/ui/select";

type OperationsHealth = { status: "healthy" | "warning" | "critical"; alerts: { severity: string; code: string; count: number }[] };

/** Lucide icons for the role nav (see `lib/role-nav.ts` for who sees which link). */
const ICONS: Record<NavIcon, typeof House> = {
  home: House, projects: SquareKanban, chat: MessagesSquare, tasks: CheckCircle2, files: FolderOpen,
  clients: Clients, team: Users, money: Wallet,
  settings: Settings, help: CircleHelp, approvals: BadgeCheck, requests: Inbox,
  invoices: ReceiptText, upload: Upload, pay: Wallet,
};

function previewAccess(workspace: Workspace, role: "client" | "editor"): Workspace {
  return { ...workspace, dashboard_role: role, billing: { view: false, manage: false, rates_view: role === "editor" ? Boolean(workspace.billing?.rates_view) : false } };
}

function withPreview<T extends { href: string }>(link: T, role: string): T {
  const [path, hash] = link.href.split("#");
  const joined = `${path}${path.includes("?") ? "&" : "?"}view=${role}`;
  return { ...link, href: hash ? `${joined}#${hash}` : joined };
}

/** Mirrors the cookie the layout reads, so a reload opens at the width you left it. */
const RAIL_COOKIE = "blazeflow_rail";

export function AppShell({ children, user = null, workspaces = [], selectedWorkspaceId = null, railCollapsed = false, degraded = false }: {
  children: React.ReactNode; user?: ShellUser | null;
  /** The layout could not load the user or their workspaces (API briefly down). */
  degraded?: boolean;
  workspaces?: Workspace[]; selectedWorkspaceId?: string | null;
  /** Read from a cookie by the layout, so the first paint is already the right width. */
  railCollapsed?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(railCollapsed);
  const [health, setHealth] = useState<OperationsHealth | "restricted" | "unavailable" | null>(null);
  const [unread, setUnread] = useState<{ workspace: string | null; count: number }>({ workspace: null, count: 0 });
  const messagesUnread = unread.workspace === selectedWorkspaceId ? unread.count : 0;
  const selected = workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? workspaces[0];
  // Owners get the whole studio; editors their own work; clients the portal. Same source as
  // the route guards, so nothing here links to a page that would bounce them.
  // An owner previewing "View as client/editor" gets that role's nav too (and the links keep
  // the preview), so the preview is faithful: no Clients, Team or Money for a client.
  const previewParam = useSearchParams()?.get("view");
  const previewRole = selected && navFor(selected).role === "owner" && (previewParam === "client" || previewParam === "editor") ? previewParam : null;
  // With no workspace because the API failed (not because there is none), don't guess a role:
  // falling back to the editor nav made an owner's sidebar look like someone else's (B8).
  const baseNav = degraded && !selected
    ? { role: "unknown" as const, primary: [{ href: "/", label: "Home", icon: "home" as const }], secondary: [{ href: "/help", label: "Help", icon: "help" as const }] }
    : navFor(previewRole && selected ? previewAccess(selected, previewRole) : selected);
  const nav = previewRole ? { ...baseNav, primary: baseNav.primary.map((link) => withPreview(link, previewRole)), secondary: baseNav.secondary.map((link) => withPreview(link, previewRole)) } : baseNav;
  const navLinks = nav.primary.map((link) => ({ ...link, icon: ICONS[link.icon] }));
  const secondaryLinks = nav.secondary.map((link) => ({ ...link, icon: ICONS[link.icon] }));
  const isActive = (href: string) => {
    if (href.includes("#")) return false;
    const path = href.split("?")[0];
    return path === "/" ? pathname === "/" : pathname.startsWith(path);
  };
  // Projects lays out its own full-bleed browser, so it opts out of the standard page padding.
  // Full-bleed routes: the projects tree and the review workspace both own their own
  // chrome and fill the viewport, so the shell gives them the frame without the padding.
  const flush = pathname.startsWith("/projects") || pathname.startsWith("/review") || pathname.startsWith("/files") || pathname.startsWith("/chat") || pathname.startsWith("/portal/chat");

  useEffect(() => {
    let active = true;
    if (!selectedWorkspaceId) { queueMicrotask(() => active && setHealth(null)); return () => { active = false; }; }
    // Only owners may read operations health; asking anyway put a 403 in the console of
    // every editor and client on every page load.
    if (nav.role !== "owner") { queueMicrotask(() => active && setHealth("restricted")); return () => { active = false; }; }
    void fetch(`/api/workspaces/${selectedWorkspaceId}/operations/health/`, { credentials: "include" }).then(async (response) => {
      if (!active) return;
      if (response.ok) setHealth(await response.json() as OperationsHealth);
      else setHealth(response.status === 403 ? "restricted" : "unavailable");
    }).catch(() => active && setHealth("unavailable"));
    return () => { active = false; };
  }, [nav.role, selectedWorkspaceId]);

  // The Messages badge: unread across every project thread this person can read. Polled
  // (no websockets), paused while the tab is hidden, and refreshed on navigation.
  useEffect(() => {
    if (!selectedWorkspaceId) return;
    let alive = true;
    const load = () => void fetchUnread(selectedWorkspaceId).then((result) => {
      if (alive && result.ok) setUnread({ workspace: selectedWorkspaceId, count: result.data.total_unread });
    });
    load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") load(); }, 30_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [selectedWorkspaceId, pathname]);

  /**
   * The width itself is animated in CSS, through a registered `--rail-w` custom property
   * (see `shell.css`). Doing it there rather than per-frame in React means the sidebar and
   * the main column stay in lockstep off one transition, with no re-render while it runs —
   * which is what keeps a spring-like overshoot from turning into jank on a long page.
   */
  function toggleRail() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${RAIL_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  }

  // Below 900px the bell and avatar move from the rail into the top bar. They render in one
  // place only, so the notification feed is polled once.
  const narrow = useNarrow();
  // The page's own main action (marked `data-mobile-primary`) is mirrored into the top bar.
  const [primary, setPrimary] = useState<string | null>(null);
  useEffect(() => {
    if (!narrow) return;
    const find = () => setPrimary(document.querySelector<HTMLElement>(".studio-main [data-mobile-primary]:not([disabled])")?.dataset.mobilePrimary ?? null);
    find();
    const observer = new MutationObserver(find);
    const root = document.querySelector(".studio-main");
    if (root) observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled", "data-mobile-primary"] });
    return () => observer.disconnect();
  }, [narrow, pathname]);
  const runPrimary = () => document.querySelector<HTMLElement>(".studio-main [data-mobile-primary]:not([disabled])")?.click();
  useEffect(() => { if (!open) return; const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [open]);

  const shellClass = `studio-shell${collapsed ? " is-collapsed" : ""}`;

  return (
    <div className={shellClass}>
      <header className="studio-mobilebar">
        <button type="button" className="studio-mobilebar-btn" onClick={() => setOpen(!open)} aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open}>
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
        <h1 className="studio-mobilebar-title">{mobileTitle(pathname)}</h1>
        <div className="studio-mobilebar-actions">
          {primary && <button type="button" className="studio-mobilebar-btn is-primary" onClick={runPrimary} aria-label={primary}>{/upload/i.test(primary) ? <Upload size={18} /> : <Plus size={18} />}</button>}
          <button type="button" className="studio-mobilebar-btn" onClick={openQuickSearch} aria-label="Search"><Search size={19} /></button>
          {narrow && <div className="studio-notifications"><NotificationBell workspaceId={selectedWorkspaceId} /></div>}
          {narrow && <AccountMenu user={user} />}
        </div>
      </header>
      <ReportProblemDialog workspaceId={selectedWorkspaceId} />
      {selected && selected.dashboard_role !== "client" && <LiveMoney workspaceId={selected.id} />}
      <CommandPalette workspace={selected ?? null} />
      {open && <button type="button" className="studio-scrim" aria-label="Close navigation" tabIndex={-1} onClick={() => setOpen(false)} />}

      <aside className={open ? "studio-sidebar open" : "studio-sidebar"}>
        <button
          type="button"
          className="studio-rail-toggle"
          onClick={toggleRail}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-expanded={!collapsed}
        >
          <ChevronLeft size={14} strokeWidth={2.25} />
        </button>

        <div className="studio-sidebar-top">
          <div className="studio-brand"><span><Flame size={17} /></span><strong>Krewsys</strong></div>
          <WorkspacePicker workspaces={workspaces} selectedWorkspaceId={selectedWorkspaceId} pathname={pathname} degraded={degraded} />

          {/* Opens the ⌘K palette (everyone, clients included: it is scoped to what they can see). */}
          <button type="button" className="studio-rail-search" onClick={openQuickSearch} aria-label="Search (⌘K)" aria-keyshortcuts="Meta+K Control+K">
            <Search size={14} />
            <span>{nav.role === "client" ? "Search" : "Search everything"}</span>
            <kbd>⌘K</kbd>
          </button>

          <nav aria-label="Main navigation">
            {navLinks.map(({ href, label, icon: Icon }) => (
              <Link key={label} href={href} onClick={() => setOpen(false)} title={label} className={isActive(href) ? "active" : ""} aria-current={isActive(href) ? "page" : undefined}>
                <Icon size={20} /><span>{label}</span>
                {(href === "/chat" || href === "/portal/chat") && messagesUnread > 0 && <b className="studio-nav-badge" aria-label={`${messagesUnread} unread messages`}>{unreadLabel(messagesUnread)}</b>}
                <LinkPending />
              </Link>
            ))}
          </nav>

        </div>

        <div className="studio-sidebar-foot">
          <nav aria-label="Secondary navigation">
            {secondaryLinks.map(({ href, label, icon: Icon }) => (
              <Link key={label} href={href} onClick={() => setOpen(false)} title={label} className={isActive(href) ? "active" : ""} aria-current={isActive(href) ? "page" : undefined}>
                <Icon size={18} /><span>{label}</span><LinkPending />
              </Link>
            ))}
          </nav>
          {nav.role === "owner" && <div className="render-engine">
            <i className={typeof health === "object" && health ? health.status : undefined} />
            <div><small>Operations</small><span>{healthLabel(health)}</span></div>
            {typeof health === "object" && health && health.alerts.length > 0 && <b>{health.alerts.reduce((sum, alert) => sum + alert.count, 0)} alerts</b>}
          </div>}

          <div className="studio-rail-account">
            {!narrow && <AccountMenu user={user} />}
            {user && <span className="studio-rail-who"><strong>{user.name}</strong><small>{user.email}</small></span>}
            {!narrow && <div className="studio-notifications"><NotificationBell workspaceId={selectedWorkspaceId} /></div>}
          </div>
        </div>
      </aside>

      <div className="studio-main">
        {degraded && <ShellReconnect />}
        <UniversalReviewLayout pathname={pathname}>
          <PageTransition routeKey={pathname} className={flush ? "flush" : undefined}>{children}</PageTransition>
        </UniversalReviewLayout>
      </div>
    </div>
  );
}

function healthLabel(health: OperationsHealth | "restricted" | "unavailable" | null): string {
  if (!health) return "Checking…";
  if (health === "restricted") return "Status restricted";
  if (health === "unavailable") return "Status unavailable";
  if (health.status === "healthy") return "All systems ready";
  return health.status === "critical" ? "Action required" : "Needs attention";
}

function WorkspacePicker({ workspaces, selectedWorkspaceId, pathname, degraded = false }: { workspaces: Workspace[]; selectedWorkspaceId: string | null; pathname: string; degraded?: boolean }) {
  if (!workspaces.length && degraded) return <div className="studio-workspace-label is-loading"><span>Workspace</span><b>Reconnecting…</b></div>;
  if (!workspaces.length) return <div className="studio-workspace-label"><span>Workspace</span><b>PRO</b></div>;
  return <form action={switchWorkspaceAction} className="studio-workspace-picker">
    <input type="hidden" name="returnTo" value={pathname} />
    <label htmlFor="workspace-switcher">Workspace</label>
    <Select
      id="workspace-switcher" name="workspaceId" aria-label="Switch workspace" defaultValue={selectedWorkspaceId ?? workspaces[0].id}
      options={workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name }))}
      // Let the hidden input pick up the new value before the form submits.
      onValueChange={() => setTimeout(() => document.getElementById("workspace-switcher")?.closest("form")?.requestSubmit())}
    />
  </form>;
}

/**
 * Avatar, identity, and sign-out.
 *
 * `user` is null only when `/auth/me/` could not answer — Django unreachable — because a
 * 401 redirects to sign-in before a page ever renders the shell. In that case the menu
 * offers the way back in rather than an account it cannot name.
 */
function AccountMenu({ user }: { user: ShellUser | null }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  if (!user) {
    return <Link className="studio-avatar is-anonymous" href="/sign-in" aria-label="Sign in">?</Link>;
  }

  return (
    <div className="studio-account" ref={wrap}>
      <button
        type="button"
        className="studio-avatar"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account: ${user.name}`}
      >
        {user.initials}
      </button>

      {open && (
        <div className="studio-account-menu" role="menu">
          <div className="studio-account-who">
            <strong>{user.name}</strong>
            <small><Mail size={11} />{user.email}</small>
          </div>
          <div className="studio-account-theme"><small>Theme</small><ThemeSwitch compact label="Theme" /></div>
          <Link href="/settings" role="menuitem" onClick={() => setOpen(false)}>
            <Settings size={15} />Settings
          </Link>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); window.dispatchEvent(new Event(REPORT_EVENT)); }}>
            <LifeBuoy size={15} />Report a problem
          </button>
          {user.isPlatformStaff && <Link href="/platform" role="menuitem" onClick={() => setOpen(false)}>
            <ShieldCheck size={15} />Platform admin
          </Link>}
          {/* A form, not a fetch: the action clears the session cookies server-side. */}
          <form action={signOutAction}>
            <button type="submit" role="menuitem" className="studio-sign-out">
              <LogOut size={15} />Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return narrow;
}
