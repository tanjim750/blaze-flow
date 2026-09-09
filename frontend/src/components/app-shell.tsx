"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, Building2, CalendarDays, CheckCircle2, CircleHelp, Flame, FolderOpen, House, LogOut, Mail, Menu, Search, Settings, SquareKanban, Users, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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

const workspaceTabs = [
  { href: "/projects", label: "All Projects" },
  { href: "/review", label: "Active Reviews" },
  { href: "/render-queue", label: "Render Queue" },
  { href: "/deliverables", label: "Deliverables" },
];

export function AppShell({ children, flush = false, user = null, workspaces = [], selectedWorkspaceId = null }: {
  children: React.ReactNode; flush?: boolean; user?: ShellUser | null;
  workspaces?: Workspace[]; selectedWorkspaceId?: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [health, setHealth] = useState<OperationsHealth | "restricted" | "unavailable" | null>(null);
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

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

  return (
    <div className="studio-shell">
      <button className="mobile-menu" onClick={() => setOpen(!open)} aria-label="Toggle navigation" aria-expanded={open}>
        {open ? <X /> : <Menu />}
      </button>

      <aside className={open ? "studio-sidebar open" : "studio-sidebar"}>
        <div>
          <div className="studio-brand"><span><Flame size={17} /></span><strong>Blaze Flow</strong></div>
          <WorkspacePicker workspaces={workspaces} selectedWorkspaceId={selectedWorkspaceId} pathname={pathname} />
          <nav aria-label="Main navigation">
            {primaryLinks.map(({ href, label, icon: Icon }) => (
              <Link key={label} href={href} onClick={() => setOpen(false)} className={isActive(href) ? "active" : ""} aria-current={isActive(href) ? "page" : undefined}>
                <Icon size={20} /><span>{label}</span>
              </Link>
            ))}
          </nav>
        </div>
        <div className="studio-sidebar-foot">
          <nav aria-label="Secondary navigation">
            <Link href="/settings"><Settings size={18} /><span>Settings</span></Link>
            <Link href="/help"><CircleHelp size={18} /><span>Help</span></Link>
          </nav>
          <div className="render-engine">
            <i className={typeof health === "object" && health ? health.status : undefined} />
            <div><small>Operations</small><span>{healthLabel(health)}</span></div>
            {typeof health === "object" && health && health.alerts.length > 0 && <b>{health.alerts.reduce((sum, alert) => sum + alert.count, 0)} alerts</b>}
          </div>
        </div>
      </aside>

      <div className="studio-main">
        <header className="studio-topbar">
          <div className="studio-topbar-left">
            <div className="studio-core"><span><Flame size={14} /></span><strong>Studio Core</strong></div>
            <span className="studio-divider" />
            <nav className="studio-tabs" aria-label="Workspace sections">
              {workspaceTabs.map(({ href, label }) => (
                <Link key={label} href={href} className={isActive(href) ? "active" : ""} aria-current={isActive(href) ? "page" : undefined}>{label}</Link>
              ))}
            </nav>
          </div>
          <div className="studio-topbar-right">
            <form className="studio-search" action="/projects">
              <Search size={15} />
              <input name="q" aria-label="Search cuts, markers, tags" placeholder="Search cuts, markers, tags..." />
              <kbd>⌘K</kbd>
            </form>
            <div className="studio-notifications">
              <button type="button" className="studio-icon-button" aria-label={`${unread} unread notifications`} aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen(!notificationsOpen)}><Bell size={16} />{unread > 0 && <i />}</button>
              {notificationsOpen && <div className="studio-notification-menu"><header><strong>Notifications</strong>{unread > 0 && <button type="button" onClick={() => void markAllRead()}>Mark all read</button>}</header><div>{visibleNotifications.length === 0
                ? <p>No notifications yet.</p>
                : visibleNotifications.slice(0, 12).map((item) => <button type="button" key={item.id} className={`studio-notification-item ${item.unread ? "unread" : ""}`} onClick={() => void openNotification(item)}><i /><span><strong>{notificationTitle(item)}</strong>{typeof item.payload?.excerpt === "string" && <em>{item.payload.excerpt}</em>}<small>{new Date(item.created_at).toLocaleString()}</small></span></button>)}</div><footer><Link href="/settings" onClick={() => setNotificationsOpen(false)}>Notification preferences</Link></footer></div>}
            </div>
            <Link className="studio-icon-button" href="/projects" aria-label="Schedule and deadlines"><CalendarDays size={16} /></Link>
            <span className="studio-divider" />
            <AccountMenu user={user} />
          </div>
        </header>
        <main className={flush ? "flush" : undefined}>{children}</main>
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
