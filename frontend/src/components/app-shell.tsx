"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Building2, CalendarDays, CheckCircle2, CircleHelp, Flame, FolderOpen, House, Menu, Search, Settings, SquareKanban, Users, X } from "lucide-react";
import { useState } from "react";

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

export function AppShell({ children, flush = false }: { children: React.ReactNode; flush?: boolean }) {
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
            <Link className="studio-avatar" href="/sign-in" aria-label="Your account">AR</Link>
          </div>
        </header>
        <main className={flush ? "flush" : undefined}>{children}</main>
      </div>
    </div>
  );
}
