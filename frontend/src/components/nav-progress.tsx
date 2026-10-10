"use client";

import { useLinkStatus } from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * A progress bar for in-app navigation.
 *
 * The App Router exposes no router events, so a navigation is detected where it starts — a
 * left-click on a same-origin link. Rather than clearing that on completion from an effect,
 * the route the click came from is recorded and the bar shows only while the resolved route
 * still matches it; arriving anywhere else ends it during render. Without this the only
 * feedback is the page swapping some moment later, which reads as a dead click.
 */
export function NavProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const route = `${pathname}?${searchParams}`;
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const active = startedAt !== null && startedAt === route;

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      // Let the browser handle anything that is not a plain left-click navigation.
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;

      let next: URL;
      try { next = new URL(anchor.href, window.location.href); } catch { return; }
      if (next.origin !== window.location.origin) return;
      // Same page: nothing will load, so showing a bar would leave it stuck.
      if (next.pathname === window.location.pathname && next.search === window.location.search) return;

      const from = `${window.location.pathname}?${new URLSearchParams(window.location.search)}`;
      setStartedAt(from);
      // A navigation that never resolves (aborted, offline) must not strand the bar.
      window.setTimeout(() => setStartedAt((current) => (current === from ? null : current)), 15000);
    };

    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  if (!active) return null;
  return <div className="nav-progress" role="status" aria-label="Loading page"><i /></div>;
}

/**
 * Inline spinner for the enclosing `<Link>`. `loading.tsx` covers segment navigation, but a
 * link that only changes query params — picking a campaign, say — resolves without ever
 * hitting that fallback, so the click needs feedback of its own.
 */
export function LinkPending() {
  const { pending } = useLinkStatus();
  return pending ? <i className="nav-link-spinner" aria-hidden="true" /> : null;
}
