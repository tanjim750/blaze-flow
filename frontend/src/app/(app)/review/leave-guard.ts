"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Stops the review page being left while it holds unsaved work.
 *
 * Two ways out are covered. Closing the tab, reloading or typing a new address fire
 * `beforeunload`, where the browser shows its own prompt (it ignores custom text). In-app
 * navigation never fires that event under the App Router, so link clicks are caught in the
 * capture phase on `document`, before Next's `<Link>` handler sees them, and the page asks
 * with its own dialog instead. Navigation the page starts itself (the version and compare
 * pickers) goes through `guard()`.
 *
 * Browser Back/Forward is not intercepted: the App Router gives no hook to cancel a
 * popstate. The composer's text survives that anyway, because it is a stored draft.
 */
export function shouldIntercept(anchor: HTMLAnchorElement, event: Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "defaultPrevented">, current: Location): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false; // opens elsewhere
  if (anchor.hasAttribute("download")) return false;
  if (anchor.target && anchor.target !== "_self" && anchor.target !== "_top") return false;
  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return false;
  let url: URL;
  try { url = new URL(anchor.href, current.href); } catch { return false; }
  if (url.origin !== current.origin) return false;
  // A link to an attachment or API file is a download, not a navigation.
  if (url.pathname.startsWith("/api/")) return false;
  return url.pathname !== current.pathname || url.search !== current.search;
}

/**
 * `message` is what an in-app navigation would cost (null: nothing, so no prompt);
 * `unload` is whether closing or reloading the tab would lose anything. They differ: notes
 * on an unpublished file live in memory, so they survive moving around the app but not a
 * reload.
 */
export function useLeaveGuard(message: string | null, unload: boolean, navigate: (href: string, top: boolean) => void) {
  const [pending, setPending] = useState<{ href: string; top: boolean } | null>(null);
  const active = useRef(message);
  useEffect(() => { active.current = message; }, [message]);
  // Set once the reviewer has agreed to leave, so the unload prompt does not ask twice.
  const leaving = useRef(false);

  useEffect(() => {
    if (!unload) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (leaving.current) return;
      event.preventDefault();
      // Still required by Chrome and Safari to show the prompt.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [unload]);

  useEffect(() => {
    if (!message) return;
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.("a");
      if (!anchor || !shouldIntercept(anchor, event, window.location)) return;
      event.preventDefault();
      event.stopPropagation();
      const url = new URL(anchor.href);
      setPending({ href: url.pathname + url.search, top: anchor.target === "_top" });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [message]);

  /** Navigation the page starts itself: asks first when there is something to lose. */
  const guard = useCallback((href: string) => {
    if (active.current) setPending({ href, top: false });
    else navigate(href, false);
  }, [navigate]);

  const confirm = useCallback(() => {
    if (!pending) return;
    setPending(null);
    leaving.current = true;
    navigate(pending.href, pending.top);
    // If the navigation is refused or lands on this page again, re-arm the guard.
    window.setTimeout(() => { leaving.current = false; }, 1500);
  }, [navigate, pending]);

  const cancel = useCallback(() => setPending(null), []);
  return { pending, guard, confirm, cancel };
}
