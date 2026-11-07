"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * The page body's entrance, and nothing else: the sidebar and topbar never animate.
 *
 * This used to be a CSS animation on `<main key={pathname}>`. Keying the element remounted
 * the whole page on every navigation, and the animation then ran on whatever was rendered
 * first — usually the `loading.tsx` skeleton, which also faded itself in (two animations
 * at once) — after which the real page replaced it with a hard cut. Pages without a
 * skeleton animated only once their data had arrived, and the first paint after a reload
 * replayed it during hydration.
 *
 * Now the element is stable and the entrance is played imperatively (Web Animations API)
 * exactly once per pathname, before paint so there is no flash of unanimated content:
 *
 * - a navigation that lands on real content fades it in straight away;
 * - one that lands on a skeleton leaves the skeleton to its own (delayed) fade, and plays
 *   the entrance when the skeleton is swapped for the page;
 * - a query-string change (filters, a folder, a tab) or a re-render never replays it, and
 *   neither does the initial server render;
 * - `prefers-reduced-motion` skips it entirely.
 */
export const PAGE_ENTER_MS = 180;
const SKELETON = ".sk-body";

export function playPageEnter(element: HTMLElement | null) {
  if (!element || typeof element.animate !== "function") return null;
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return null;
  element.getAnimations?.().forEach((animation) => animation.cancel());
  return element.animate(
    [{ opacity: 0, transform: "translate3d(0, 6px, 0)" }, { opacity: 1, transform: "none" }],
    // No fill: once it ends the element has no transform left, so fixed-position children
    // (selection bars, sheets) anchor to the viewport again instead of to <main>.
    { duration: PAGE_ENTER_MS, easing: "cubic-bezier(.22, 1, .36, 1)" },
  );
}

const hasSkeleton = (element: HTMLElement) => Boolean(element.querySelector(SKELETON));

export function PageTransition({ routeKey, className, children }: { routeKey: string; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const shown = useRef<string | null>(null);
  // Set when a navigation landed on a skeleton: the entrance is owed to the page behind it.
  const owed = useRef(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || shown.current === routeKey) return;
    const initial = shown.current === null;
    shown.current = routeKey;
    if (initial) return;
    if (hasSkeleton(element)) { owed.current = true; return; }
    owed.current = false;
    playPageEnter(element);
  }, [routeKey]);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof MutationObserver === "undefined") return;
    // MutationObserver callbacks run as a microtask after React's commit and before the
    // browser paints, so the page never shows a frame at full opacity first.
    const observer = new MutationObserver(() => {
      if (hasSkeleton(element)) { if (shown.current !== null) owed.current = true; return; }
      if (!owed.current) return;
      owed.current = false;
      playPageEnter(element);
    });
    observer.observe(element, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return <main ref={ref} className={className} data-page-transition="">{children}</main>;
}
