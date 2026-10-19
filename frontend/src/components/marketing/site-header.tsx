"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Flame, Menu, X } from "lucide-react";
import { siteConfig } from "@/lib/site-config";
import { useReducedMotionSafe } from "./motion-prefs";

export const MARKETING_NAV = [
  { href: "/features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/contact", label: "Contact" },
] as const;

export function Brand() {
  return (
    <Link className="mk-brand" href="/" aria-label={`${siteConfig.name} home`}>
      <span aria-hidden="true"><Flame /></span>
      {siteConfig.name}
    </Link>
  );
}

/** Sticky public header. Below 860px the links fold into a menu with 52px rows. */
export function SiteHeader() {
  const pathname = usePathname();
  // The menu belongs to the page it was opened on, so navigating closes it with no effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (value: boolean) => setOpenOn(value ? pathname : null);
  const reduceMotion = useReducedMotionSafe();

  // Escape closes it too.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpenOn(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const current = (href: string) => (pathname === href ? "page" : undefined);

  return (
    <header className="mk-header">
      <div className="mk-wrap mk-header-row">
        <Brand />
        <nav className="mk-nav" aria-label="Main">
          {MARKETING_NAV.map((item) => (
            <Link key={item.href} href={item.href} aria-current={current(item.href)}>{item.label}</Link>
          ))}
        </nav>
        <div className="mk-header-actions">
          <Link className="mk-header-login" href={siteConfig.links.signIn}>Log in</Link>
          <Link className="mk-btn is-sm" href={siteConfig.links.signUp}>Start free trial</Link>
        </div>
        <button
          type="button"
          className="mk-menu-button"
          aria-expanded={open}
          aria-controls="mk-mobile-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen(!open)}
        >
          {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.nav
            id="mk-mobile-menu"
            className="mk-mobile-panel"
            aria-label="Main"
            initial={reduceMotion ? false : { opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: -8 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
          >
            {MARKETING_NAV.map((item) => (
              <Link key={item.href} href={item.href} aria-current={current(item.href)}>{item.label}</Link>
            ))}
            <div className="mk-ctas">
              <Link className="mk-btn is-ghost" href={siteConfig.links.signIn}>Log in</Link>
              <Link className="mk-btn" href={siteConfig.links.signUp}>Start free trial</Link>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
