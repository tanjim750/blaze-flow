"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "@/components/icons";

/** The HD (2880×1800) app screenshots the hero cycles through. */
export const DEMO_SLIDES = [
  { src: "/marketing/tasks.webp", alt: "Tasks board with To do, In progress and Review columns" },
  { src: "/marketing/dashboard.webp", alt: "Dashboard with approvals waiting, project health, review queue and team workload" },
  { src: "/marketing/review.webp", alt: "Review page: a client cut with time-stamped comments" },
  { src: "/marketing/files.webp", alt: "Files library" },
  { src: "/marketing/portal.webp", alt: "Client portal" },
];
const HOLD_MS = 4000;

/**
 * The hero's product tour: a slideshow of still, full-frame HD screenshots that crossfade.
 * Each slide stays at scale 1 (no zoom/pan) — only opacity animates. Auto-advance is off for
 * prefers-reduced-motion and while scrolled out of view, and the toggle satisfies WCAG 2.2.2.
 */
export function DemoVideo({ label }: { label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [visible, setVisible] = useState(true);
  const userPaused = useRef(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setPlaying(!query.matches && !userPaused.current);
    sync();
    query.addEventListener("change", sync);
    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver !== "undefined" && ref.current) {
      observer = new IntersectionObserver(([entry]) => setVisible(!!entry?.isIntersecting), { threshold: 0 });
      observer.observe(ref.current);
    }
    return () => { query.removeEventListener("change", sync); observer?.disconnect(); };
  }, []);

  useEffect(() => {
    if (!playing || !visible) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % DEMO_SLIDES.length), HOLD_MS);
    return () => window.clearInterval(id);
  }, [playing, visible]);

  const toggle = () => {
    userPaused.current = playing;
    setPlaying(!playing);
  };

  return (
    <div className="mk-video mk-slides" ref={ref} role="img" aria-label={label}>
      {DEMO_SLIDES.map((s, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={s.src} src={s.src} alt="" width={2880} height={1800} decoding="async"
          loading={i === 0 ? "eager" : "lazy"} fetchPriority={i === 0 ? "high" : "auto"}
          className={i === index ? "is-active" : undefined} />
      ))}
      <button type="button" className="mk-video-toggle" onClick={toggle} aria-pressed={!playing} aria-label={playing ? "Pause product demo" : "Play product demo"}>
        {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        <span>{playing ? "Pause" : "Play demo"}</span>
      </button>
    </div>
  );
}
