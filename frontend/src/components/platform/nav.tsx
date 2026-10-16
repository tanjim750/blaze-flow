"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Building2, Gauge, LifeBuoy, ListRestart, ScrollText, ShieldCheck, Users } from "lucide-react";

const LINKS = [
  { href: "/platform", label: "Overview", icon: Gauge },
  { href: "/platform/workspaces", label: "Workspaces", icon: Building2 },
  { href: "/platform/users", label: "Users", icon: Users },
  { href: "/platform/jobs", label: "Jobs", icon: ListRestart },
  { href: "/platform/support", label: "Support", icon: LifeBuoy },
  { href: "/platform/audit", label: "Audit", icon: ScrollText },
];

/** Sidebar at desktop widths, a scrolling tab strip below 1024px (see platform.css). */
export function PlatformNav({ email, badges }: { email: string; badges: Partial<Record<string, number>> }) {
  const pathname = usePathname();
  const active = (href: string) => (href === "/platform" ? pathname === href : pathname.startsWith(href));
  return (
    <aside className="pf-nav">
      <div className="pf-brand"><ShieldCheck size={18} /><div><strong>Blaze Flow</strong><small>Platform admin · staff only</small></div></div>
      <nav aria-label="Platform admin">
        {LINKS.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={active(href) ? "active" : undefined} aria-current={active(href) ? "page" : undefined}>
            <Icon size={17} /><span>{label}</span>
            {badges[label] ? <b aria-label={`${badges[label]} need attention`}>{badges[label]}</b> : null}
          </Link>
        ))}
      </nav>
      <div className="pf-nav-foot">
        <small title={email}>{email}</small>
        <Link href="/" className="pf-back" aria-label="Back to app"><ArrowLeft size={15} /><span>Back to app</span></Link>
      </div>
    </aside>
  );
}
