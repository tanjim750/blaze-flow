"use client";

import Link from "next/link";
import { LinkPending } from "@/components/nav-progress";
import { usePathname, useRouter } from "next/navigation";
import { Bell, Building2, CheckCircle2, ChevronLeft, CircleHelp, Clapperboard, Flame, FolderOpen, House, LogOut, Mail, Menu, PackageCheck, Search, Server, Settings, SquareKanban, Users, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { signOutAction, switchWorkspaceAction } from "@/app/actions";
import type { ShellUser } from "@/lib/user";
import type { Notification, Workspace } from "@/lib/api";

type OperationsHealth = { status: "healthy" | "warning" | "critical"; alerts: { severity: string; code: string; count: number }[] };

const primaryLinks = [
  { href: "/", label: "Home", icon: House },
  { href: "/projects", label: "Projects", icon: SquareKanban },
  { href: "/tasks", label: "Tasks", icon: CheckCircle2 },
  { href: "/files", label: "Files", icon: FolderOpen },
  { href: "/clients", label: "Clients", icon: Building2 },
  { href: "/team", label: "Team & Roles", icon: Users },
];

/**
 * What used to be the topbar's tab strip. The bar itself is gone, but these are the only
 * routes it was the way to reach, so they moved here rather than disappearing with it.
 * "All Projects" is not among them: that was the same `/projects` as the link above.
 */
const workspaceLinks = [
  { href: "/review", label: "Active Reviews", icon: Clapperboard },
  { href: "/render-queue", label: "Render Queue", icon: Server },
  { href: "/deliverables", label: "Deliverables", icon: PackageCheck },
];

/** Mirrors the cookie the layout reads, so a reload opens at the width you left it. */
const RAIL_COOKIE = "blazeflow_rail";

export function AppShell({ children, user = null, workspaces = [], selectedWorkspaceId = null, railCollapsed = false }: {
  children: React.ReactNode; user?: ShellUser | null;
  workspaces?: Workspace[]; selectedWorkspaceId?: string | null;
  /** Read from a cookie by the layout, so the first paint is already the right width. */
  railCollapsed?: boolean;
}) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(railCollapsed);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [health, setHealth] = useState<OperationsHealth | "restricted" | "unavailable" | null>(null);
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  // Projects lays out its own full-bleed browser, so it opts out of the standard page padding.
  // Full-bleed routes: the projects tree and the review workspace both own their own
  // chrome and fill the viewport, so the shell gives them the frame without the padding.
  const flush = pathname.startsWith("/projects") || pathname.startsWith("/review");

  useEffect(() => {
    let active = true;
    void fetch("/api/notifications/", { credentials: "include" }).then(async (response) => {
      if (response.ok && active) setNotifications(await response.json() as Notification[]);
    }).catch(() => undefined);
    if (!selectedWorkspaceId) { queueMicrotask(() => active && setHealth(null)); return () => { active = false; }; }
    void fetch(`/api/workspaces/${selectedWorkspaceId}/operations/health/`, { credentials: "include" }).then(async (response) => {
      if (!active) return;
      if (response.ok) setHealth(await response.json() as OperationsHealth);
      else setHealth(response.status === 403 ? "restricted" : "unavailable");
    }).catch(() => active && setHealth("unavailable"));
    return () => { active = false; };
  }, [selectedWorkspaceId]);

  const visibleNotifications = notifications.filter((item) => !selectedWorkspaceId || !item.workspace_id || item.workspace_id === selectedWorkspaceId);
  const unread = visibleNotifications.filter((item) => item.unread).length;

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

  async function markAllRead() {
    const response = await fetch("/api/notifications/read-all/", { method: "POST", credentials: "include", headers: { "X-CSRFToken": browserCsrfToken() } });
    if (response.ok) setNotifications((items) => items.map((item) => ({ ...item, unread: false, read_at: new Date().toISOString() })));
  }
  async function openNotification(item: Notification) {
    if (item.unread) {
      const response = await fetch(`/api/notifications/${item.id}/read/`, { method: "POST", credentials: "include", headers: { "X-CSRFToken": browserCsrfToken() } });
      if (response.ok) setNotifications((items) => items.map((candidate) => candidate.id === item.id ? { ...candidate, unread: false, read_at: new Date().toISOString() } : candidate));
    }
    setNotificationsOpen(false); router.push(notificationHref(item));
  }

  const shellClass = `studio-shell${collapsed ? " is-collapsed" : ""}`;

  return (
    <div className={shellClass}>
      <button className="mobile-menu" onClick={() => setOpen(!open)} aria-label="Toggle navigation" aria-expanded={open}>
        {open ? <X /> : <Menu />}
      </button>

      <aside className={open ? "studio-sidebar open" : "studio-sidebar"}>
        <motion.button
          type="button"
          className="studio-rail-toggle"
          onClick={toggleRail}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-expanded={!collapsed}
          whileTap={reduceMotion ? undefined : { scale: 0.82 }}
          transition={{ type: "spring", stiffness: 620, damping: 14 }}
        >
          <ChevronLeft size={14} strokeWidth={2.25} />
        </motion.button>

        <div className="studio-sidebar-top">
          <div className="studio-brand"><span><Flame size={17} /></span><strong>Blaze Flow</strong></div>
          <WorkspacePicker workspaces={workspaces} selectedWorkspaceId={selectedWorkspaceId} pathname={pathname} />

          <form className="studio-rail-search" action="/projects">
            <Search size={14} />
            <input name="q" aria-label="Search cuts, markers, tags" placeholder="Search cuts, markers…" />
          </form>

          <nav aria-label="Main navigation">
            {primaryLinks.map(({ href, label, icon: Icon }) => (
              <Link key={label} href={href} onClick={() => setOpen(false)} title={label} className={isActive(href) ? "active" : ""} aria-current={isActive(href) ? "page" : undefined}>
                <Icon size={20} /><span>{label}</span><LinkPending />
              </Link>
            ))}
          </nav>

          <p className="studio-rail-heading">Workspace</p>
          <nav aria-label="Workspace sections">
            {workspaceLinks.map(({ href, label, icon: Icon }) => (
              <Link key={label} href={href} onClick={() => setOpen(false)} title={label} className={isActive(href) ? "active" : ""} aria-current={isActive(href) ? "page" : undefined}>
                <Icon size={20} /><span>{label}</span><LinkPending />
              </Link>
            ))}
          </nav>
        </div>

        <div className="studio-sidebar-foot">
          <nav aria-label="Secondary navigation">
            <Link href="/settings" title="Settings"><Settings size={18} /><span>Settings</span></Link>
            <Link href="/help" title="Help"><CircleHelp size={18} /><span>Help</span></Link>
          </nav>
          <div className="render-engine">
            <i className={typeof health === "object" && health ? health.status : undefined} />
            <div><small>Operations</small><span>{healthLabel(health)}</span></div>
            {typeof health === "object" && health && health.alerts.length > 0 && <b>{health.alerts.reduce((sum, alert) => sum + alert.count, 0)} alerts</b>}
          </div>

          <div className="studio-rail-account">
            <AccountMenu user={user} />
            {user && <span className="studio-rail-who"><strong>{user.name}</strong><small>{user.email}</small></span>}
            <div className="studio-notifications">
              <button type="button" className="studio-icon-button" aria-label={`${unread} unread notifications`} aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen(!notificationsOpen)}><Bell size={16} />{unread > 0 && <i />}</button>
              {notificationsOpen && <div className="studio-notification-menu"><header><strong>Notifications</strong>{unread > 0 && <button type="button" onClick={() => void markAllRead()}>Mark all read</button>}</header><div>{visibleNotifications.length === 0
                ? <p>No notifications yet.</p>
                : visibleNotifications.slice(0, 12).map((item) => <button type="button" key={item.id} className={`studio-notification-item ${item.unread ? "unread" : ""}`} onClick={() => void openNotification(item)}><i /><span><strong>{notificationTitle(item)}</strong>{typeof item.payload?.excerpt === "string" && <em>{item.payload.excerpt}</em>}<small>{new Date(item.created_at).toLocaleString()}</small></span></button>)}</div><footer><Link href="/settings" onClick={() => setNotificationsOpen(false)}>Notification preferences</Link></footer></div>}
            </div>
          </div>
        </div>
      </aside>

      <div className="studio-main">
        <motion.main key={pathname} className={flush ? "flush" : undefined} initial={{ opacity: 0, y: reduceMotion ? 0 : 7 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : .24, ease: [.22, 1, .36, 1] }}>{children}</motion.main>
      </div>
    </div>
  );
}

