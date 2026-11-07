"use client";

import { useEffect, useRef } from "react";

export const DO_EVENT = "bf:do";

/**
 * Runs `run` when a ⌘K quick action asks this page to open its own dialog
 * ("Upload" → /files?do=upload). Arriving from another page, the action is read from the URL
 * on mount and the parameter is dropped so a refresh or Back does not open it again; already
 * on the page, the palette sends a `bf:do` event instead of navigating.
 */
export function useDoParam(action: string, run: () => void) {
  const latest = useRef(run);
  useEffect(() => { latest.current = run; });
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("do") === action) {
      latest.current();
      url.searchParams.delete("do");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }
    const onDo = (event: Event) => { if ((event as CustomEvent<string>).detail === action) latest.current(); };
    window.addEventListener(DO_EVENT, onDo);
    return () => window.removeEventListener(DO_EVENT, onDo);
  }, [action]);
}

/** For the palette: same page → fire the event and report true; otherwise the caller navigates. */
export function runHere(href: string) {
  const url = new URL(href, window.location.href);
  const action = url.searchParams.get("do");
  if (!action || url.pathname !== window.location.pathname) return false;
  window.dispatchEvent(new CustomEvent(DO_EVENT, { detail: action }));
  return true;
}
