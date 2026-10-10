"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { safeReturnPath, withReturnPath } from "@/lib/open-in-review";

const OPEN_REVIEW_EVENT = "blazeflow:open-review";
/** Where the last review was opened from, for its Back button when the URL has no `from`. */
export const REVIEW_FROM_KEY = "blazeflow-review-from";

export type ReviewRequest = { href: string; title?: string };

/**
 * Opens a file in the review page.
 *
 * Every entry point (Files, a project's files, the task board and list, task attachments,
 * notifications) calls this, so they all land on the same full review page: the player,
 * comments, versions and decisions. It used to open a split pane with the review in an
 * iframe beside the page; at laptop widths that pane was too narrow for the player and the
 * picture collapsed to a strip, so review is now always a real page with its own URL.
 *
 * It is still an event rather than a hook so leaf components (and their isolated tests)
 * need no router or provider; the app shell turns the event into a navigation.
 */
export function openUniversalReview(request: ReviewRequest) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ReviewRequest>(OPEN_REVIEW_EVENT, { detail: request }));
}

/** The current in-app location, which is where review's Back should return to. */
function here(): string | null {
  return safeReturnPath(`${window.location.pathname}${window.location.search}`);
}

function remember(from: string | null) {
  if (!from) return;
  try { window.sessionStorage.setItem(REVIEW_FROM_KEY, from); } catch { /* storage blocked */ }
}

export function UniversalReviewLayout({ children, pathname }: { children: React.ReactNode; pathname: string }) {
  const router = useRouter();

  useEffect(() => {
    const onOpen = (event: Event) => {
      const request = (event as CustomEvent<ReviewRequest>).detail;
      if (!request?.href?.startsWith("/review?")) return;
      const from = here();
      remember(from);
      router.push(withReturnPath(request.href, from));
    };
    // Plain links into review (dashboards, notifications, activity) navigate on their own;
    // note where they were clicked from so the review's Back returns there.
    const onClick = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target : null;
      if (element?.closest('a[href^="/review?"]')) remember(here());
    };
    window.addEventListener(OPEN_REVIEW_EVENT, onOpen);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener(OPEN_REVIEW_EVENT, onOpen);
      document.removeEventListener("click", onClick, true);
    };
  }, [router, pathname]);

  return <div className="universal-review-layout"><div className="universal-review-page">{children}</div></div>;
}
