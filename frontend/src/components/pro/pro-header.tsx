"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Flame, Menu, X } from "@/components/icons";
import { siteConfig } from "@/lib/site-config";

export const PRO_NAV = [
  { href: "/features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/contact", label: "Contact" },
] as const;

export function ProBrand() {
  return (
    <Link className="pro-brand" href="/" aria-label={`${siteConfig.name} home`}>
      <span className="pro-brand-mark" aria-hidden="true"><Flame /></span>
      <span>{siteConfig.name}</span>
    </Link>
  );
}

/**
 * Thin sticky header. It is transparent over the hero and picks up a hairline and a tinted
 * backdrop once the page moves. Below 860px the links fold into a menu with 52px rows.
 */
export function ProHeader() {
  const pathname = usePathname();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpenOn(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="pro-header" data-scrolled={scrolled || open ? "" : undefined}>
      <div className="pro-wrap pro-header-row">
        <ProBrand />
        <nav className="pro-nav" aria-label="Main">
          {PRO_NAV.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}
        </nav>
        <div className="pro-header-actions">
          <Link className="pro-link" href={siteConfig.links.signIn}>Log in</Link>
          <Link className="pro-btn is-sm" href={siteConfig.links.signUp}>Start free trial</Link>
        </div>
        <button
          type="button"
          className="pro-menu-button"
          aria-expanded={open}
          aria-controls="pro-mobile-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpenOn(open ? null : pathname)}
        >
          {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>
      </div>
      {open && (
        <nav id="pro-mobile-menu" className="pro-mobile-panel" aria-label="Main">
          {PRO_NAV.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}
          <Link href={siteConfig.links.signIn}>Log in</Link>
          <Link className="pro-btn" href={siteConfig.links.signUp}>Start free trial</Link>
        </nav>
      )}
    </header>
  );
}
