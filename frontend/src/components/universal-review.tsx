"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { animate } from "animejs/animation";
import { spring } from "animejs/easings/spring";
import { createScope } from "animejs/scope";
import { stagger } from "animejs/utils";
import { ExternalLink, Play, X } from "lucide-react";

const OPEN_REVIEW_EVENT = "blazeflow:open-review";
const REVIEW_SPLIT_KEY = "blazeflow-universal-review-split-v1";

export type ReviewRequest = { href: string; title?: string };

/**
 * Opens the one app-level review workspace.
 *
 * This is deliberately an event instead of a React context: cards are also rendered in
 * isolated component tests and a few server-rendered pages use ordinary links. The shell
 * listens for this event while its click delegation covers those links, so every entry
 * point reaches one implementation without forcing every leaf through a provider prop.
 */
export function openUniversalReview(request: ReviewRequest) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ReviewRequest>(OPEN_REVIEW_EVENT, { detail: request }));
}

type ActiveReview = { href: string; query: string; title: string };

export function UniversalReviewLayout({ children, pathname }: { children: React.ReactNode; pathname: string }) {
  const reduced = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const [review, setReview] = useState<ActiveReview | null>(null);
  const [split, setSplit] = useState(54);
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    const stored = Number(window.localStorage.getItem(REVIEW_SPLIT_KEY));
    if (Number.isFinite(stored) && stored >= 35 && stored <= 72) {
      queueMicrotask(() => setSplit(stored));
    }
  }, []);

  useEffect(() => {
    if (pathname.startsWith("/review")) {
      queueMicrotask(() => setReview(null));
      return;
    }

    const open = (request: ReviewRequest) => {
      const parsed = parseReviewRequest(request);
      if (parsed) setReview(parsed);
    };
    const onOpen = (event: Event) => open((event as CustomEvent<ReviewRequest>).detail);
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const element = event.target instanceof Element ? event.target : null;
      const anchor = element?.closest<HTMLAnchorElement>('a[href^="/review?"]');
      if (!anchor || anchor.dataset.reviewFull === "true" || (anchor.target && anchor.target !== "_self")) return;
      const title = anchor.getAttribute("aria-label")?.replace(/^Open review (?:for )?/i, "")
        || anchor.querySelector("strong, h1, h2, h3, h4")?.textContent?.trim()
        || "Video review";
      const parsed = parseReviewRequest({ href: anchor.getAttribute("href") ?? "", title });
      if (!parsed) return;
      event.preventDefault();
      setReview(parsed);
    };
    const onEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setReview(null); };
    window.addEventListener(OPEN_REVIEW_EVENT, onOpen);
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener(OPEN_REVIEW_EVENT, onOpen);
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onEscape);
    };
  }, [pathname]);

  /*
   * Motion owns the React layout transition; Anime.js owns the small, coordinated reveal
   * inside it. Scoping this to the persistent shell prevents selectors from leaking into
   * the page beside the review and `revert()` removes every instance/style on close.
   */
  useEffect(() => {
    if (!review || reduced || !root.current) return;
    const scope = createScope({ root }).add(() => {
      animate("[data-review-reveal]", {
        opacity: { from: 0 },
        y: { from: -7 },
        delay: stagger(38),
        duration: 440,
        ease: "out(4)",
      });
      animate("[data-review-frame]", {
        opacity: { from: 0 },
        scale: { from: .992 },
        delay: 70,
        duration: 620,
        ease: "out(3)",
      });
      animate(".universal-review-resizer > span", {
        opacity: { from: 0 },
        scale: { from: .76 },
        rotate: { from: -7 },
        delay: 120,
        ease: spring({ bounce: .32, duration: 560 }),
      });
    });
    return () => scope.revert();
  }, [reduced, review]);

  function resize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || !root.current) return;
    const bounds = root.current.getBoundingClientRect();
    setSplit(Math.min(72, Math.max(35, (event.clientX - bounds.left) / bounds.width * 100)));
  }
  function finishResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setResizing(false);
    window.localStorage.setItem(REVIEW_SPLIT_KEY, String(split));
  }
  function resizeWithKeys(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setSplit((value) => {
      const next = Math.min(72, Math.max(35, value + (event.key === "ArrowLeft" ? -2 : 2)));
      window.localStorage.setItem(REVIEW_SPLIT_KEY, String(next));
      return next;
    });
  }

  return (
    <div
      ref={root}
      className={`universal-review-layout ${review ? "is-open" : ""} ${resizing ? "is-resizing" : ""}`}
      style={{ "--universal-review-size": `${split}%` } as CSSProperties}
    >
      <AnimatePresence initial={false}>
        {review && (
          <motion.aside
            className="universal-review-pane"
            initial={reduced ? false : { opacity: 0, x: -18 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduced ? undefined : { opacity: 0, x: -18 }}
            transition={reduced ? { duration: 0 } : { duration: .22, ease: [.22, 1, .36, 1] }}
            aria-label={`Review ${review.title}`}
          >
            <header>
              <span data-review-reveal><Play />Review</span>
              <strong data-review-reveal title={review.title}>{review.title}</strong>
              <Link data-review-reveal href={review.href} data-review-full="true" aria-label="Open full review" title="Open full review"><ExternalLink /></Link>
              <button data-review-reveal type="button" onClick={() => setReview(null)} aria-label="Close review"><X /></button>
            </header>
            <iframe
              data-review-frame
              key={review.query}
              src={`/review-embed?${review.query}`}
              title={`Review ${review.title}`}
              allow="fullscreen"
              allowFullScreen
            />
          </motion.aside>
        )}
      </AnimatePresence>

      {review && (
        <button
          type="button"
          role="slider"
          className="universal-review-resizer"
          aria-label="Resize review workspace"
          aria-orientation="horizontal"
          aria-valuemin={35}
          aria-valuemax={72}
          aria-valuenow={Math.round(split)}
          title="Drag to resize"
          onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setResizing(true); }}
          onPointerMove={resize}
          onPointerUp={finishResize}
          onPointerCancel={finishResize}
          onKeyDown={resizeWithKeys}
        ><span>⋮</span></button>
      )}

      <div className="universal-review-page">{children}</div>
    </div>
  );
}

function parseReviewRequest(request: ReviewRequest): ActiveReview | null {
  if (!request?.href) return null;
  try {
    const url = new URL(request.href, window.location.origin);
    if (url.pathname !== "/review" || !url.search) return null;
    return {
      href: `${url.pathname}${url.search}`,
      query: url.searchParams.toString(),
      title: request.title?.trim() || "Video review",
    };
  } catch {
    return null;
  }
}
