"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";

/** Fired before a programmatic navigation so the top progress bar starts at once. */
export const NAV_START_EVENT = "bf:navigation-start";

export function announceNavigation(href: string) {
  if (typeof window === "undefined") return;
  let next: URL;
  try { next = new URL(href, window.location.href); } catch { return; }
  if (next.origin !== window.location.origin) return;
  if (next.pathname === window.location.pathname && next.search === window.location.search) return;
  window.dispatchEvent(new CustomEvent(NAV_START_EVENT));
}

/**
 * `useRouter`, but `push`/`replace` light the top progress bar the moment they are called.
 * Link clicks are picked up by NavProgress on their own; programmatic navigations (a row
 * that opens on click, a redirect after an action) used to give no feedback until the next
 * page had fully rendered, now that fast routes no longer flash a skeleton.
 */
export function useAppRouter() {
  const router = useRouter();
  return useMemo(() => ({
    ...router,
    push: (href: string, options?: Parameters<typeof router.push>[1]) => { announceNavigation(href); if (options) router.push(href, options); else router.push(href); },
    replace: (href: string, options?: Parameters<typeof router.replace>[1]) => { announceNavigation(href); if (options) router.replace(href, options); else router.replace(href); },
  }), [router]);
}