function browserCsrfToken(): string {
  return decodeURIComponent(document.cookie.split("; ").find((item) => item.startsWith("csrftoken="))?.slice(10) ?? "");
}

function notificationTitle(notification: Notification): string {
  const action = notification.kind.replaceAll("_", " ").replaceAll(".", " ");
  return notification.actor?.name ? `${notification.actor.name} · ${action}` : action;
}

function notificationHref(notification: Notification): string {
  if (notification.entity_type === "review_comment" && typeof notification.payload?.project_id === "string") {
    const version = typeof notification.payload.media_version_id === "string" ? `&version=${notification.payload.media_version_id}` : "";
    return `/review?project=${notification.payload.project_id}${version}`;
  }
  if (notification.entity_type === "media_version") return "/review";
  return "/";
}

function healthLabel(health: OperationsHealth | "restricted" | "unavailable" | null): string {
  if (!health) return "Checking…";
  if (health === "restricted") return "Status restricted";
  if (health === "unavailable") return "Status unavailable";
  if (health.status === "healthy") return "All systems ready";
  return health.status === "critical" ? "Action required" : "Needs attention";
}

function WorkspacePicker({ workspaces, selectedWorkspaceId, pathname }: { workspaces: Workspace[]; selectedWorkspaceId: string | null; pathname: string }) {
  if (!workspaces.length) return <div className="studio-workspace-label"><span>Workspace</span><b>PRO</b></div>;
  return <form action={switchWorkspaceAction} className="studio-workspace-picker">
    <input type="hidden" name="returnTo" value={pathname} />
    <label htmlFor="workspace-switcher">Workspace</label>
    <select id="workspace-switcher" name="workspaceId" value={selectedWorkspaceId ?? workspaces[0].id} onChange={(event) => event.currentTarget.form?.requestSubmit()} aria-label="Switch workspace">
      {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
    </select>
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
          <Link href="/settings" role="menuitem" onClick={() => setOpen(false)}>
            <Settings size={15} />Settings
          </Link>
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
