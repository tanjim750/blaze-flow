"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Building2, CalendarDays, CheckCircle2, CircleHelp, Flame, FolderOpen, House, LogOut, Mail, Menu, Search, Settings, SquareKanban, Users, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { signOutAction } from "@/app/actions";
import type { ShellUser } from "@/lib/user";

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

export function AppShell({ children, flush = false, user = null }: {
  children: React.ReactNode; flush?: boolean; user?: ShellUser | null;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <div className="studio-shell">
      <button className="mobile-menu" onClick={() => setOpen(!open)} aria-label="Toggle navigation" aria-expanded={open}>
        {open ? <X /> : <Menu />}
      </button>

      <aside className={open ? "studio-sidebar open" : "studio-sidebar"}>
        <div>
          <div className="studio-brand"><span><Flame size={17} /></span><strong>Blaze Flow</strong></div>
          <div className="studio-workspace-label"><span>Workspace</span><b>PRO</b></div>
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
            <i />
            <div><small>Render Engine</small><span>Node 04 • Ready</span></div>
            <b>4K DCI</b>
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
            <Link className="studio-icon-button" href="/review" aria-label="Notifications"><Bell size={16} /><i /></Link>
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
